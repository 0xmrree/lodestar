import {ForkBoundary} from "@lodestar/config";
import {CommitteeSubscription, SubnetsService} from "../subnets/interface.js";
import {RequestedSubnet} from "../peers/utils/index.js";

/**
 * No-op sync committee subnet service for the light client.
 *
 * The LC has no validator duties so it never subscribes to sync committee subnets.
 * getActiveSubnets() returning [] is safe: prioritizePeers() gates syncnet subnet-seeking
 * logic on `activeSyncnets.length > 0` (see prioritizePeers.ts:267), so empty arrays
 * simply skip all subnet peer queries.
 */
export const noopSyncnetsService: SubnetsService = {
  close: () => {},
  addCommitteeSubscriptions: (_subscriptions: CommitteeSubscription[]) => {},
  getActiveSubnets: (): RequestedSubnet[] => [],
  subscribeSubnetsNextBoundary: (_boundary: ForkBoundary) => {},
  unsubscribeSubnetsPrevBoundary: (_boundary: ForkBoundary) => {},
};
