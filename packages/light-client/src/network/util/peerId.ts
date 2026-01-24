import {PeerId, PrivateKey} from "@libp2p/interface";
import {peerIdFromPrivateKey} from "@libp2p/peer-id";
import {getV4Crypto} from "@chainsafe/enr";
import {Bytes32, fromHex} from "@lodestar/utils";

// Simple type alias - peer ID as string
export type PeerIdStr = string;

// uint256 in the spec - node ID for discv5
export type NodeId = Bytes32;

export function computeNodeIdFromPrivateKey(privateKey: PrivateKey): NodeId {
  const peerId = peerIdFromPrivateKey(privateKey);
  return computeNodeId(peerId);
}

export function computeNodeId(peerId: PeerId): Uint8Array {
  if (peerId.publicKey === undefined) {
    throw Error(`Undefined publicKey peerId=${peerId.toString()}`);
  }
  const nodeIdHex = getV4Crypto().nodeId(peerId.publicKey.raw);
  return fromHex(nodeIdHex);
}

/**
 * Pretty print a PeerId for logging
 */
export function prettyPrintPeerId(peerId: PeerId): string {
  const str = peerId.toString();
  return `${str.slice(0, 6)}...${str.slice(-6)}`;
}

/**
 * Pretty print a PeerId string for logging
 */
export function prettyPrintPeerIdStr(peerIdStr: string): string {
  return `${peerIdStr.slice(0, 6)}...${peerIdStr.slice(-6)}`;
}
