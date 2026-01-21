/**
 * Light client gossip types.
 *
 * These define the interface the light client needs to subscribe to gossip topics.
 * The actual implementation will be copied/adapted from beacon-node.
 */

import type {ForkName} from "@lodestar/params";

/**
 * Gossip topic types relevant to light client.
 */
export type GossipType =
  | "light_client_optimistic_update"
  | "light_client_finality_update";

/**
 * Gossip topic metadata.
 * Includes the fork so we know which SSZ type to use for deserialization.
 */
export interface GossipTopic {
  type: GossipType;
  fork: ForkName;
}

/**
 * Handler for incoming gossip messages.
 */
export type GossipHandler = (data: Uint8Array, topic: GossipTopic) => void;

/**
 * Interface for gossip pub/sub.
 * The light client subscribes to topics and handles incoming messages.
 * It also participates in gossip by relaying messages (handled by gossipsub automatically).
 */
export interface Eth2Gossipsub {
  /**
   * Subscribe to a gossip topic.
   * The implementation handles fork-specific topic string formatting.
   */
  subscribeTopic(type: GossipType): void;

  /**
   * Register a handler for messages on a gossip topic.
   */
  handleTopic(type: GossipType, handler: GossipHandler): void;

  /**
   * Unsubscribe from a gossip topic.
   */
  unsubscribeTopic(type: GossipType): void;
}
