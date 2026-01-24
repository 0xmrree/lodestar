import {GossipSub, GossipsubEvents} from "@chainsafe/libp2p-gossipsub";
import {PeerScoreParams} from "@chainsafe/libp2p-gossipsub/score";
import {SignaturePolicy} from "@chainsafe/libp2p-gossipsub/types";
import {BeaconConfig} from "@lodestar/config";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {Logger} from "@lodestar/utils";
import {callInNextEventLoop} from "../utils/eventLoop.js";
import {Libp2p} from "../interface.js";
import {NetworkConfig} from "../networkConfig.js";
import {PeersData} from "../peers/peersData.js";
import {DataTransformSnappy, fastMsgIdFn, msgIdFn, msgIdToStrFn} from "./encoding.js";
import {GossipTopic} from "./interface.js";
import {
  GOSSIP_D,
  GOSSIP_D_HIGH,
  GOSSIP_D_LOW,
  computeGossipPeerScoreParams,
  gossipScoreThresholds,
} from "./scoringParameters.js";
import {GossipTopicCache, stringifyGossipTopic} from "./topic.js";

/** As specified in https://github.com/ethereum/consensus-specs/blob/v1.1.10/specs/phase0/p2p-interface.md */
const GOSSIPSUB_HEARTBEAT_INTERVAL = 0.7 * 1000;

const MAX_OUTBOUND_BUFFER_SIZE = 2 ** 24; // 16MB

export type Eth2Context = {
  activeValidatorCount: number;
  currentSlot: number;
  currentEpoch: number;
};

/**
 * Callback type for handling gossip messages
 * Light client uses callbacks instead of NetworkEventBus
 */
export type GossipMessageHandler = (data: {
  topic: GossipTopic;
  msg: {topic: string; data: Uint8Array};
  msgId: string;
  propagationSource: string;
  seenTimestampSec: number;
}) => void;

/**
 * Callback type for validation results
 */
export type ValidationResultHandler = (data: {
  msgId: string;
  propagationSource: string;
  acceptance: number;
}) => void;

export type Eth2GossipsubModules = {
  networkConfig: NetworkConfig;
  libp2p: Libp2p;
  logger: Logger;
  eth2Context: Eth2Context;
  peersData: PeersData;
  // Light client uses callbacks instead of event bus
  onGossipMessage?: GossipMessageHandler;
};

export type Eth2GossipsubOpts = {
  allowPublishToZeroPeers?: boolean;
  gossipsubD?: number;
  gossipsubDLow?: number;
  gossipsubDHigh?: number;
  gossipsubAwaitHandler?: boolean;
  disableFloodPublish?: boolean;
  skipParamsLog?: boolean;
};

/**
 * Wrapper around js-libp2p-gossipsub for the light client.
 * Simplified from beacon-node version:
 * - No metrics
 * - Uses callbacks instead of NetworkEventBus
 * - Only subscribes to light_client_finality_update and light_client_optimistic_update topics
 *
 * See https://github.com/ethereum/consensus-specs/blob/v1.1.10/specs/phase0/p2p-interface.md#the-gossip-domain-gossipsub
 */
export class Eth2Gossipsub extends GossipSub {
  readonly scoreParams: Partial<PeerScoreParams>;
  private readonly config: BeaconConfig;
  private readonly logger: Logger;
  private readonly peersData: PeersData;
  private readonly onGossipMessage?: GossipMessageHandler;

  // Internal caches
  private readonly gossipTopicCache: GossipTopicCache;

  constructor(opts: Eth2GossipsubOpts, modules: Eth2GossipsubModules) {
    const {allowPublishToZeroPeers, gossipsubD, gossipsubDLow, gossipsubDHigh} = opts;
    const {networkConfig, logger, peersData, onGossipMessage} = modules;
    const {config} = networkConfig;
    const gossipTopicCache = new GossipTopicCache(config);

    const scoreParams = computeGossipPeerScoreParams({config, eth2Context: modules.eth2Context});

    // Gossipsub parameters defined here:
    // https://github.com/ethereum/consensus-specs/blob/v1.1.10/specs/phase0/p2p-interface.md#the-gossip-domain-gossipsub
    super(modules.libp2p.services.components, {
      globalSignaturePolicy: SignaturePolicy.StrictNoSign,
      allowPublishToZeroTopicPeers: allowPublishToZeroPeers,
      D: gossipsubD ?? GOSSIP_D,
      Dlo: gossipsubDLow ?? GOSSIP_D_LOW,
      Dhi: gossipsubDHigh ?? GOSSIP_D_HIGH,
      Dlazy: 6,
      heartbeatInterval: GOSSIPSUB_HEARTBEAT_INTERVAL,
      fanoutTTL: 60 * 1000,
      mcacheLength: 6,
      mcacheGossip: 3,
      // this should be in ms
      seenTTL: config.SLOT_DURATION_MS * SLOTS_PER_EPOCH * 2,
      scoreParams,
      scoreThresholds: gossipScoreThresholds,
      // For a single stream, await processing each RPC before processing the next
      awaitRpcHandler: opts.gossipsubAwaitHandler,
      // For a single RPC, await processing each message before processing the next
      awaitRpcMessageHandler: opts.gossipsubAwaitHandler,
      // the default in gossipsub is 3s is not enough since lodestar suffers from I/O lag
      gossipsubIWantFollowupMs: 12 * 1000, // 12s
      fastMsgIdFn: fastMsgIdFn,
      msgIdFn: msgIdFn.bind(msgIdFn, gossipTopicCache),
      msgIdToStrFn: msgIdToStrFn,
      // Light client doesn't use metrics for data transform
      dataTransform: new DataTransformSnappy(gossipTopicCache, config.MAX_PAYLOAD_SIZE, null),
      // Light client doesn't use metrics
      metricsRegister: null,
      metricsTopicStrToLabel: undefined,
      asyncValidation: true,

      maxOutboundBufferSize: MAX_OUTBOUND_BUFFER_SIZE,
      // serialize message once and send to all peers when publishing
      batchPublish: true,
      // if this is false, only publish to mesh peers. If there is not enough GOSSIP_D mesh peers,
      // publish to some more topic peers to make sure we always publish to at least GOSSIP_D peers
      floodPublish: !opts?.disableFloodPublish,
      // Only send IDONTWANT messages if the message size is larger than this
      // This should be large enough to not send IDONTWANT for "small" messages
      // See https://github.com/ChainSafe/lodestar/pull/7077#issuecomment-2383679472
      idontwantMinDataSize: 16829,
    });
    this.scoreParams = scoreParams;
    this.config = config;
    this.logger = logger;
    this.peersData = peersData;
    this.onGossipMessage = onGossipMessage;
    this.gossipTopicCache = gossipTopicCache;

    this.addEventListener("gossipsub:message", this.onGossipsubMessage.bind(this));

    // Having access to this data is CRUCIAL for debugging. While this is a massive log, it must not be deleted.
    // Scoring issues require this dump + current peer score stats to re-calculate scores.
    if (!opts.skipParamsLog) {
      this.logger.debug("Gossipsub score params", {params: JSON.stringify(scoreParams)});
    }
  }

  /**
   * Subscribe to a `GossipTopic`
   */
  subscribeTopic(topic: GossipTopic): void {
    const topicStr = stringifyGossipTopic(this.config, topic);
    // Register known topicStr
    this.gossipTopicCache.setTopic(topicStr, topic);

    this.logger.verbose("Subscribe to gossipsub topic", {topic: topicStr});
    this.subscribe(topicStr);
  }

  /**
   * Unsubscribe to a `GossipTopic`
   */
  unsubscribeTopic(topic: GossipTopic): void {
    const topicStr = stringifyGossipTopic(this.config, topic);
    this.logger.verbose("Unsubscribe to gossipsub topic", {topic: topicStr});
    this.unsubscribe(topicStr);
  }

  /**
   * Report message validation result
   * Light client version without event bus
   */
  reportValidationResult(msgId: string, propagationSource: string, acceptance: number): void {
    // Use setTimeout to yield to the macro queue
    // Without this we'll have huge event loop lag
    // See https://github.com/ChainSafe/lodestar/issues/5604
    callInNextEventLoop(() => {
      this.reportMessageValidationResult(msgId, propagationSource, acceptance);
    });
  }

  private onGossipsubMessage(event: GossipsubEvents["gossipsub:message"]): void {
    const {propagationSource, msgId, msg} = event.detail;

    // Also validates that the topicStr is known
    const topic = this.gossipTopicCache.getTopic(msg.topic);

    // Get seenTimestamp before adding the message to the queue or add async delays
    const seenTimestampSec = Date.now() / 1000;

    const peerIdStr = propagationSource.toString();

    // Use setTimeout to yield to the macro queue
    // Without this we'll have huge event loop lag
    // See https://github.com/ChainSafe/lodestar/issues/5604
    if (this.onGossipMessage) {
      callInNextEventLoop(() => {
        this.onGossipMessage?.({
          topic,
          msg,
          msgId,
          propagationSource: peerIdStr,
          seenTimestampSec,
        });
      });
    }
  }
}
