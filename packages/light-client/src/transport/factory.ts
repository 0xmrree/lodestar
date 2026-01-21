import {noise} from "@chainsafe/libp2p-noise";
import {mplex} from "@libp2p/mplex";
import {tcp} from "@libp2p/tcp";
import {bootstrap} from "@libp2p/bootstrap";
import {createLibp2p, Libp2p} from "libp2p";
import {ApiClient} from "@lodestar/api";
import {BeaconConfig} from "@lodestar/config";
import {Logger} from "@lodestar/utils";
import {LightClientTransport} from "./interface.js";
import {LightClientRestTransport} from "./rest.js";
import {LightClientP2PTransport, LightClientP2PTransportOpts} from "./p2p.js";

/**
 * Options for P2P network.
 */
export type LightClientNetworkOpts = {
  /** Bootstrap node multiaddrs to connect to */
  bootnodes: string[];
  /** Local multiaddrs to listen on */
  localMultiaddrs?: string[];
  /** Maximum number of peers */
  maxPeers?: number;
};

/**
 * Modules required for REST transport.
 */
export type RestTransportModules = {
  api: ApiClient;
};

/**
 * Modules required for P2P transport.
 */
export type P2PTransportModules = {
  config: BeaconConfig;
  logger: Logger;
  networkOpts: LightClientNetworkOpts;
  transportOpts?: LightClientP2PTransportOpts;
};

/**
 * Combined modules - provide either REST or P2P modules depending on enableP2P flag.
 */
export type TransportModules =
  | ({enableP2P?: false} & RestTransportModules)
  | ({enableP2P: true} & P2PTransportModules);

/**
 * Result of creating a transport - includes the transport and a cleanup function.
 */
export type TransportResult = {
  transport: LightClientTransport;
  /** Call to clean up network resources (only needed for P2P) */
  close: () => Promise<void>;
};

/**
 * Create a libp2p instance for light client networking.
 */
async function createLightClientLibp2p(opts: LightClientNetworkOpts, logger: Logger): Promise<Libp2p> {
  const {bootnodes, localMultiaddrs = ["/ip4/0.0.0.0/tcp/0"], maxPeers = 50} = opts;

  logger.debug("Creating light client libp2p", {
    localMultiaddrs: localMultiaddrs.join(", "),
    bootnodes: bootnodes.length,
    maxPeers,
  });

  const libp2p = await createLibp2p({
    addresses: {
      listen: localMultiaddrs,
    },
    transports: [tcp()],
    connectionEncrypters: [noise()],
    streamMuxers: [mplex()],
    peerDiscovery: bootnodes.length > 0 ? [bootstrap({list: bootnodes})] : [],
    connectionManager: {
      maxConnections: maxPeers,
    },
  });

  return libp2p;
}

/**
 * Factory function to create a light client transport.
 */
export async function createLightClientTransport(modules: TransportModules): Promise<TransportResult> {
  if (modules.enableP2P) {
    // P2P transport - need to initialize networking stack
    const {config, logger, networkOpts, transportOpts} = modules;

    // Create libp2p
    const libp2p = await createLightClientLibp2p(networkOpts, logger);
    await libp2p.start();

    const transport = new LightClientP2PTransport(
      {
        config,
        logger,
        libp2p,
      },
      transportOpts
    );

    // Start the transport (initializes reqresp)
    await transport.start();

    return {
      transport,
      close: async () => {
        await transport.stop();
        await libp2p.stop();
      },
    };
  } else {
    // REST transport - simple, just wrap the API client
    const transport = new LightClientRestTransport(modules.api);

    return {
      transport,
      close: async () => {
        // REST transport doesn't need cleanup
      },
    };
  }
}
