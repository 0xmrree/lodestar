import mitt, {Emitter as MittEmitter} from "mitt";
import {PeerId} from "@libp2p/interface";
import {Libp2p} from "libp2p";
import {BeaconConfig} from "@lodestar/config";
import {ForkName, isForkPostAltair} from "@lodestar/params";
import {ReqResp, Encoding, ResponseIncoming} from "@lodestar/reqresp";
import {
  LightClientBootstrap as LightClientBootstrapProtocol,
  LightClientUpdatesByRange as LightClientUpdatesByRangeProtocol,
  LightClientFinalityUpdate as LightClientFinalityUpdateProtocol,
  LightClientOptimisticUpdate as LightClientOptimisticUpdateProtocol,
  ReqRespMethod,
  Version,
} from "@lodestar/reqresp/protocols";
import {
  LightClientBootstrap,
  LightClientFinalityUpdate,
  LightClientOptimisticUpdate,
  LightClientUpdate,
  SyncPeriod,
  ssz,
  altair,
} from "@lodestar/types";
import {Logger, fromHex} from "@lodestar/utils";
import {LightClientTransport} from "./interface.js";

/**
 * Events emitted by the P2P transport
 * mitt expects event types to map to handler function signatures
 */
type LightClientP2PEvents = {
  onFinalityUpdate: (update: LightClientFinalityUpdate) => void;
  onOptimisticUpdate: (update: LightClientOptimisticUpdate) => void;
};

type LightClientP2PEmitter = MittEmitter<LightClientP2PEvents>;

export type LightClientP2PTransportOpts = {
  /** Maximum number of retries for req/resp requests */
  maxRetries?: number;
  /** Timeout for req/resp requests in milliseconds */
  requestTimeoutMs?: number;
};

export type LightClientP2PTransportModules = {
  /** BeaconConfig includes both ChainForkConfig and CachedGenesis (for fork digest decoding) */
  config: BeaconConfig;
  logger: Logger;
  libp2p: Libp2p;
};

/**
 * Light client transport implementation using P2P networking.
 *
 * Instead of connecting to a single beacon node REST API, this transport:
 * 1. Uses req/resp protocols to fetch bootstrap, updates, finality, and optimistic data from peers
 * 2. Can subscribe to gossipsub topics to receive live finality and optimistic updates (future)
 *
 * This provides censorship resistance by not depending on a single trusted node.
 */
export class LightClientP2PTransport implements LightClientTransport {
  private readonly config: BeaconConfig;
  private readonly logger: Logger;
  private readonly libp2p: Libp2p;
  private readonly reqResp: ReqResp;
  private readonly eventEmitter: LightClientP2PEmitter = mitt();

  constructor(modules: LightClientP2PTransportModules, opts: LightClientP2PTransportOpts = {}) {
    this.config = modules.config;
    this.logger = modules.logger;
    this.libp2p = modules.libp2p;

    // Create ReqResp instance for sending light client requests
    this.reqResp = new ReqResp(
      {
        libp2p: modules.libp2p,
        logger: modules.logger,
        metricsRegister: null,
      },
      {
        requestTimeoutMs: opts.requestTimeoutMs,
      }
    );

    // Register light client protocols as dial-only (we only send requests, not handle them)
    this.registerLightClientProtocols();
  }

  /**
   * Register the light client req/resp protocols.
   * We use dial-only registration since light clients only send requests.
   * The protocol functions return the full protocol definition, but we need to
   * strip inboundRateLimits for dial-only registration.
   */
  private registerLightClientProtocols(): void {
    // For light client protocols, we start with altair as the minimum
    const fork = ForkName.altair;

    // Helper to convert ProtocolNoHandler to DialOnlyProtocol by stripping inboundRateLimits
    const toDialOnly = (protocol: ReturnType<typeof LightClientBootstrapProtocol>) => {
      const {inboundRateLimits: _, ...dialOnly} = protocol;
      return dialOnly;
    };

    // Register all light client protocols
    this.reqResp.registerDialOnlyProtocol(toDialOnly(LightClientBootstrapProtocol(fork, this.config)));
    this.reqResp.registerDialOnlyProtocol(toDialOnly(LightClientUpdatesByRangeProtocol(fork, this.config)));
    this.reqResp.registerDialOnlyProtocol(toDialOnly(LightClientFinalityUpdateProtocol(fork, this.config)));
    this.reqResp.registerDialOnlyProtocol(toDialOnly(LightClientOptimisticUpdateProtocol(fork, this.config)));
  }

  /**
   * Start the P2P transport.
   */
  async start(): Promise<void> {
    await this.reqResp.start();
  }

  /**
   * Stop the P2P transport.
   */
  async stop(): Promise<void> {
    await this.reqResp.stop();
  }

  /**
   * Fetch a bootstrapping state with a proof to a trusted block root.
   * Uses the LightClientBootstrap req/resp protocol.
   */
  async getBootstrap(blockRoot: string): Promise<{version: ForkName; data: LightClientBootstrap}> {
    const root = fromHex(blockRoot);
    const peer = await this.getConnectedPeer();

    const responses = await this.collectResponses(
      this.reqResp.sendRequest(
        peer,
        ReqRespMethod.LightClientBootstrap,
        [Version.V1],
        Encoding.SSZ_SNAPPY,
        ssz.Root.serialize(root)
      )
    );

    if (responses.length === 0) {
      throw new Error("No response received for LightClientBootstrap request");
    }

    const {fork, data} = responses[0];
    const sszType = this.getLightClientSszType(fork, "LightClientBootstrap");
    return {version: fork, data: sszType.deserialize(data) as LightClientBootstrap};
  }

  /**
   * Fetch light client updates for a range of sync committee periods.
   * Uses the LightClientUpdatesByRange req/resp protocol.
   */
  async getUpdates(
    startPeriod: SyncPeriod,
    count: number
  ): Promise<{version: ForkName; data: LightClientUpdate}[]> {
    const peer = await this.getConnectedPeer();

    const requestBody: altair.LightClientUpdatesByRange = {startPeriod, count};
    const responses = await this.collectResponses(
      this.reqResp.sendRequest(
        peer,
        ReqRespMethod.LightClientUpdatesByRange,
        [Version.V1],
        Encoding.SSZ_SNAPPY,
        ssz.altair.LightClientUpdatesByRange.serialize(requestBody)
      )
    );

    return responses.map(({fork, data}) => {
      const sszType = this.getLightClientSszType(fork, "LightClientUpdate");
      return {version: fork, data: sszType.deserialize(data) as LightClientUpdate};
    });
  }

  /**
   * Fetch the latest optimistic update.
   * Uses the LightClientOptimisticUpdate req/resp protocol.
   */
  async getOptimisticUpdate(): Promise<{version: ForkName; data: LightClientOptimisticUpdate}> {
    const peer = await this.getConnectedPeer();

    // Empty request body for optimistic update
    const responses = await this.collectResponses(
      this.reqResp.sendRequest(
        peer,
        ReqRespMethod.LightClientOptimisticUpdate,
        [Version.V1],
        Encoding.SSZ_SNAPPY,
        new Uint8Array()
      )
    );

    if (responses.length === 0) {
      throw new Error("No response received for LightClientOptimisticUpdate request");
    }

    const {fork, data} = responses[0];
    const sszType = this.getLightClientSszType(fork, "LightClientOptimisticUpdate");
    return {version: fork, data: sszType.deserialize(data) as LightClientOptimisticUpdate};
  }

  /**
   * Fetch the latest finality update.
   * Uses the LightClientFinalityUpdate req/resp protocol.
   */
  async getFinalityUpdate(): Promise<{version: ForkName; data: LightClientFinalityUpdate}> {
    const peer = await this.getConnectedPeer();

    // Empty request body for finality update
    const responses = await this.collectResponses(
      this.reqResp.sendRequest(
        peer,
        ReqRespMethod.LightClientFinalityUpdate,
        [Version.V1],
        Encoding.SSZ_SNAPPY,
        new Uint8Array()
      )
    );

    if (responses.length === 0) {
      throw new Error("No response received for LightClientFinalityUpdate request");
    }

    const {fork, data} = responses[0];
    const sszType = this.getLightClientSszType(fork, "LightClientFinalityUpdate");
    return {version: fork, data: sszType.deserialize(data) as LightClientFinalityUpdate};
  }

  /**
   * Register handler for live optimistic updates via gossipsub.
   * TODO: Implement gossipsub support for light client
   */
  onOptimisticUpdate(handler: (optimisticUpdate: LightClientOptimisticUpdate) => void): void {
    this.eventEmitter.on("onOptimisticUpdate", handler);
    // TODO: Subscribe to gossipsub topic when gossip support is added
  }

  /**
   * Register handler for live finality updates via gossipsub.
   * TODO: Implement gossipsub support for light client
   */
  onFinalityUpdate(handler: (finalityUpdate: LightClientFinalityUpdate) => void): void {
    this.eventEmitter.on("onFinalityUpdate", handler);
    // TODO: Subscribe to gossipsub topic when gossip support is added
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Private helpers
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get a connected peer to send requests to.
   * Simple strategy: pick any connected peer.
   * Future: implement peer scoring, rotation, etc.
   */
  private async getConnectedPeer(): Promise<PeerId> {
    const connections = this.libp2p.getConnections();

    if (connections.length === 0) {
      throw new Error("No connected peers available");
    }

    // Simple strategy: pick the first connected peer
    // TODO: Implement peer rotation and scoring
    return connections[0].remotePeer;
  }

  /**
   * Collect all responses from an async iterable.
   * ResponseIncoming already has the fork decoded from context bytes.
   */
  private async collectResponses(
    responses: AsyncIterable<ResponseIncoming>
  ): Promise<{fork: ForkName; data: Uint8Array}[]> {
    const result: {fork: ForkName; data: Uint8Array}[] = [];

    for await (const response of responses) {
      // ResponseIncoming already has fork decoded from context bytes
      result.push({fork: response.fork, data: response.data});
    }

    return result;
  }

  /**
   * Get the SSZ type for a light client message based on fork.
   * Light client types exist from altair onwards and may differ by fork.
   */
  private getLightClientSszType(
    fork: ForkName,
    typeName: "LightClientBootstrap" | "LightClientUpdate" | "LightClientFinalityUpdate" | "LightClientOptimisticUpdate"
  ): {deserialize: (data: Uint8Array) => unknown} {
    // Light client types are available from altair onwards
    // Each fork may have different types (e.g., capella adds execution payload header)
    if (!isForkPostAltair(fork)) {
      // Fallback to altair types for pre-altair forks (shouldn't happen in practice)
      return ssz.altair[typeName];
    }

    // Access fork-specific SSZ types
    const forkSsz = ssz[fork];
    return forkSsz[typeName as keyof typeof forkSsz] as {deserialize: (data: Uint8Array) => unknown};
  }
}
