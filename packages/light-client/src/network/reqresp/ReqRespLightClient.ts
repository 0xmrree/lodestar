import {PeerId} from "@libp2p/interface";
import {BeaconConfig} from "@lodestar/config";
import {ForkName} from "@lodestar/params";
import {
  Encoding,
  ProtocolDescriptor,
  ReqResp,
  ReqRespOpts,
  ReqRespProtocolModules,
  RequestError,
} from "@lodestar/reqresp";
import {
  LightClientBootstrap,
  LightClientFinalityUpdate,
  LightClientOptimisticUpdate,
  LightClientUpdate,
  Metadata,
  Root,
  Status,
  phase0,
} from "@lodestar/types";
import {Logger} from "@lodestar/utils";
import {IPeerRpcScoreStore, PeerAction} from "../peers/score/index.js";
import * as protocols from "./protocols.js";
import {onOutgoingReqRespError} from "./score.js";
import {ReqRespMethod, Version, requestSszTypeByMethod, responseSszTypeByMethod} from "./types.js";

/**
 * Light client specific ReqResp implementation.
 * Extends the base ReqResp class from @lodestar/reqresp.
 *
 * Key differences from ReqRespBeaconNode:
 * - Only implements light client methods (bootstrap, updates, finality, optimistic)
 * - Dial-only: does not handle incoming requests
 * - No metrics collection
 * - No status caching or metadata controller
 * - Simplified peer scoring integration
 */
export class ReqRespLightClient extends ReqResp {
  private readonly config: BeaconConfig;
  private readonly peerRpcScores: IPeerRpcScoreStore;

  constructor(
    config: BeaconConfig,
    modules: ReqRespProtocolModules,
    peerRpcScores: IPeerRpcScoreStore,
    opts: ReqRespOpts = {}
  ) {
    super(modules, opts);
    this.config = config;
    this.peerRpcScores = peerRpcScores;
  }

  /**
   * Register light client specific protocols.
   * Light client only needs dial-only protocols since it doesn't serve requests.
   */
  async registerLightClientProtocols(): Promise<void> {
    // Status is needed for peer handshake
    const protocolsToRegister = [
      protocols.Status(this.config),
      protocols.Goodbye(this.config),
      protocols.Ping(this.config),
      protocols.Metadata(this.config),
      protocols.MetadataV2(this.config),
      protocols.MetadataV3(this.config),
      // Light client specific protocols
      protocols.LightClientBootstrap(this.config),
      protocols.LightClientUpdatesByRange(this.config),
      protocols.LightClientFinalityUpdate(this.config),
      protocols.LightClientOptimisticUpdate(this.config),
    ];

    for (const protocol of protocolsToRegister) {
      // Register as dial-only since light client doesn't serve requests
      this.registerDialOnlyProtocol(protocol);
    }
  }

  // Light Client specific request methods

  async sendLightClientBootstrap(peerId: PeerId, root: Root): Promise<LightClientBootstrap> {
    return this.sendReqRespRequest<LightClientBootstrap>(
      peerId,
      ReqRespMethod.LightClientBootstrap,
      [Version.V1],
      root
    );
  }

  async sendLightClientUpdatesByRange(
    peerId: PeerId,
    request: {startPeriod: number; count: number}
  ): Promise<LightClientUpdate[]> {
    const updates: LightClientUpdate[] = [];
    for await (const update of this.sendReqRespRequestIter<LightClientUpdate>(
      peerId,
      ReqRespMethod.LightClientUpdatesByRange,
      [Version.V1],
      {startPeriod: BigInt(request.startPeriod), count: BigInt(request.count)}
    )) {
      updates.push(update);
    }
    return updates;
  }

  async sendLightClientFinalityUpdate(peerId: PeerId): Promise<LightClientFinalityUpdate> {
    return this.sendReqRespRequest<LightClientFinalityUpdate>(
      peerId,
      ReqRespMethod.LightClientFinalityUpdate,
      [Version.V1],
      null
    );
  }

  async sendLightClientOptimisticUpdate(peerId: PeerId): Promise<LightClientOptimisticUpdate> {
    return this.sendReqRespRequest<LightClientOptimisticUpdate>(
      peerId,
      ReqRespMethod.LightClientOptimisticUpdate,
      [Version.V1],
      null
    );
  }

  // Basic protocol methods needed for peer management

  async sendStatus(peerId: PeerId, request: Status): Promise<Status> {
    return this.sendReqRespRequest<Status>(peerId, ReqRespMethod.Status, [Version.V2, Version.V1], request);
  }

  async sendGoodbye(peerId: PeerId, request: phase0.Goodbye): Promise<void> {
    await this.sendReqRespRequest<phase0.Goodbye>(peerId, ReqRespMethod.Goodbye, [Version.V1], request);
  }

  async sendPing(peerId: PeerId): Promise<phase0.Ping> {
    // TODO: Get actual sequence number from light client state
    return this.sendReqRespRequest<phase0.Ping>(peerId, ReqRespMethod.Ping, [Version.V1], BigInt(0));
  }

  async sendMetadata(peerId: PeerId): Promise<Metadata> {
    return this.sendReqRespRequest<Metadata>(peerId, ReqRespMethod.Metadata, [Version.V3, Version.V2, Version.V1], null);
  }

  // Private helper methods

  private async sendReqRespRequest<T>(
    peerId: PeerId,
    method: ReqRespMethod,
    versions: Version[],
    body: unknown
  ): Promise<T> {
    const responses: T[] = [];
    for await (const response of this.sendReqRespRequestIter<T>(peerId, method, versions, body)) {
      responses.push(response);
    }
    if (responses.length === 0) {
      throw new Error(`No response received for ${method}`);
    }
    return responses[0];
  }

  private async *sendReqRespRequestIter<T>(
    peerId: PeerId,
    method: ReqRespMethod,
    versions: Version[],
    body: unknown
  ): AsyncIterable<T> {
    // Get the fork for serialization - use current fork
    // TODO: Get actual current fork from light client state
    const fork = ForkName.deneb;

    // Serialize request body
    const requestType = requestSszTypeByMethod(fork, this.config)[method];
    const requestData = requestType ? requestType.serialize(body as never) : new Uint8Array();

    // Send request using base class method
    for await (const response of this.sendRequest(peerId, method, versions, Encoding.SSZ_SNAPPY, requestData)) {
      const responseType = responseSszTypeByMethod[method](response.fork, response.protocolVersion);
      const decoded = responseType.deserialize(response.data) as T;
      yield decoded;
    }
  }

  /**
   * Handle outgoing request errors - apply peer scoring
   */
  protected onOutgoingRequestError(peerId: PeerId, method: string, error: RequestError): void {
    const peerAction = onOutgoingReqRespError(error, method as ReqRespMethod);
    if (peerAction !== null) {
      this.peerRpcScores.applyAction(peerId, peerAction, error.type.code);
    }
  }
}

/**
 * Interface for peer manager to interact with ReqRespLightClient
 */
export interface IReqRespLightClient {
  sendStatus(peerId: PeerId, request: Status): Promise<Status>;
  sendGoodbye(peerId: PeerId, request: phase0.Goodbye): Promise<void>;
  sendPing(peerId: PeerId): Promise<phase0.Ping>;
  sendMetadata(peerId: PeerId): Promise<Metadata>;
  sendLightClientBootstrap(peerId: PeerId, root: Root): Promise<LightClientBootstrap>;
  sendLightClientUpdatesByRange(
    peerId: PeerId,
    request: {startPeriod: number; count: number}
  ): Promise<LightClientUpdate[]>;
  sendLightClientFinalityUpdate(peerId: PeerId): Promise<LightClientFinalityUpdate>;
  sendLightClientOptimisticUpdate(peerId: PeerId): Promise<LightClientOptimisticUpdate>;
}
