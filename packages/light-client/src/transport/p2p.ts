import type {PrivateKey} from "@libp2p/interface";
import type {ForkName} from "@lodestar/params";
import type {
  LightClientBootstrap,
  LightClientFinalityUpdate,
  LightClientOptimisticUpdate,
  LightClientUpdate,
  SyncPeriod,
} from "@lodestar/types";
import type {LightClientP2PConfig} from "../lightClientOptions.js";
import type {LightClientTransport} from "./interface.js";

export class LightClientP2PTransport implements LightClientTransport {
  // TODO: Replace LightClientP2PConfig with NetworkOptions from @lodestar/beacon-node/network.
  // LightClientP2PConfig only has discv5/multiaddr/version — it needs to be converted to a full
  // NetworkOptions (with peer counts, gossipsub settings, reqresp settings, etc.) before being
  // passed into LightClientNetwork.init(). At that point, lightClientOptions.ts can be removed.
  constructor(
    private readonly privateKey: PrivateKey,
    private readonly options: LightClientP2PConfig
  ) {}

  getUpdates(
    _startPeriod: SyncPeriod,
    _count: number
  ): Promise<{version: ForkName; data: LightClientUpdate}[]> {
    throw new Error("LightClientP2PTransport: getUpdates not yet implemented");
  }

  getOptimisticUpdate(): Promise<{version: ForkName; data: LightClientOptimisticUpdate}> {
    throw new Error("LightClientP2PTransport: getOptimisticUpdate not yet implemented");
  }

  getFinalityUpdate(): Promise<{version: ForkName; data: LightClientFinalityUpdate}> {
    throw new Error("LightClientP2PTransport: getFinalityUpdate not yet implemented");
  }

  getBootstrap(_blockRoot: string): Promise<{version: ForkName; data: LightClientBootstrap}> {
    throw new Error("LightClientP2PTransport: getBootstrap not yet implemented");
  }

  onOptimisticUpdate(_handler: (optimisticUpdate: LightClientOptimisticUpdate) => void): void {
    throw new Error("LightClientP2PTransport: onOptimisticUpdate not yet implemented");
  }

  onFinalityUpdate(_handler: (finalityUpdate: LightClientFinalityUpdate) => void): void {
    throw new Error("LightClientP2PTransport: onFinalityUpdate not yet implemented");
  }
}
