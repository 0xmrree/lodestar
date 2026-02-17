import {RespStatus, ResponseError, ResponseOutgoing} from "@lodestar/reqresp";
import {LC_RESOURCE_UNAVAILABLE} from "./constants.js";

export async function* onLightClientOptimisticUpdate(): AsyncIterable<ResponseOutgoing> {
  throw new ResponseError(RespStatus.RESOURCE_UNAVAILABLE, LC_RESOURCE_UNAVAILABLE);
}
