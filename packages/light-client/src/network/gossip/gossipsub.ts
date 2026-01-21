/**
 * Light client gossipsub implementation.
 *
 * Handles subscribing to gossip topics for light client updates.
 * Adapted from beacon-node but simplified for light client needs.
 */

import {GossipSub} from "@chainsafe/libp2p-gossipsub";
import {BeaconConfig} from "@lodestar/config";
import {ForkName} from "@lodestar/params";
import {Logger} from "@lodestar/utils";
import {Libp2p} from "../interface.js";
import {Eth2Gossipsub, GossipType, GossipTopic, GossipHandler} from "./index.js";
import snappy from "snappy";

/**
 * Gossip topic format: /eth2/{fork_digest}/{topic_type}/{encoding}
 */
const GOSSIP_ENCODING = "ssz_snappy";

export type LightClientGossipsubOpts = {
  libp2p: Libp2p;
  config: BeaconConfig;
  logger: Logger;
};

/**
 * Light client gossipsub handler.
 *
 * Subscribes to light client gossip topics and forwards messages to handlers.
 * The light client participates in gossip by relaying messages (handled by gossipsub).
 */
export class LightClientGossipsub implements Eth2Gossipsub {
  private readonly libp2p: Libp2p;
  private readonly config: BeaconConfig;
  private readonly logger: Logger;
  private gossipsub: GossipSub | null = null;
  private started = false;

  /** Handlers for each topic type */
  private readonly handlers = new Map<GossipType, GossipHandler>();

  /** Track subscribed topics */
  private readonly subscribedTopics = new Set<string>();

  constructor(opts: LightClientGossipsubOpts) {
    this.libp2p = opts.libp2p;
    this.config = opts.config;
    this.logger = opts.logger;
  }

  async start(): Promise<void> {
    if (this.started) return;

    // Create gossipsub instance
    this.gossipsub = new GossipSub(this.libp2p, {
      allowPublishToZeroTopicPeers: true,
      // Don't emit self - we don't publish, only subscribe
      emitSelf: false,
      // Gossipsub parameters tuned for light client
      gossipsubD: 6,
      gossipsubDlo: 4,
      gossipsubDhi: 12,
      gossipsubDlazy: 6,
      heartbeatInterval: 700,
      // Disable flood publishing - light client doesn't publish
      floodPublish: false,
    });

    // Handle incoming gossip messages
    this.gossipsub.addEventListener("gossipsub:message", (event) => {
      const {msg} = event.detail;
      this.handleGossipMessage(msg.topic, msg.data);
    });

    await this.gossipsub.start();
    this.started = true;
    this.logger.debug("Light client gossipsub started");
  }

  async stop(): Promise<void> {
    if (!this.started || !this.gossipsub) return;

    // Unsubscribe from all topics
    for (const topic of this.subscribedTopics) {
      this.gossipsub.unsubscribe(topic);
    }
    this.subscribedTopics.clear();

    await this.gossipsub.stop();
    this.gossipsub = null;
    this.started = false;
    this.logger.debug("Light client gossipsub stopped");
  }

  /**
   * Subscribe to a gossip topic type.
   * Subscribes to topics for all active forks.
   */
  subscribeTopic(type: GossipType): void {
    if (!this.gossipsub) {
      throw new Error("Gossipsub not started");
    }

    // Subscribe to topic for current fork
    // TODO: Subscribe to multiple forks during fork transitions
    const currentFork = this.getCurrentFork();
    const topicStr = this.formatTopicString(type, currentFork);

    if (!this.subscribedTopics.has(topicStr)) {
      this.gossipsub.subscribe(topicStr);
      this.subscribedTopics.add(topicStr);
      this.logger.debug("Subscribed to gossip topic", {type, fork: currentFork, topic: topicStr});
    }
  }

  /**
   * Unsubscribe from a gossip topic type.
   */
  unsubscribeTopic(type: GossipType): void {
    if (!this.gossipsub) return;

    // Find and unsubscribe from all topics of this type
    for (const topicStr of this.subscribedTopics) {
      if (topicStr.includes(type)) {
        this.gossipsub.unsubscribe(topicStr);
        this.subscribedTopics.delete(topicStr);
        this.logger.debug("Unsubscribed from gossip topic", {topic: topicStr});
      }
    }
  }

  /**
   * Register a handler for a gossip topic type.
   */
  handleTopic(type: GossipType, handler: GossipHandler): void {
    this.handlers.set(type, handler);
  }

  /**
   * Handle an incoming gossip message.
   */
  private async handleGossipMessage(topicStr: string, data: Uint8Array): Promise<void> {
    try {
      // Parse the topic to get type and fork
      const topic = this.parseTopicString(topicStr);
      if (!topic) {
        this.logger.debug("Ignoring unknown gossip topic", {topic: topicStr});
        return;
      }

      // Find handler for this topic type
      const handler = this.handlers.get(topic.type);
      if (!handler) {
        this.logger.debug("No handler for gossip topic", {type: topic.type});
        return;
      }

      // Decompress the message (gossip uses snappy compression)
      const decompressed = await snappy.uncompress(data);

      // Call the handler
      handler(new Uint8Array(decompressed), topic);
    } catch (e) {
      this.logger.error("Error handling gossip message", {topic: topicStr}, e as Error);
    }
  }

  /**
   * Format a gossip topic string.
   * Format: /eth2/{fork_digest}/{topic_type}/{encoding}
   */
  private formatTopicString(type: GossipType, fork: ForkName): string {
    const forkDigest = this.getForkDigestHex(fork);
    return `/eth2/${forkDigest}/${type}/${GOSSIP_ENCODING}`;
  }

  /**
   * Parse a gossip topic string.
   */
  private parseTopicString(topicStr: string): GossipTopic | null {
    // Format: /eth2/{fork_digest}/{topic_type}/{encoding}
    const parts = topicStr.split("/");
    if (parts.length !== 5 || parts[1] !== "eth2") {
      return null;
    }

    const [, , forkDigestHex, typeStr, encoding] = parts;

    if (encoding !== GOSSIP_ENCODING) {
      return null;
    }

    // Validate topic type
    if (typeStr !== "light_client_optimistic_update" && typeStr !== "light_client_finality_update") {
      return null;
    }

    // Get fork from fork digest
    const fork = this.forkDigestHexToFork(forkDigestHex);
    if (!fork) {
      return null;
    }

    return {
      type: typeStr as GossipType,
      fork,
    };
  }

  /**
   * Get the current fork based on current time/slot.
   */
  private getCurrentFork(): ForkName {
    // For simplicity, return the latest fork
    // TODO: Properly compute current fork from config and genesis time
    return this.config.getForkSeq(this.config.ELECTRA_FORK_EPOCH) >= 0 ? ForkName.electra : ForkName.deneb;
  }

  /**
   * Get fork digest hex string for a fork.
   */
  private getForkDigestHex(fork: ForkName): string {
    const boundary = this.config.getForkBoundary(fork);
    return this.config.forkBoundary2ForkDigestHex(boundary);
  }

  /**
   * Convert fork digest hex to fork name.
   */
  private forkDigestHexToFork(forkDigestHex: string): ForkName | null {
    try {
      const boundary = this.config.forkDigest2ForkBoundary(forkDigestHex);
      return boundary.fork;
    } catch {
      return null;
    }
  }
}

/**
 * Create a light client gossipsub handler.
 */
export async function createLightClientGossipsub(opts: LightClientGossipsubOpts): Promise<LightClientGossipsub> {
  return new LightClientGossipsub(opts);
}
