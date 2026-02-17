import {RespStatus, ResponseError, ResponseOutgoing} from "@lodestar/reqresp";
import {BlobSidecarsByRootRequest} from "@lodestar/beacon-node/util";
import {LC_RESOURCE_UNAVAILABLE} from "./constants.js";

export async function* onBlobSidecarsByRoot(
  requestBody: BlobSidecarsByRootRequest
): AsyncIterable<ResponseOutgoing> {
  throw new ResponseError(RespStatus.RESOURCE_UNAVAILABLE, LC_RESOURCE_UNAVAILABLE);
}
