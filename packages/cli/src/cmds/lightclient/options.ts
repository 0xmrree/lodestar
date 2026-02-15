import {CliCommandOptions} from "@lodestar/utils";
import {LogArgs, logOptions} from "../../options/logOptions.js";
import {defaultListenAddress, defaultP2pPort} from "../../options/beaconNodeOptions/network.js";

export type ILightClientArgs = LogArgs & {
  beaconApiUrl: string;
  checkpointRoot: string;
  p2p?: boolean;
  listenAddress?: string;
  port?: number;
  discoveryPort?: number;
};

export const lightclientOptions: CliCommandOptions<ILightClientArgs> = {
  ...logOptions,
  beaconApiUrl: {
    description: "Url to a beacon node that support lightclient API",
    type: "string",
    demandOption: true,
  },
  checkpointRoot: {
    description: "Checkpoint root hex string to sync the lightclient from, start with 0x",
    type: "string",
    demandOption: true,
  },
  p2p: {
    description: "Enable P2P networking",
    type: "boolean",
  },
  listenAddress: {
    type: "string",
    description: "The IPv4 address to listen for p2p UDP and TCP connections",
    defaultDescription: defaultListenAddress,
    group: "network",
  },
  port: {
    type: "number",
    description: "The TCP/UDP port to listen on",
    defaultDescription: String(defaultP2pPort),
    group: "network",
  },
  discoveryPort: {
    type: "number",
    description: "The UDP port that discovery will listen on. Defaults to `port`",
    defaultDescription: "`port`",
    group: "network",
  },
};
