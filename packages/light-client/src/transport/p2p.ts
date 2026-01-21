import mitt, {Emitter as MittEmitter} from "mitt";
import {PeerId} from "@libp2p/interface";
import {BeaconConfig} from "@lodestar/config";
import {ForkName} from "@lodestar/params";
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

// These imports assume a future network directory in light-client
// that will contain the necessary P2P infrastructure
import type {Libp2p} from "../network/interface.js";
import type {ReqResp, ReqRespMethod} from "../network/reqresp/index.js";
import type {Eth2Gossipsub, GossipType, GossipTopic} from "../network/gossip/index.js";

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
  reqResp: ReqResp;
  gossip: Eth2Gossipsub;
};

/**
 * Light client transport implementation using P2P networking.
 *
 * Instead of connecting to a single beacon node REST API, this transport:
 * 1. Uses req/resp protocols to fetch bootstrap, updates, finality, and optimistic data from peers
 * 2. Subscribes to gossipsub topics to receive live finality and optimistic updates
 *
 * This provides censorship resistance by not depending on a single trusted node.
 */
export class LightClientP2PTransport implements LightClientTransport {
  private readonly config: BeaconConfig;
  private readonly logger: Logger;
  private readonly libp2p: Libp2p;
  private readonly reqResp: ReqResp;
  private readonly gossip: Eth2Gossipsub;
  private readonly eventEmitter: LightClientP2PEmitter = mitt();
  private subscribedToGossip = false;

  constructor(modules: LightClientP2PTransportModules, _opts: LightClientP2PTransportOpts = {}) {
    this.config = modules.config;
    this.logger = modules.logger;
    this.libp2p = modules.libp2p;
    this.reqResp = modules.reqResp;
    this.gossip = modules.gossip;
    // TODO: Use opts for retry logic and request timeouts
  }

  /**
   * Fetch a bootstrapping state with a proof to a trusted block root.
   * Uses the LightClientBootstrap req/resp protocol.
   */
  async getBootstrap(blockRoot: string): Promise<{version: ForkName; data: LightClientBootstrap}> {
    const root = fromHex(blockRoot);
    const peer = await this.getConnectedPeer();

    const responses = await this.sendReqResp(
      peer,
      "LightClientBootstrap" as ReqRespMethod,
      ssz.Root.serialize(root)
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
    const responses = await this.sendReqResp(
      peer,
      "LightClientUpdatesByRange" as ReqRespMethod,
      ssz.altair.LightClientUpdatesByRange.serialize(requestBody)
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
    const responses = await this.sendReqResp(
      peer,
      "LightClientOptimisticUpdate" as ReqRespMethod,
      new Uint8Array()
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
    const responses = await this.sendReqResp(
      peer,
      "LightClientFinalityUpdate" as ReqRespMethod,
      new Uint8Array()
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
   */
  onOptimisticUpdate(handler: (optimisticUpdate: LightClientOptimisticUpdate) => void): void {
    this.ensureGossipSubscribed();
    this.eventEmitter.on("onOptimisticUpdate", handler);
  }

  /**
   * Register handler for live finality updates via gossipsub.
   */
  onFinalityUpdate(handler: (finalityUpdate: LightClientFinalityUpdate) => void): void {
    this.ensureGossipSubscribed();
    this.eventEmitter.on("onFinalityUpdate", handler);
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
   * Send a req/resp request and collect responses.
   * Returns raw response data with fork info for caller to deserialize.
   */
  private async sendReqResp(
    peer: PeerId,
    method: ReqRespMethod,
    requestData: Uint8Array
  ): Promise<{fork: ForkName; data: Uint8Array}[]> {
    const responses: {fork: ForkName; data: Uint8Array}[] = [];

    for await (const response of this.reqResp.sendRequest(peer, method, requestData)) {
      // The contextBytes contain the fork digest, which we decode to get the fork name
      const fork = this.forkDigestToForkName(response.contextBytes);
      responses.push({fork, data: response.data});
    }

    return responses;
  }

  /**
   * Convert fork digest bytes to fork name using config.
   * BeaconConfig has genesisValidatorsRoot baked in, so forkDigest2ForkBoundary
   * can decode the fork digest directly.
   */
  private forkDigestToForkName(forkDigest: Uint8Array): ForkName {
    // The fork digest is computed as:
    // fork_digest = compute_fork_digest(fork_version, genesis_validators_root)
    // BeaconConfig already knows the genesisValidatorsRoot, so we can decode directly
    const boundary = this.config.forkDigest2ForkBoundary(forkDigest);
    return boundary.fork;
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
    const forkSsz = ssz[fork as keyof typeof ssz];

    if (!forkSsz || !(typeName in forkSsz)) {
      // Fallback to altair types for pre-altair forks (shouldn't happen in practice)
      return ssz.altair[typeName as keyof typeof ssz.altair] as {deserialize: (data: Uint8Array) => unknown};
    }

    return forkSsz[typeName as keyof typeof forkSsz] as {deserialize: (data: Uint8Array) => unknown};
  }

  /**
   * Subscribe to gossip topics for light client updates.
   * Only subscribes once, subsequent calls are no-ops.
   */
  private ensureGossipSubscribed(): void {
    if (this.subscribedToGossip) {
      return;
    }

    this.logger.info("Subscribing to light client gossip topics");

    // Subscribe to light client gossip topics
    // The gossip module handles topic string formatting with fork digest
    this.gossip.subscribeTopic("light_client_optimistic_update" as GossipType);
    this.gossip.subscribeTopic("light_client_finality_update" as GossipType);

    // Handle incoming gossip messages
    this.gossip.handleTopic(
      "light_client_optimistic_update" as GossipType,
      (data: Uint8Array, topic: GossipTopic) => {
        try {
          const sszType = this.getLightClientSszType(topic.fork, "LightClientOptimisticUpdate");
          const update = sszType.deserialize(data) as LightClientOptimisticUpdate;
          this.eventEmitter.emit("onOptimisticUpdate", update);
        } catch (e) {
          this.logger.error("Failed to decode optimistic update from gossip", {}, e as Error);
        }
      }
    );

    this.gossip.handleTopic(
      "light_client_finality_update" as GossipType,
      (data: Uint8Array, topic: GossipTopic) => {
        try {
          const sszType = this.getLightClientSszType(topic.fork, "LightClientFinalityUpdate");
          const update = sszType.deserialize(data) as LightClientFinalityUpdate;
          this.eventEmitter.emit("onFinalityUpdate", update);
        } catch (e) {
          this.logger.error("Failed to decode finality update from gossip", {}, e as Error);
        }
      }
    );

    this.subscribedToGossip = true;
  }
}
