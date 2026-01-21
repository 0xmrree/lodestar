/**
 * Light client network interface types.
 *
 * These are simplified versions of the beacon-node network types,
 * containing only what the light client needs.
 */

import type {Connection, PeerId} from "@libp2p/interface";
import type {Libp2p as BaseLibp2p} from "libp2p";

/**
 * Simplified Libp2p interface for light client.
 * The light client only needs to get connections to send req/resp requests.
 */
export type Libp2p = Pick<BaseLibp2p, "getConnections" | "dial" | "start" | "stop"> & {
  peerId: PeerId;
};

export type {Connection, PeerId};
