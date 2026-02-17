import {ProtocolHandler} from "@lodestar/reqresp";
import {BeaconConfig} from "@lodestar/config";
import {ssz} from "@lodestar/types";
import {GetReqRespHandlerFn, ReqRespMethod} from "@lodestar/beacon-node/network";
import {
  BeaconBlocksByRootRequestType,
  BlobSidecarsByRootRequestType,
  DataColumnSidecarsByRootRequestType,
} from "@lodestar/beacon-node/util";
import {onBeaconBlocksByRange} from "./beaconBlocksByRange.js";
import {onBeaconBlocksByRoot} from "./beaconBlocksByRoot.js";
import {onBlobSidecarsByRange} from "./blobSidecarsByRange.js";
import {onBlobSidecarsByRoot} from "./blobSidecarsByRoot.js";
import {onDataColumnSidecarsByRange} from "./dataColumnSidecarsByRange.js";
import {onDataColumnSidecarsByRoot} from "./dataColumnSidecarsByRoot.js";
import {onLightClientBootstrap} from "./lightClientBootstrap.js";
import {onLightClientFinalityUpdate} from "./lightClientFinalityUpdate.js";
import {onLightClientOptimisticUpdate} from "./lightClientOptimisticUpdate.js";
import {onLightClientUpdatesByRange} from "./lightClientUpdatesByRange.js";

export {LC_RESOURCE_UNAVAILABLE} from "./constants.js";

function notImplemented(method: ReqRespMethod): ProtocolHandler {
  return () => {
    throw Error(`Handler not implemented for ${method}`);
  };
}

export function getLightClientReqRespHandlers(config: BeaconConfig): GetReqRespHandlerFn {
  const handlers: Record<ReqRespMethod, ProtocolHandler> = {
    [ReqRespMethod.Status]: notImplemented(ReqRespMethod.Status),
    [ReqRespMethod.Goodbye]: notImplemented(ReqRespMethod.Goodbye),
    [ReqRespMethod.Ping]: notImplemented(ReqRespMethod.Ping),
    [ReqRespMethod.Metadata]: notImplemented(ReqRespMethod.Metadata),
    [ReqRespMethod.BeaconBlocksByRange]: (req, peerId, peerClient) => {
      const body = ssz.phase0.BeaconBlocksByRangeRequest.deserialize(req.data);
      return onBeaconBlocksByRange(body, peerId, peerClient, config);
    },
    [ReqRespMethod.BeaconBlocksByRoot]: (req) => {
      const fork = config.getForkName(0);
      const body = BeaconBlocksByRootRequestType(fork, config).deserialize(req.data);
      return onBeaconBlocksByRoot(body);
    },
    [ReqRespMethod.BlobSidecarsByRoot]: (req) => {
      const fork = config.getForkName(0);
      const body = BlobSidecarsByRootRequestType(fork, config).deserialize(req.data);
      return onBlobSidecarsByRoot(body);
    },
    [ReqRespMethod.BlobSidecarsByRange]: (req) => {
      const body = ssz.deneb.BlobSidecarsByRangeRequest.deserialize(req.data);
      return onBlobSidecarsByRange(body, config);
    },
    [ReqRespMethod.DataColumnSidecarsByRange]: (req, peerId, peerClient) => {
      const body = ssz.fulu.DataColumnSidecarsByRangeRequest.deserialize(req.data);
      return onDataColumnSidecarsByRange(body, peerId, peerClient, config);
    },
    [ReqRespMethod.DataColumnSidecarsByRoot]: (req, peerId, peerClient) => {
      const body = DataColumnSidecarsByRootRequestType(config).deserialize(req.data);
      return onDataColumnSidecarsByRoot(body, peerId, peerClient);
    },
    [ReqRespMethod.LightClientBootstrap]: (req) => {
      const body = ssz.Root.deserialize(req.data);
      return onLightClientBootstrap(body);
    },
    [ReqRespMethod.LightClientUpdatesByRange]: (req) => {
      const body = ssz.altair.LightClientUpdatesByRange.deserialize(req.data);
      return onLightClientUpdatesByRange(body);
    },
    [ReqRespMethod.LightClientFinalityUpdate]: () => onLightClientFinalityUpdate(),
    [ReqRespMethod.LightClientOptimisticUpdate]: () => onLightClientOptimisticUpdate(),
  };

  return (method) => handlers[method];
}
