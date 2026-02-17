import {RespStatus, ResponseError, ResponseOutgoing} from "@lodestar/reqresp";
import {altair} from "@lodestar/types";
import {LC_RESOURCE_UNAVAILABLE} from "./constants.js";

export async function* onLightClientUpdatesByRange(
  requestBody: altair.LightClientUpdatesByRange
): AsyncIterable<ResponseOutgoing> {
  throw new ResponseError(RespStatus.RESOURCE_UNAVAILABLE, LC_RESOURCE_UNAVAILABLE);
}
