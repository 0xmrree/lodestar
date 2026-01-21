/**
 * Light client libp2p setup.
 *
 * Creates a minimal libp2p instance for the light client.
 * Adapted from beacon-node but simplified for light client needs.
 */

import {noise} from "@chainsafe/libp2p-noise";
import {bootstrap} from "@libp2p/bootstrap";
import {identify} from "@libp2p/identify";
import {PrivateKey, PeerId} from "@libp2p/interface";
import {mplex} from "@libp2p/mplex";
import {tcp} from "@libp2p/tcp";
import {createLibp2p, Libp2p as BaseLibp2p} from "libp2p";
import {generateKeyPair} from "@libp2p/crypto/keys";
import {Logger} from "@lodestar/utils";
import {Libp2p} from "./interface.js";

export type LightClientLibp2pOpts = {
  /** Private key for node identity. If not provided, generates a random one. */
  privateKey?: PrivateKey;
  /** Local multiaddrs to listen on */
  localMultiaddrs: string[];
  /** Bootstrap peer multiaddrs to connect to */
  bootnodes: string[];
  /** Maximum number of peer connections */
  maxPeers: number;
  /** Enable discv5 peer discovery */
  discv5Enabled: boolean;
  /** ENR bootnodes for discv5 */
  discv5Bootnodes: string[];
  /** Logger instance */
  logger: Logger;
};

/**
 * Create a libp2p instance configured for the light client.
 *
 * The light client needs:
 * - TCP transport for connecting to beacon nodes
 * - Noise encryption for secure channels
 * - Mplex for stream multiplexing
 * - Bootstrap discovery for initial peers
 * - Optionally discv5 for ongoing peer discovery
 */
export async function createLightClientLibp2p(opts: LightClientLibp2pOpts): Promise<Libp2p> {
  const {localMultiaddrs, bootnodes, maxPeers, logger} = opts;

  // Generate or use provided private key
  const privateKey = opts.privateKey ?? (await generateKeyPair("secp256k1"));

  // Set up peer discovery
  const peerDiscovery = [];

  if (bootnodes.length > 0) {
    peerDiscovery.push(
      bootstrap({
        list: bootnodes,
        timeout: 30_000,
      })
    );
  }

  // TODO: Add discv5 discovery
  // if (opts.discv5Enabled && opts.discv5Bootnodes.length > 0) {
  //   // discv5 setup would go here
  // }

  logger.debug("Creating light client libp2p", {
    localMultiaddrs,
    bootnodes: bootnodes.length,
    maxPeers,
  });

  const libp2p = await createLibp2p({
    privateKey,
    addresses: {
      listen: localMultiaddrs,
      announce: [],
    },
    connectionEncrypters: [noise()],
    transports: [
      tcp({
        maxConnections: maxPeers,
      }),
    ],
    streamMuxers: [
      mplex({
        maxInboundStreams: 256,
      }),
    ],
    peerDiscovery,
    connectionManager: {
      maxParallelDials: 10,
      dialTimeout: 30_000,
      maxIncomingPendingConnections: 5,
    },
    services: {
      identify: identify({
        agentVersion: "lodestar-light-client",
        runOnConnectionOpen: false,
      }),
    },
  });

  // Log peer connection events
  libp2p.addEventListener("peer:connect", (event) => {
    logger.debug("Peer connected", {peer: event.detail.toString()});
  });

  libp2p.addEventListener("peer:disconnect", (event) => {
    logger.debug("Peer disconnected", {peer: event.detail.toString()});
  });

  return libp2p as Libp2p;
}
