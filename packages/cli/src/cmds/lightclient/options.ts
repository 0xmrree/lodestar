import {CliCommandOptions} from "@lodestar/utils";
import {LogArgs, logOptions} from "../../options/logOptions.js";

export type ILightClientArgs = LogArgs & {
  enableP2P: boolean;
  beaconApiUrl?: string;
  checkpointRoot: string;
  bootnodes?: string[];
};

export const lightclientOptions: CliCommandOptions<ILightClientArgs> = {
  ...logOptions,
  enableP2P: {
    description: "Use P2P networking instead of REST API",
    type: "boolean",
    default: true,
  },
  beaconApiUrl: {
    description: "Url to a beacon node that supports lightclient API (required when --enableP2P=false)",
    type: "string",
  },
  checkpointRoot: {
    description: "Checkpoint root hex string to sync the lightclient from, start with 0x",
    type: "string",
    demandOption: true,
  },
  bootnodes: {
    description: "Bootnodes for P2P discovery (multiaddr or ENR format)",
    type: "array",
    string: true,
    default: [],
  },
};
