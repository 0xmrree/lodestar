import {ApiClient} from "@lodestar/api";
import {BeaconConfig} from "@lodestar/config";
import {Logger} from "@lodestar/utils";
import {LightClientTransport} from "./interface.js";
import {LightClientRestTransport} from "./rest.js";
import {LightClientP2PTransport, LightClientP2PTransportOpts} from "./p2p.js";
import {createLightClientNetworkComponents, LightClientNetworkOpts} from "../network/index.js";

/**
 * Options for creating a light client transport.
 */
export type LightClientTransportOpts = {
  /**
   * Enable P2P transport instead of REST.
   * When true, the light client will connect to the Ethereum P2P network directly.
   * When false (default), it will connect to a beacon node REST API.
   */
  enableP2P?: boolean;
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
 * Factory function to create a light client transport.
 *
 */
export async function createLightClientTransport(modules: TransportModules): Promise<TransportResult> {
  if (modules.enableP2P) {
    // P2P transport - need to initialize networking stack
    const {config, logger, networkOpts, transportOpts} = modules;

    // Create libp2p, reqresp, gossip components
    const networkComponents = await createLightClientNetworkComponents({
      config,
      logger,
      ...networkOpts,
    });

    const transport = new LightClientP2PTransport(
      {
        config,
        logger,
        libp2p: networkComponents.libp2p,
        reqResp: networkComponents.reqResp,
        gossip: networkComponents.gossip,
      },
      transportOpts
    );

    return {
      transport,
      close: async () => {
        await networkComponents.close();
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
