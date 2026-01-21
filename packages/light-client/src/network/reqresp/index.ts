/**
 * Light client req/resp types.
 *
 * These define the interface the light client needs to send req/resp requests.
 * The actual implementation will be copied/adapted from beacon-node.
 */

import type {PeerId} from "@libp2p/interface";

/**
 * ReqResp method names for light client protocols.
 * These correspond to the Ethereum consensus spec req/resp protocols.
 */
export type ReqRespMethod =
  | "LightClientBootstrap"
  | "LightClientUpdatesByRange"
  | "LightClientFinalityUpdate"
  | "LightClientOptimisticUpdate";

/**
 * Response from a req/resp request.
 * Contains the raw SSZ data and context bytes (fork digest).
 */
export interface ResponseIncoming {
  /** Raw SSZ-encoded response data */
  data: Uint8Array;
  /** Context bytes containing fork digest for SSZ type selection */
  contextBytes: Uint8Array;
}

/**
 * Interface for sending req/resp requests.
 * The light client only sends requests (doesn't handle incoming requests).
 */
export interface ReqResp {
  /**
   * Send a request to a peer and iterate over responses.
   * Light client protocols may return single or multiple responses.
   */
  sendRequest(
    peer: PeerId,
    method: ReqRespMethod,
    requestData: Uint8Array
  ): AsyncIterable<ResponseIncoming>;
}
