import path from "node:path";
import {getClient} from "@lodestar/api";
import {Lightclient} from "@lodestar/light-client";
import {createLightClientTransport} from "@lodestar/light-client/transport";
import {getNodeLogger} from "@lodestar/logger/node";
import {NetworkName, networksChainConfig} from "@lodestar/config/networks";
import {fromHex} from "@lodestar/utils";
import {getBeaconConfigFromArgs} from "../../config/beaconParams.js";
import {GlobalArgs} from "../../options/index.js";
import {getGlobalPaths} from "../../paths/global.js";
import {parseLoggerArgs} from "../../util/logger.js";
import {onGracefulShutdown} from "../../util/process.js";
import {ILightClientArgs} from "./options.js";

/**
 * Get genesis data for known networks.
 * This allows P2P mode to work without needing to fetch genesis from a beacon API.
 */
function getGenesisDataFromNetwork(network: string): {genesisTime: number; genesisValidatorsRoot: Uint8Array} {
  const chainConfig = networksChainConfig[network as NetworkName];
  if (!chainConfig) {
    throw new Error(`Unknown network "${network}". For custom networks, use --enableP2P=false with --beaconApiUrl`);
  }

  // Genesis validators root is stored in the network config
  const genesisValidatorsRoot = chainConfig.DEPOSIT_CONTRACT_ADDRESS
    ? fromHex(chainConfig.DEPOSIT_CONTRACT_ADDRESS)
    : new Uint8Array(32);

  // Genesis time - these are well-known for public networks
  // TODO: This should be part of the network config
  const genesisTimeByNetwork: Record<string, number> = {
    mainnet: 1606824023,
    sepolia: 1655733600,
    holesky: 1695902400,
  };

  const genesisTime = genesisTimeByNetwork[network];
  if (genesisTime === undefined) {
    throw new Error(`Genesis time not known for network "${network}". Use --enableP2P=false with --beaconApiUrl`);
  }

  return {genesisTime, genesisValidatorsRoot};
}

export async function lightclientHandler(args: ILightClientArgs & GlobalArgs): Promise<void> {
  const {config, network} = getBeaconConfigFromArgs(args);
  const globalPaths = getGlobalPaths(args, network);

  const logger = getNodeLogger(
    parseLoggerArgs(args, {defaultLogFilepath: path.join(globalPaths.dataDir, "lightclient.log")}, config)
  );

  // Prepare transport options based on enableP2P flag
  let genesisTime: number;
  let genesisValidatorsRoot: Uint8Array;
  let transportOpts;

  if (args.enableP2P) {
    if (!args.bootnodes || args.bootnodes.length === 0) {
      throw new Error("--bootnodes is required when using P2P mode");
    }

    const genesisData = getGenesisDataFromNetwork(network);
    genesisTime = genesisData.genesisTime;
    genesisValidatorsRoot = genesisData.genesisValidatorsRoot;

    transportOpts = {
      enableP2P: true as const,
      config,
      logger,
      networkOpts: {
        bootnodes: args.bootnodes,
      },
    };

    logger.info("Using P2P transport", {bootnodes: args.bootnodes.length});
  } else {
    if (!args.beaconApiUrl) {
      throw new Error("--beaconApiUrl is required when --enableP2P=false");
    }

    const api = getClient({baseUrl: args.beaconApiUrl}, {config});
    const genesisResponse = (await api.beacon.getGenesis()).value();
    genesisTime = genesisResponse.genesisTime;
    genesisValidatorsRoot = genesisResponse.genesisValidatorsRoot;

    transportOpts = {
      enableP2P: false as const,
      api,
    };

    logger.info("Using REST transport", {beaconApiUrl: args.beaconApiUrl});
  }

  const {transport, close} = await createLightClientTransport(transportOpts);

  const client = await Lightclient.initializeFromCheckpointRoot({
    config,
    logger,
    genesisData: {
      genesisTime,
      genesisValidatorsRoot,
    },
    checkpointRoot: fromHex(args.checkpointRoot),
    transport,
  });

  onGracefulShutdown(async () => {
    logger.info("Shutting down light client...");
    client.stop();
    await close();
  }, logger.info.bind(logger));

  void client.start();
}
