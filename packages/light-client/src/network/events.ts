import {EventEmitter} from "node:events";
import {PeerId, TopicValidatorResult} from "@libp2p/interface";
import {CustodyIndex, Status} from "@lodestar/types";
import {StrictEventEmitterSingleArg} from "./util/strictEvents.js";
import {GossipTopic} from "./gossip/interface.js";

// Simple type alias - peer ID as string (light client doesn't need the full util)
type PeerIdStr = string;

/**
 * Simplified pending gossip message for light client
 * Light client only cares about light_client_finality_update and light_client_optimistic_update
 */
export type PendingGossipsubMessage = {
  topic: GossipTopic;
  msg: {topic: string; data: Uint8Array};
  msgId: string;
  propagationSource: PeerIdStr;
  seenTimestampSec: number;
  startProcessUnixSec: number | null;
};

/**
 * Simplified request container for light client
 * Light client is dial-only, so this is mainly for internal tracking
 */
export type RequestTypedContainer = {
  method: string;
  body: unknown;
};

export enum NetworkEvent {
  /** A relevant peer has connected or has been re-STATUS'd */
  peerConnected = "peer-manager.peer-connected",
  /** A peer has been disconnected */
  peerDisconnected = "peer-manager.peer-disconnected",
  reqRespRequest = "req-resp.request",

  // Network processor events
  /** (Network -> App) A gossip message is ready for validation */
  pendingGossipsubMessage = "gossip.pendingGossipsubMessage",
  /** (App -> Network) A gossip message has been validated */
  gossipMessageValidationResult = "gossip.messageValidationResult",
}

export type NetworkEventData = {
  [NetworkEvent.peerConnected]: {
    peer: PeerIdStr;
    status: Status;
    custodyColumns: CustodyIndex[];
    clientAgent: string;
  };
  [NetworkEvent.peerDisconnected]: {peer: PeerIdStr};
  [NetworkEvent.reqRespRequest]: {request: RequestTypedContainer; peer: PeerId; peerClient: string};
  [NetworkEvent.pendingGossipsubMessage]: PendingGossipsubMessage;
  [NetworkEvent.gossipMessageValidationResult]: {
    msgId: string;
    propagationSource: PeerIdStr;
    acceptance: TopicValidatorResult;
  };
};

export enum EventDirection {
  workerToMain,
  mainToWorker,
  /** Event not emitted through worker boundary */
  none,
}

export const networkEventDirection: Record<NetworkEvent, EventDirection> = {
  [NetworkEvent.peerConnected]: EventDirection.workerToMain,
  [NetworkEvent.peerDisconnected]: EventDirection.workerToMain,
  [NetworkEvent.reqRespRequest]: EventDirection.none, // Only used internally in NetworkCore
  [NetworkEvent.pendingGossipsubMessage]: EventDirection.workerToMain,
  [NetworkEvent.gossipMessageValidationResult]: EventDirection.mainToWorker,
};

export type INetworkEventBus = StrictEventEmitterSingleArg<NetworkEventData>;

export class NetworkEventBus extends (EventEmitter as {new (): INetworkEventBus}) {}
