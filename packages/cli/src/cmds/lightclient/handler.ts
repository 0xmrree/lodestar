import path from "node:path";
import type {PrivateKey} from "@libp2p/interface";
import {getClient} from "@lodestar/api";
import {Lightclient, type LightClientP2PConfig} from "@lodestar/light-client";
import {LightClientRestTransport, LightClientP2PTransport, LightClientTransport} from "@lodestar/light-client/transport";
import {LoggerNode, getNodeLogger} from "@lodestar/logger/node";
import {fromHex} from "@lodestar/utils";
import {ChainForkConfig} from "@lodestar/config";
import {getBeaconConfigFromArgs} from "../../config/beaconParams.js";
import {GlobalArgs} from "../../options/index.js";
import {getGlobalPaths} from "../../paths/global.js";
import {parseLoggerArgs} from "../../util/logger.js";
import {getVersionData} from "../../util/version.js";
import {initPrivateKeyAndEnr} from "../beacon/initPeerIdAndEnr.js";
import type {BeaconArgs} from "../beacon/options.js";
import {defaultListenAddress, defaultP2pPort} from "../../options/beaconNodeOptions/network.js";
import {getNetworkBootnodes, isKnownNetworkName} from "../../networks/index.js";
import {ILightClientArgs} from "./options.js";

export async function lightclientHandler(args: ILightClientArgs & GlobalArgs): Promise<void> {
  const {config, p2pConfig, privateKey, logger} = await lightclientHandlerInit(args);

  let transport: LightClientTransport;
  let genesisTime: number;
  let genesisValidatorsRoot: Uint8Array;

  if (args.p2p === true) {
    transport = new LightClientP2PTransport(privateKey, p2pConfig);
    // TODO: read genesisTime and genesisValidatorsRoot from network config.yaml instead of hardcoding
    genesisTime = 1606824023; // mainnet
    genesisValidatorsRoot = fromHex("0x4b363db94e286120d76eb905340fdd4e54bfe9f06bf33ff6cf5ad27f511bfe95");
  } else {
    const api = getClient({baseUrl: args.beaconApiUrl}, {config});
    ({genesisTime, genesisValidatorsRoot} = (await api.beacon.getGenesis()).value());
    transport = new LightClientRestTransport(api);
  }

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

  void client.start();
}

/** Separate function to simplify unit testing of options merging */
export async function lightclientHandlerInit(
  args: ILightClientArgs & GlobalArgs
): Promise<{config: ChainForkConfig; p2pConfig: LightClientP2PConfig; privateKey: PrivateKey; logger: LoggerNode}> {
  const {config, network} = getBeaconConfigFromArgs(args);
  const globalPaths = getGlobalPaths(args, network);

  const logger = getNodeLogger(
    parseLoggerArgs(args, {defaultLogFilepath: path.join(globalPaths.dataDir, "lightclient.log")}, config)
  );

  // TODO: LC we should prob refactor the initPrivateKeyAndEnr input types to be more generic
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const {privateKey, enr} = await initPrivateKeyAndEnr(args as unknown as BeaconArgs, globalPaths.dataDir, logger);

  const {version} = getVersionData();

  const listenAddress = args.listenAddress ?? defaultListenAddress;
  const port = args.port ?? defaultP2pPort;
  const discoveryPort = args.discoveryPort ?? port;

  const bootEnrs = isKnownNetworkName(network) ? await getNetworkBootnodes(network) : [];

  const p2pConfig: LightClientP2PConfig = {
    discv5: {
      enr: enr.encodeTxt(),
      bindAddrs: {ip4: `/ip4/${listenAddress}/udp/${discoveryPort}`},
      bootEnrs,
      config: {enrUpdate: !enr.ip && !enr.ip6},
    },
    localMultiaddrs: [`/ip4/${listenAddress}/tcp/${port}`], // only for libp2p req resp / gossip - dsicv5 is seperate
    version: `LodestarLightClient/${version}`,
  };

  return {config, p2pConfig, privateKey, logger};
}
