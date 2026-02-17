import type {BeaconConfig} from "@lodestar/config";
import {ZERO_HASH} from "@lodestar/params";
import {phase0} from "@lodestar/types";

/**
 * Returns a genesis-pinned Status for use in req/resp.
 * Per the LC spec, light clients should advertise genesis finalized root/epoch/slot
 * to limit the chance peers call us for data we can't serve.
 * - as per https://github.com/ethereum/consensus-specs/blob/master/specs/altair/light-client/p2p-interface.md?plain=1#L340
 */
export function getGenesisStatus(config: BeaconConfig): phase0.Status {
  const phase0Boundary = config.getForkBoundaryAtEpoch(0);
  const forkDigest = config.forkBoundary2ForkDigest(phase0Boundary);

  return {
    forkDigest,
    finalizedRoot: ZERO_HASH,
    finalizedEpoch: 0,
    headRoot: ZERO_HASH,
    headSlot: 0,
  };
}
