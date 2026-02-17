import {RespStatus, ResponseError, ResponseOutgoing} from "@lodestar/reqresp";
import {BeaconBlocksByRootRequest} from "../../../util/types.js";
import {LC_RESOURCE_UNAVAILABLE} from "./constants.js";

export async function* onBeaconBlocksByRoot(
  requestBody: BeaconBlocksByRootRequest,
): AsyncIterable<ResponseOutgoing> {
  throw new ResponseError(RespStatus.RESOURCE_UNAVAILABLE, LC_RESOURCE_UNAVAILABLE);
}
