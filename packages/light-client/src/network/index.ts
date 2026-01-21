/**
 * Light client network module.
 *
 * Provides P2P networking for the light client including:
 * - libp2p for peer connections
 * - req/resp for fetching light client data from peers
 * - gossipsub for receiving live updates
 * - discv5 for peer discovery
 */

import {PrivateKey} from "@libp2p/interface";
import {BeaconConfig} from "@lodestar/config";
import {Logger} from "@lodestar/utils";
import {Libp2p} from "./interface.js";
import {ReqResp} from "./reqresp/index.js";
import {Eth2Gossipsub} from "./gossip/index.js";
import {createLightClientLibp2p} from "./libp2p.js";
import {createLightClientReqResp} from "./reqresp/reqresp.js";
import {createLightClientGossipsub} from "./gossip/gossipsub.js";

export type {Libp2p} from "./interface.js";
export type {ReqResp, ReqRespMethod, ResponseIncoming} from "./reqresp/index.js";
export type {Eth2Gossipsub, GossipType, GossipTopic, GossipHandler} from "./gossip/index.js";

/**
 * Options for creating light client network components.
 */
export type LightClientNetworkOpts = {
  /**
   * Bootnodes to connect to for peer discovery.
   * Can be multiaddrs or ENR strings.
   */
  bootnodes: string[];

  /**
   * Local multiaddrs to listen on.
   * @default ["/ip4/0.0.0.0/tcp/0"]
   */
  localMultiaddrs?: string[];

  /**
   * Private key for the libp2p node.
   * If not provided, a random key will be generated.
   */
  privateKey?: PrivateKey;

  /**
   * Maximum number of peers to connect to.
   * @default 10
   */
  maxPeers?: number;

  /**
   * Enable discv5 peer discovery.
   * @default true
   */
  discv5Enabled?: boolean;

  /**
   * ENR bootnodes for discv5 discovery.
   */
  discv5Bootnodes?: string[];
};

/**
 * Network components created for the light client.
 */
export type LightClientNetworkComponents = {
  libp2p: Libp2p;
  reqResp: ReqResp;
  gossip: Eth2Gossipsub;
  close: () => Promise<void>;
};

/**
 * Modules required to create network components.
 */
export type LightClientNetworkModules = {
  config: BeaconConfig;
  logger: Logger;
} & LightClientNetworkOpts;

/**
 * Create all network components needed for the P2P light client transport.
 *
 * This sets up:
 * 1. libp2p - base networking (connections, streams, encryption)
 * 2. req/resp - request/response protocols for fetching data
 * 3. gossipsub - pub/sub for receiving live updates
 * 4. discv5 - peer discovery (optional)
 */
export async function createLightClientNetworkComponents(
  modules: LightClientNetworkModules
): Promise<LightClientNetworkComponents> {
  const {config, logger, bootnodes, localMultiaddrs, privateKey, maxPeers, discv5Enabled, discv5Bootnodes} = modules;

  // 1. Create libp2p instance
  const libp2p = await createLightClientLibp2p({
    privateKey,
    localMultiaddrs: localMultiaddrs ?? ["/ip4/0.0.0.0/tcp/0"],
    bootnodes,
    maxPeers: maxPeers ?? 10,
    discv5Enabled: discv5Enabled ?? true,
    discv5Bootnodes: discv5Bootnodes ?? bootnodes,
    logger,
  });

  // 2. Create req/resp handler (for sending requests to peers)
  const reqResp = await createLightClientReqResp({
    libp2p,
    config,
    logger,
  });

  // 3. Create gossipsub (for subscribing to topics)
  const gossip = await createLightClientGossipsub({
    libp2p,
    config,
    logger,
  });

  // Start all components
  await libp2p.start();
  await reqResp.start();
  await gossip.start();

  logger.info("Light client network started", {
    peerId: libp2p.peerId.toString(),
    bootnodes: bootnodes.length,
  });

  return {
    libp2p,
    reqResp,
    gossip,
    close: async () => {
      logger.info("Stopping light client network");
      await gossip.stop();
      await reqResp.stop();
      await libp2p.stop();
    },
  };
}
