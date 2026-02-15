import path from "node:path";
import type {PrivateKey} from "@libp2p/interface";
import {getClient} from "@lodestar/api";
import {Lightclient} from "@lodestar/light-client";
import {LightClientRestTransport} from "@lodestar/light-client/transport";
import {LoggerNode, getNodeLogger} from "@lodestar/logger/node";
import {fromHex} from "@lodestar/utils";
import {ChainForkConfig} from "@lodestar/config";
import {getBeaconConfigFromArgs} from "../../config/beaconParams.js";
import {GlobalArgs} from "../../options/index.js";
import {getGlobalPaths} from "../../paths/global.js";
import {parseLoggerArgs} from "../../util/logger.js";
import {initPrivateKeyAndEnr} from "../beacon/initPeerIdAndEnr.js";
import type {BeaconArgs} from "../beacon/options.js";
import {ILightClientArgs} from "./options.js";

export async function lightclientHandler(args: ILightClientArgs & GlobalArgs): Promise<void> {
  const {config, privateKey, logger} = await lightclientHandlerInit(args);

  const api = getClient({baseUrl: args.beaconApiUrl}, {config});
  const {genesisTime, genesisValidatorsRoot} = (await api.beacon.getGenesis()).value();

  // TODO: use privateKey and args.p2p to initialize P2P network and wire up a P2P transport
  void {privateKey, enabled: args.p2p !== false};

  const client = await Lightclient.initializeFromCheckpointRoot({
    config,
    logger,
    genesisData: {
      genesisTime,
      genesisValidatorsRoot,
    },
    checkpointRoot: fromHex(args.checkpointRoot),
    transport: new LightClientRestTransport(api),
  });

  void client.start();
}

/** Separate function to simplify unit testing of options merging */
export async function lightclientHandlerInit(
  args: ILightClientArgs & GlobalArgs
): Promise<{config: ChainForkConfig; privateKey: PrivateKey; logger: LoggerNode}> {
  const {config, network} = getBeaconConfigFromArgs(args);
  const globalPaths = getGlobalPaths(args, network);

  const logger = getNodeLogger(
    parseLoggerArgs(args, {defaultLogFilepath: path.join(globalPaths.dataDir, "lightclient.log")}, config)
  );

  // TODO: LC we should prob refactor the initPrivateKeyAndEnr input types to be more generic
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const {privateKey} = await initPrivateKeyAndEnr(args as unknown as BeaconArgs, globalPaths.dataDir, logger);

  return {config, privateKey, logger};
}
