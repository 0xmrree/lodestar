import {PeerId} from "@libp2p/interface";
import {BeaconConfig} from "@lodestar/config";
import {GENESIS_SLOT, isForkPostDeneb} from "@lodestar/params";
import {RespStatus, ResponseError, ResponseOutgoing} from "@lodestar/reqresp";
import {deneb, phase0} from "@lodestar/types";
import {LC_RESOURCE_UNAVAILABLE} from "./constants.js";

export async function* onBeaconBlocksByRange(
  request: phase0.BeaconBlocksByRangeRequest,
  peerId: PeerId,
  peerClient: string,
  config: BeaconConfig
): AsyncIterable<ResponseOutgoing> {
  validateBeaconBlocksByRangeRequest(config, request);
  throw new ResponseError(RespStatus.RESOURCE_UNAVAILABLE, LC_RESOURCE_UNAVAILABLE);
}

export function validateBeaconBlocksByRangeRequest(
  config: BeaconConfig,
  request: phase0.BeaconBlocksByRangeRequest
): deneb.BlobSidecarsByRangeRequest {
  const {startSlot} = request;
  let {count} = request;

  if (count < 1) {
    throw new ResponseError(RespStatus.INVALID_REQUEST, "count < 1");
  }
  // TODO: validate against MIN_EPOCHS_FOR_BLOCK_REQUESTS
  if (startSlot < GENESIS_SLOT) {
    throw new ResponseError(RespStatus.INVALID_REQUEST, "startSlot < genesis");
  }

  // step > 1 is deprecated, see https://github.com/ethereum/consensus-specs/pull/2856

  const maxRequestBlocks = isForkPostDeneb(config.getForkName(startSlot))
    ? config.MAX_REQUEST_BLOCKS_DENEB
    : config.MAX_REQUEST_BLOCKS;

  if (count > maxRequestBlocks) {
    count = maxRequestBlocks;
  }

  return {startSlot, count};
}
