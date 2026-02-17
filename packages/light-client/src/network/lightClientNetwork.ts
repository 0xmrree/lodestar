import {PeerId, PrivateKey} from "@libp2p/interface";
import {peerIdFromPrivateKey} from "@libp2p/peer-id";
import {PeerScoreStatsDump} from "@chainsafe/libp2p-gossipsub/score";
import {routes} from "@lodestar/api";
import {BeaconConfig} from "@lodestar/config";
import {LoggerNode} from "@lodestar/logger/node";
import {
  LightClientBootstrap,
  LightClientFinalityUpdate,
  LightClientOptimisticUpdate,
  LightClientUpdate,
  Root,
  altair,
  fulu,
} from "@lodestar/types";

import {ResponseIncoming} from "@lodestar/reqresp";
import {
  GossipHandlers,
  GossipType,
  GetReqRespHandlerFn,
  INetworkCore,
  INetworkEventBus,
  NetworkEvent,
  NetworkEventBus,
  NetworkEventData,
  NetworkOptions,
  NetworkProcessor,
  PeerAction,
  PeerScoreStats,
  PeerSyncMeta,
  PendingGossipsubMessage,
  ReqRespMethod,
  Version,
  collectExactOneTyped,
  collectMaxResponseTyped,
  requestSszTypeByMethod,
  responseSszTypeByMethod,
  type PeerIdStr,
} from "@lodestar/beacon-node/network";
import {getGenesisStatus} from "./utils/status.js";
import {IClock} from "./utils/clock.js";
import {LightClientNetworkCore} from "./core/index.js";

type NetworkModules = {
  opts: NetworkOptions;
  privateKey: PrivateKey;
  config: BeaconConfig;
  logger: LoggerNode;
  clock: IClock;
  networkEventBus: NetworkEventBus;
  networkProcessor: NetworkProcessor;
  core: INetworkCore;
};

export type NetworkInitModules = {
  opts: NetworkOptions;
  config: BeaconConfig;
  privateKey: PrivateKey;
  peerStoreDir?: string;
  logger: LoggerNode;
  clock: IClock;
  getReqRespHandler: GetReqRespHandlerFn;
  // Optionally pass custom GossipHandlers, for testing
  gossipHandlers?: GossipHandlers;
};

/**
 * Exists a front class that's what consumers interact with.
 */
export class LightClientNetwork {
  readonly peerId: PeerId;
  // TODO: Make private
  readonly events: INetworkEventBus;

  private readonly logger: LoggerNode;
  private readonly config: BeaconConfig;
  private readonly clock: IClock;
  // Used only for sleep() statements
  private readonly controller: AbortController;

  // TODO: fork NetworkProcessor into a LC-specific version
  private readonly networkProcessor: NetworkProcessor;
  private readonly core: INetworkCore;

  private subscribedToCoreTopics = false;
  private connectedPeersSyncMeta = new Map<string, Omit<PeerSyncMeta, "peerId">>();

  constructor(modules: NetworkModules) {
    this.peerId = peerIdFromPrivateKey(modules.privateKey);
    this.config = modules.config;
    this.logger = modules.logger;
    this.clock = modules.clock;
    this.controller = new AbortController();
    this.events = modules.networkEventBus;
    this.networkProcessor = modules.networkProcessor;
    this.core = modules.core;

    this.events.on(NetworkEvent.peerConnected, this.onPeerConnected);
    this.events.on(NetworkEvent.peerDisconnected, this.onPeerDisconnected);
  }

  static async init({
    opts,
    config,
    logger,
    clock,
    gossipHandlers,
    privateKey,
    peerStoreDir,
    getReqRespHandler,
  }: NetworkInitModules): Promise<LightClientNetwork> {
    const events = new NetworkEventBus();

    const initialStatus = getGenesisStatus(config);

    const core = await LightClientNetworkCore.init({
      opts,
      config,
      privateKey,
      peerStoreDir,
      logger,
      clock,
      events,
      getReqRespHandler,
      metricsRegistry: null,
      initialStatus,
      initialCustodyGroupCount: 0,
      activeValidatorCount: 0,
    });

    // TODO: fork NetworkProcessor into a LC-specific version that only handles
    // light_client_optimistic_update and light_client_finality_update gossip topics
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const networkProcessor = new NetworkProcessor(
      {chain: undefined as any, db: undefined as any, config, logger,metrics: undefined as any, events, gossipHandlers, core},
      opts
    );

    const multiaddresses = opts.localMultiaddrs?.join(",");
    const peerId = peerIdFromPrivateKey(privateKey);
    logger.info(`PeerId ${peerId.toString()}, Multiaddrs ${multiaddresses}`);

    return new LightClientNetwork({
      opts,
      privateKey,
      config,
      logger,
      clock,
      networkEventBus: events,
      networkProcessor,
      core,
    });
  }

  get closed(): boolean {
    return this.controller.signal.aborted;
  }

  /** Destroy this instance. Can only be called once. */
  async close(): Promise<void> {
    if (this.closed) return;

    this.events.off(NetworkEvent.peerConnected, this.onPeerConnected);
    this.events.off(NetworkEvent.peerDisconnected, this.onPeerDisconnected);
    await this.core.close();

    // Used only for sleep() statements
    this.controller.abort();
    this.logger.debug("network core closed");
  }

  async reportPeer(peer: string, action: PeerAction, actionName: string): Promise<void> {
    return this.core.reportPeer(peer, action, actionName);
  }
  
  /**
   * TODO: Subscribe to light_client_optimistic_update and light_client_finality_update gossip topics.
   * Should be called after initial LC sync is complete.
   * Will subscribe only to altair+ fork boundaries, bypassing getCoreTopicsAtFork entirely.
   */
  async subscribeLightClientTopics(): Promise<void> {
    throw new Error("Not yet implemented");
  }
  async unsubscribeLightClientTopics(): Promise<void> {
    throw new Error("Not yet implemented");
  }
  isSubscribedToLightClientTopics(): boolean {
    throw new Error("Not yet implemented");
  }

  // ReqResp
  async sendLightClientBootstrap(peerId: PeerIdStr, request: Root): Promise<LightClientBootstrap> {
    return collectExactOneTyped(
      this.sendReqRespRequest(peerId, ReqRespMethod.LightClientBootstrap, [Version.V1], request),
      responseSszTypeByMethod[ReqRespMethod.LightClientBootstrap]
    );
  }

  async sendLightClientOptimisticUpdate(peerId: PeerIdStr): Promise<LightClientOptimisticUpdate> {
    return collectExactOneTyped(
      this.sendReqRespRequest(peerId, ReqRespMethod.LightClientOptimisticUpdate, [Version.V1], null),
      responseSszTypeByMethod[ReqRespMethod.LightClientOptimisticUpdate]
    );
  }

  async sendLightClientFinalityUpdate(peerId: PeerIdStr): Promise<LightClientFinalityUpdate> {
    return collectExactOneTyped(
      this.sendReqRespRequest(peerId, ReqRespMethod.LightClientFinalityUpdate, [Version.V1], null),
      responseSszTypeByMethod[ReqRespMethod.LightClientFinalityUpdate]
    );
  }

  private sendReqRespRequest<Req>(
    peerId: PeerIdStr,
    method: ReqRespMethod,
    versions: number[],
    request: Req
  ): AsyncIterable<ResponseIncoming> {
    const fork = this.config.getForkName(this.clock.currentSlot);
    const requestType = requestSszTypeByMethod(fork, this.config)[method];
    const requestData = requestType ? requestType.serialize(request as never) : new Uint8Array();

    // ReqResp outgoing request, emit from main thread to worker
    return this.core.sendReqRespRequest({peerId, method, versions, requestData});
  }

  async sendLightClientUpdatesByRange(
    peerId: PeerIdStr,
    request: altair.LightClientUpdatesByRange
  ): Promise<LightClientUpdate[]> {
    return collectMaxResponseTyped(
      this.sendReqRespRequest(peerId, ReqRespMethod.LightClientUpdatesByRange, [Version.V1], request),
      request.count,
      responseSszTypeByMethod[ReqRespMethod.LightClientUpdatesByRange]
    );
  }

  // Debug
  connectToPeer(peer: string, multiaddr: string[]): Promise<void> {
    return this.core.connectToPeer(peer, multiaddr);
  }
  
  disconnectPeer(peer: string): Promise<void> {
    return this.core.disconnectPeer(peer);
  }

  addDirectPeer(peer: routes.lodestar.DirectPeer): Promise<string | null> {
    return this.core.addDirectPeer(peer);
  }

  removeDirectPeer(peerId: string): Promise<boolean> {
    return this.core.removeDirectPeer(peerId);
  }

  getDirectPeers(): Promise<string[]> {
    return this.core.getDirectPeers();
  }

  dumpPeer(peerIdStr: string): Promise<routes.lodestar.LodestarNodePeer | undefined> {
    return this.core.dumpPeer(peerIdStr);
  }

  dumpPeers(): Promise<routes.lodestar.LodestarNodePeer[]> {
    return this.core.dumpPeers();
  }

  dumpPeerScoreStats(): Promise<PeerScoreStats> {
    return this.core.dumpPeerScoreStats();
  }

  dumpGossipPeerScoreStats(): Promise<PeerScoreStatsDump> {
    return this.core.dumpGossipPeerScoreStats();
  }

  dumpDiscv5KadValues(): Promise<string[]> {
    return this.core.dumpDiscv5KadValues();
  }

  dumpMeshPeers(): Promise<Record<string, string[]>> {
    return this.core.dumpMeshPeers();
  }

  async dumpGossipQueue(gossipType: GossipType): Promise<PendingGossipsubMessage[]> {
    return this.networkProcessor.dumpGossipQueue(gossipType);
  }

  async writeNetworkThreadProfile(durationMs: number, dirpath: string): Promise<string> {
    return this.core.writeNetworkThreadProfile(durationMs, dirpath);
  }

  async writeDiscv5Profile(durationMs: number, dirpath: string): Promise<string> {
    return this.core.writeDiscv5Profile(durationMs, dirpath);
  }

  async writeNetworkHeapSnapshot(prefix: string, dirpath: string): Promise<string> {
    return this.core.writeNetworkHeapSnapshot(prefix, dirpath);
  }

  async writeDiscv5HeapSnapshot(prefix: string, dirpath: string): Promise<string> {
    return this.core.writeDiscv5HeapSnapshot(prefix, dirpath);
  }

  private onPeerConnected = (data: NetworkEventData[NetworkEvent.peerConnected]): void => {
    const {peer, clientAgent, custodyColumns, status} = data;
    const earliestAvailableSlot = (status as fulu.Status).earliestAvailableSlot;
    this.logger.verbose("onPeerConnected", {
      peer,
      clientAgent,
      custodyColumns: "N/A",
      earliestAvailableSlot: earliestAvailableSlot ?? "pre-fulu",
    });
    this.connectedPeersSyncMeta.set(peer, {
      client: clientAgent,
      custodyColumns,
      earliestAvailableSlot, // can be undefined pre-fulu
    });
  };

  private onPeerDisconnected = (data: NetworkEventData[NetworkEvent.peerDisconnected]): void => {
    this.connectedPeersSyncMeta.delete(data.peer);
  };
}
