import {ForkBoundary} from "@lodestar/config";
import {Slot, SubnetID} from "@lodestar/types";
import {CommitteeSubscription, IAttnetsService} from "../subnets/interface.js";
import {RequestedSubnet} from "../peers/utils/index.js";

/**
 * No-op attestation subnet service for the light client.
 *
 * The LC has no validator duties so it never subscribes to attestation subnets.
 * getActiveSubnets() returning [] is safe: prioritizePeers() gates attnet subnet-seeking
 * logic on `activeAttnets.length > 0` (see prioritizePeers.ts:241), so empty arrays
 * simply skip all subnet peer queries.
 */
export const noopAttnetsService: IAttnetsService = {
  close: () => {},
  addCommitteeSubscriptions: (_subscriptions: CommitteeSubscription[]) => {},
  getActiveSubnets: (): RequestedSubnet[] => [],
  subscribeSubnetsNextBoundary: (_boundary: ForkBoundary) => {},
  unsubscribeSubnetsPrevBoundary: (_boundary: ForkBoundary) => {},
  shouldProcess: (_subnet: SubnetID, _slot: Slot) => false,
};
