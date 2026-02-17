import {RespStatus, ResponseError, ResponseOutgoing} from "@lodestar/reqresp";
import {BlobSidecarsByRootRequest} from "../../../util/types.js";
import {LC_RESOURCE_UNAVAILABLE} from "./constants.js";

export async function* onBlobSidecarsByRoot(
  requestBody: BlobSidecarsByRootRequest
): AsyncIterable<ResponseOutgoing> {
  throw new ResponseError(RespStatus.RESOURCE_UNAVAILABLE, LC_RESOURCE_UNAVAILABLE);
}
