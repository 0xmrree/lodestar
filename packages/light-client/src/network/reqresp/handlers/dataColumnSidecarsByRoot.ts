import {PeerId} from "@libp2p/interface";
import {RespStatus, ResponseError, ResponseOutgoing} from "@lodestar/reqresp";
import {DataColumnSidecarsByRootRequest} from "@lodestar/beacon-node/util";
import {LC_RESOURCE_UNAVAILABLE} from "./constants.js";

export async function* onDataColumnSidecarsByRoot(
  requestBody: DataColumnSidecarsByRootRequest,
  peerId: PeerId,
  peerClient: string
): AsyncIterable<ResponseOutgoing> {
  throw new ResponseError(RespStatus.RESOURCE_UNAVAILABLE, LC_RESOURCE_UNAVAILABLE);
}
