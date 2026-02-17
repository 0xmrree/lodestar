import {Connection, PrivateKey} from "@libp2p/interface";
import {peerIdFromPrivateKey} from "@libp2p/peer-id";
import {multiaddr} from "@multiformats/multiaddr";
import {PeerScoreStatsDump} from "@chainsafe/libp2p-gossipsub/score";
import {routes} from "@lodestar/api";
import {BeaconConfig, ForkBoundary} from "@lodestar/config";
import type {LoggerNode} from "@lodestar/logger/node";
import {isForkPostFulu} from "@lodestar/params";
import {ResponseIncoming} from "@lodestar/reqresp";
import {Epoch, Status, fulu, sszTypesFor} from "@lodestar/types";
import {
  CustodyConfig,
  ClockEvent,
  IClock,
  peerIdFromString,
} from "@lodestar/beacon-node/util";
import {
  Discv5Worker,
  Eth2Gossipsub,
  FORK_EPOCH_LOOKAHEAD,
  GetReqRespHandlerFn,
  Libp2p,
  LocalStatusCache,
  MetadataController,
  MultiaddrStr,
  NetworkConfig,
  NetworkEventBus,
  NetworkOptions,
  OutgoingRequestArgs,
  PeerAction,
  PeerIdStr,
  PeerManager,
  PeerRpcScoreStore,
  PeerScoreStats,
  PeersData,
  ReqRespBeaconNode,
  computeNodeId,
  createNodeJsLibp2p,
  formatNodePeer,
  getActiveForkBoundaries,
  getConnectionsMap,
  getCoreTopicsAtFork,
} from "@lodestar/beacon-node/network";
import {noopAttnetsService} from "../subnets/noopAttnetsService.js";
import {noopSyncnetsService} from "../subnets/noopSyncnetsService.js";

type Mods = {
  libp2p: Libp2p;
  gossip: Eth2Gossipsub;
  reqResp: ReqRespBeaconNode;
  peerManager: PeerManager;
  networkConfig: NetworkConfig;
  peersData: PeersData;
  metadata: MetadataController;
  logger: LoggerNode;
  config: BeaconConfig;
  clock: IClock;
  statusCache: LocalStatusCache;
  opts: NetworkOptions;
};

export type BaseNetworkInit = {
  opts: NetworkOptions;
  config: BeaconConfig;
  privateKey: PrivateKey;
  peerStoreDir: string | undefined;
  logger: LoggerNode;
  clock: IClock;
  events: NetworkEventBus;
  getReqRespHandler: GetReqRespHandlerFn;
  activeValidatorCount: number;
  initialStatus: Status;
  initialCustodyGroupCount: number;
};

/**
 * This class is meant to work both:
 * - In a libp2p worker
 * - In the main thread
 *
 * libp2p holds the reference to the TCP transport socket. libp2p is in a worker, what components
 * must be in a worker too?
 * - MetadataController: Read by ReqRespBeaconNode, written by AttnetsService + SyncnetsService
 * - PeerRpcScoreStore
 * - ReqRespBeaconNode: Must be in worker, depends on libp2p
 * - Eth2Gossipsub: Must be in worker, depends on libp2p
 * - AttnetsService
 * - SyncnetsService
 * - PeerManager
 * - NetworkProcessor: Must be in the main thread, depends on chain
 */
export class LightClientNetworkCore {
  // Internal modules
  private readonly libp2p: Libp2p;
  private readonly peerManager: PeerManager;
  private readonly networkConfig: NetworkConfig;
  private readonly peersData: PeersData;
  private readonly reqResp: ReqRespBeaconNode;
  private readonly gossip: Eth2Gossipsub;
  // TODO: Review if here is best place, and best architecture
  private readonly metadata: MetadataController;
  private readonly logger: LoggerNode;
  private readonly config: BeaconConfig;
  private readonly clock: IClock;
  private readonly statusCache: LocalStatusCache;
  private readonly opts: NetworkOptions;

  // Internal state
  private readonly forkBoundariesByEpoch = new Map<Epoch, ForkBoundary>();
  private closed = false;

  constructor(modules: Mods) {
    this.libp2p = modules.libp2p;
    this.gossip = modules.gossip;
    this.reqResp = modules.reqResp;
    this.peerManager = modules.peerManager;
    this.networkConfig = modules.networkConfig;
    this.peersData = modules.peersData;
    this.metadata = modules.metadata;
    this.logger = modules.logger;
    this.config = modules.config;
    this.clock = modules.clock;
    this.statusCache = modules.statusCache;
    this.opts = modules.opts;

    this.clock.on(ClockEvent.epoch, this.onEpoch);
  }

  static async init({
    opts,
    config,
    privateKey,
    peerStoreDir,
    logger,
    events,
    clock,
    getReqRespHandler,
    activeValidatorCount,
    initialStatus,
    initialCustodyGroupCount,
  }: BaseNetworkInit): Promise<LightClientNetworkCore> {
    const libp2p = await createNodeJsLibp2p(privateKey, opts, {
      peerStoreDir,
      metrics: false,
      metricsRegistry: undefined,
    });

    const peersData = new PeersData();
    const peerRpcScores = new PeerRpcScoreStore(opts, null, logger);
    const statusCache = new LocalStatusCache(initialStatus);

    // Bind discv5's ENR to local metadata
    // resolve circular dependency by setting `discv5` variable after the peer manager is instantiated
    let discv5: Discv5Worker | undefined;
    const onMetadataSetValue = function onMetadataSetValue(key: string, value: Uint8Array): void {
      discv5?.setEnrValue(key, value).catch((e: Error) => logger.error("error on setEnrValue", {key}, e));
    };
    const peerId = peerIdFromPrivateKey(privateKey);
    const nodeId = computeNodeId(peerId);
    const networkConfig: NetworkConfig = {
      nodeId,
      config,
      custodyConfig: new CustodyConfig({nodeId, config, initialCustodyGroupCount}),
    };
    const metadata = new MetadataController({}, {networkConfig, logger, onSetValue: onMetadataSetValue});

    const reqResp = null as any /* TODO make LC fork of this new ReqRespBeaconNode(
      {
        config,
        libp2p,
        metadata,
        peerRpcScores,
        logger,
        events,
        metrics: null,
        peersData,
        statusCache,
        getHandler: getReqRespHandler,
      },
      opts
    );*/

    const gossip = new Eth2Gossipsub(opts, {
      networkConfig,
      libp2p,
      logger,
      metricsRegister: null,
      eth2Context: {
        activeValidatorCount,
        currentSlot: clock.currentSlot,
        currentEpoch: clock.currentEpoch,
      },
      peersData,
      events,
    });

    // Note: should not be necessary, already called in createNodeJsLibp2p()
    await libp2p.start();

    await reqResp.start();
    await gossip.start();

    const peerManager = await PeerManager.init(
      {
        privateKey,
        libp2p,
        gossip,
        reqResp,
        attnetsService: noopAttnetsService,
        syncnetsService: noopSyncnetsService,
        logger,
        metrics: null,
        clock,
        peerRpcScores,
        events,
        networkConfig,
        peersData,
        statusCache,
      },
      opts
    );

    // Network spec decides version changes based on clock epoch, not head epoch
    const boundary = config.getForkBoundaryAtEpoch(clock.currentEpoch);

    // Register only ReqResp protocols relevant to clock's epoch
    reqResp.registerProtocolsAtBoundary(boundary);

    // Bind discv5's ENR to local metadata
    // biome-ignore lint/complexity/useLiteralKeys: `discovery` is a private attribute
    discv5 = peerManager["discovery"]?.discv5;

    // Initialize ENR with clock's fork
    metadata.upstreamValues(clock.currentEpoch);

    return new LightClientNetworkCore({
      libp2p,
      reqResp,
      gossip,
      peerManager,
      networkConfig,
      peersData,
      metadata,
      logger,
      config,
      clock,
      statusCache,
      opts,
    });
  }

  /** Destroy this instance. Can only be called once. */
  async close(): Promise<void> {
    if (this.closed) return;

    this.clock.off(ClockEvent.epoch, this.onEpoch);

    // Must goodbye and disconnect before stopping libp2p
    await this.peerManager.goodbyeAndDisconnectAllPeers();
    this.logger.debug("network sent goodbye to all peers");
    await this.peerManager.close();
    this.logger.debug("network peerManager closed");
    await this.gossip.stop();
    this.logger.debug("network gossip closed");
    await this.reqResp.stop();
    await this.reqResp.unregisterAllProtocols();
    this.logger.debug("network reqResp closed");
    await this.libp2p.stop();
    this.logger.debug("network lib2p closed");

    this.closed = true;
  }

  async isSubscribedToGossipCoreTopics(): Promise<boolean> {
    return this.forkBoundariesByEpoch.size > 0;
  }

  getNetworkConfig(): NetworkConfig {
    return this.networkConfig;
  }

  async updateStatus(status: Status): Promise<void> {
    this.statusCache.update(status);
  }

  async reportPeer(peer: PeerIdStr, action: PeerAction, actionName: string): Promise<void> {
    this.peerManager.reportPeer(peerIdFromString(peer), action, actionName);
  }

  sendReqRespRequest(data: OutgoingRequestArgs): AsyncIterable<ResponseIncoming> {
    const peerId = peerIdFromString(data.peerId);
    return this.reqResp.sendRequestWithoutEncoding(peerId, data.method, data.versions, data.requestData);
  }

  getConnectionsByPeer(): Map<string, Connection[]> {
    const m = new Map<string, Connection[]>();
    for (const [k, v] of getConnectionsMap(this.libp2p).entries()) {
      m.set(k, v.value);
    }
    return m;
  }

  // Debug

  async connectToPeer(peerIdStr: PeerIdStr, multiaddrStrArr: MultiaddrStr[]): Promise<void> {
    const peer = peerIdFromString(peerIdStr);
    await this.libp2p.peerStore.merge(peer, {multiaddrs: multiaddrStrArr.map(multiaddr)});
    await this.libp2p.dial(peer);
  }

  async disconnectPeer(peerIdStr: PeerIdStr): Promise<void> {
    await this.libp2p.hangUp(peerIdFromString(peerIdStr));
  }

  async addDirectPeer(peer: routes.lodestar.DirectPeer): Promise<string | null> {
    return this.gossip.addDirectPeer(peer);
  }

  async removeDirectPeer(peerIdStr: PeerIdStr): Promise<boolean> {
    return this.gossip.removeDirectPeer(peerIdStr);
  }

  async getDirectPeers(): Promise<string[]> {
    return this.gossip.getDirectPeers();
  }

  private _dumpPeer(peerIdStr: string, connections: Connection[]): routes.lodestar.LodestarNodePeer {
    const peerData = this.peersData.connectedPeers.get(peerIdStr);
    const fork = this.config.getForkName(this.clock.currentSlot);
    if (isForkPostFulu(fork) && peerData?.status) {
      (peerData.status as fulu.Status).earliestAvailableSlot =
        (peerData.status as fulu.Status).earliestAvailableSlot ?? 0;
    }
    return {
      ...formatNodePeer(peerIdStr, connections),
      agentVersion: peerData?.agentVersion ?? "NA",
      status: peerData?.status ? sszTypesFor(fork).Status.toJson(peerData.status) : null,
      metadata: peerData?.metadata ? sszTypesFor(fork).Metadata.toJson(peerData.metadata) : null,
      agentClient: String(peerData?.agentClient ?? "Unknown"),
      lastReceivedMsgUnixTsMs: peerData?.lastReceivedMsgUnixTsMs ?? 0,
      lastStatusUnixTsMs: peerData?.lastStatusUnixTsMs ?? 0,
      connectedUnixTsMs: peerData?.connectedUnixTsMs ?? 0,
    };
  }

  async dumpPeer(peerIdStr: string): Promise<routes.lodestar.LodestarNodePeer | undefined> {
    const connections = this.getConnectionsByPeer().get(peerIdStr);
    return connections ? this._dumpPeer(peerIdStr, connections) : undefined;
  }

  async dumpPeers(): Promise<routes.lodestar.LodestarNodePeer[]> {
    return Array.from(this.getConnectionsByPeer().entries()).map(([peerIdStr, connections]) =>
      this._dumpPeer(peerIdStr, connections)
    );
  }

  async dumpPeerScoreStats(): Promise<PeerScoreStats> {
    return this.peerManager.dumpPeerScoreStats();
  }

  async dumpGossipPeerScoreStats(): Promise<PeerScoreStatsDump> {
    return this.gossip.dumpPeerScoreStats();
  }

  async dumpDiscv5KadValues(): Promise<string[]> {
    // biome-ignore lint/complexity/useLiteralKeys: `discovery` is a private attribute
    return (await this.peerManager["discovery"]?.discv5?.kadValues())?.map((enr: {encodeTxt(): string}) => enr.encodeTxt()) ?? [];
  }

  async dumpMeshPeers(): Promise<Record<string, string[]>> {
    const meshPeers: Record<string, string[]> = {};
    for (const topic of this.gossip.getTopics()) {
      meshPeers[topic] = this.gossip.getMeshPeers(topic);
    }
    return meshPeers;
  }

  async writeDiscv5Profile(durationMs: number, dirpath: string): Promise<string> {
    // biome-ignore lint/complexity/useLiteralKeys: `discovery` is a private attribute
    return this.peerManager["discovery"]?.discv5.writeProfile(durationMs, dirpath) ?? "no discv5";
  }

  writeDiscv5HeapSnapshot(prefix: string, dirpath: string): Promise<string> {
    // biome-ignore lint/complexity/useLiteralKeys: `discovery` is a private attribute
    return this.peerManager["discovery"]?.discv5.writeHeapSnapshot(prefix, dirpath) ?? Promise.resolve("no discv5");
  }

  async writeNetworkThreadProfile(_durationMs: number, _dirpath: string): Promise<string> {
    throw new Error("Method not implemented, please configure network thread");
  }

  writeNetworkHeapSnapshot(_prefix: string, _dirpath: string): Promise<string> {
    throw new Error("Method not implemented, please configure network thread");
  }

  /**
   * Handle subscriptions through fork boundary transitions, @see FORK_EPOCH_LOOKAHEAD
   */
  private onEpoch = async (epoch: Epoch): Promise<void> => {
    try {
      // Compute prev and next fork boundary shifted, so next boundary is still next at forkEpoch + FORK_EPOCH_LOOKAHEAD
      const activeBoundaries = getActiveForkBoundaries(this.config, epoch);
      for (let i = 0; i < activeBoundaries.length; i++) {
        // Only when a new fork boundary is scheduled post this one
        if (activeBoundaries[i + 1] !== undefined) {
          const prevBoundary = activeBoundaries[i];
          const nextBoundary = activeBoundaries[i + 1];
          const nextBoundaryEpoch = nextBoundary.epoch;

          // Before fork boundary transition
          if (epoch === nextBoundaryEpoch - FORK_EPOCH_LOOKAHEAD) {
            // Don't subscribe to new fork boundary if the node is not subscribed to any topic
            if (await this.isSubscribedToGossipCoreTopics()) {
              this.subscribeCoreTopicsAtBoundary(this.networkConfig, nextBoundary);
              this.logger.info("Subscribing gossip topics for next fork boundary", nextBoundary);
            } else {
              this.logger.info("Skipping subscribing gossip topics for next fork boundary", nextBoundary);
            }
          }

          // On fork boundary transition
          if (epoch === nextBoundaryEpoch) {
            // updateEth2Field() MUST be called with clock epoch, onEpoch event is emitted in response to clock events
            const {forkDigest} = this.metadata.updateEth2Field(epoch);
            // Update local status to reflect the new fork digest, otherwise we will disconnect peers that re-status us
            // right after the fork transition due to incompatible forks as our fork digest is stale since we only
            // update it once we import a new head or when emitting update status event.
            this.statusCache.update({...this.statusCache.get(), forkDigest});
            this.reqResp.registerProtocolsAtBoundary(nextBoundary);
          }

          // After fork boundary transition
          if (epoch === nextBoundaryEpoch + FORK_EPOCH_LOOKAHEAD) {
            this.logger.info("Unsubscribing gossip topics of previous fork boundary", prevBoundary);
            this.unsubscribeCoreTopicsAtBoundary(this.networkConfig, prevBoundary);
          }
        }
      }
    } catch (e) {
      this.logger.error("Error on BeaconGossipHandler.onEpoch", {epoch}, e as Error);
    }
  };

  private subscribeCoreTopicsAtBoundary(networkConfig: NetworkConfig, boundary: ForkBoundary): void {
    if (this.forkBoundariesByEpoch.has(boundary.epoch)) return;
    this.forkBoundariesByEpoch.set(boundary.epoch, boundary);
    const {subscribeAllSubnets, disableLightClientServer} = this.opts;

    for (const topic of getCoreTopicsAtFork(networkConfig, boundary.fork, {
      subscribeAllSubnets,
      disableLightClientServer,
    })) {
      this.gossip.subscribeTopic({...topic, boundary});
    }
  }

  private unsubscribeCoreTopicsAtBoundary(networkConfig: NetworkConfig, boundary: ForkBoundary): void {
    if (!this.forkBoundariesByEpoch.has(boundary.epoch)) return;
    this.forkBoundariesByEpoch.delete(boundary.epoch);
    const {subscribeAllSubnets, disableLightClientServer} = this.opts;

    for (const topic of getCoreTopicsAtFork(networkConfig, boundary.fork, {
      subscribeAllSubnets,
      disableLightClientServer,
    })) {
      this.gossip.unsubscribeTopic({...topic, boundary});
    }
  }
}
