import {ProtocolHandler, ReqRespRequest} from "@lodestar/reqresp";

// Re-export all protocol types from @lodestar/reqresp/protocols
export {
  BeaconBlocksByRootRequest,
  BeaconBlocksByRootRequestType,
  BlobSidecarsByRootRequest,
  BlobSidecarsByRootRequestType,
  DataColumnSidecarsByRootRequest,
  DataColumnSidecarsByRootRequestType,
  ProtocolNoHandler,
  ReqRespMethod,
  RequestBodyByMethod,
  RequestTypedContainer,
  ResponseTypeGetter,
  Version,
  requestSszTypeByMethod,
  responseSszTypeByMethod,
} from "@lodestar/reqresp/protocols";

import {ReqRespMethod} from "@lodestar/reqresp/protocols";

// Local types specific to beacon-node

export type OutgoingRequestArgs = {
  peerId: string;
  method: ReqRespMethod;
  versions: number[];
  requestData: Uint8Array;
};

export type IncomingRequestArgs = {
  method: ReqRespMethod;
  req: ReqRespRequest;
  peerId: string;
  peerClient: string;
};

export type GetReqRespHandlerFn = (method: ReqRespMethod) => ProtocolHandler;
