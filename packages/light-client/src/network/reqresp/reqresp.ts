/**
 * Light client req/resp implementation.
 *
 * Handles sending req/resp requests to peers for light client protocols.
 * Adapted from beacon-node but simplified - only sends requests, doesn't handle incoming.
 */

import {PeerId, Stream} from "@libp2p/interface";
import {BeaconConfig} from "@lodestar/config";
import {Logger} from "@lodestar/utils";
import {Libp2p} from "../interface.js";
import {ReqResp, ReqRespMethod, ResponseIncoming} from "./index.js";
import {encodeRequest, decodeResponse} from "./encoding.js";

/**
 * Protocol IDs for light client req/resp methods.
 * Format: /eth2/beacon_chain/req/{method}/{version}/{encoding}
 */
const PROTOCOL_PREFIX = "/eth2/beacon_chain/req";
const ENCODING = "ssz_snappy";
const VERSION = 1;

const PROTOCOL_IDS: Record<ReqRespMethod, string> = {
  LightClientBootstrap: `${PROTOCOL_PREFIX}/light_client_bootstrap/${VERSION}/${ENCODING}`,
  LightClientUpdatesByRange: `${PROTOCOL_PREFIX}/light_client_updates_by_range/${VERSION}/${ENCODING}`,
  LightClientFinalityUpdate: `${PROTOCOL_PREFIX}/light_client_finality_update/${VERSION}/${ENCODING}`,
  LightClientOptimisticUpdate: `${PROTOCOL_PREFIX}/light_client_optimistic_update/${VERSION}/${ENCODING}`,
};

export type LightClientReqRespOpts = {
  libp2p: Libp2p;
  config: BeaconConfig;
  logger: Logger;
};

/**
 * Light client req/resp handler.
 *
 * Only implements the client side - sending requests and receiving responses.
 * Does NOT handle incoming requests (light clients don't serve data).
 */
export class LightClientReqResp implements ReqResp {
  private readonly libp2p: Libp2p;
  private readonly config: BeaconConfig;
  private readonly logger: Logger;
  private started = false;

  constructor(opts: LightClientReqRespOpts) {
    this.libp2p = opts.libp2p;
    this.config = opts.config;
    this.logger = opts.logger;
  }

  async start(): Promise<void> {
    if (this.started) return;
    // Light client doesn't register handlers - only sends requests
    this.started = true;
    this.logger.debug("Light client req/resp started");
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;
    this.logger.debug("Light client req/resp stopped");
  }

  /**
   * Send a request to a peer and iterate over responses.
   *
   * Light client protocols:
   * - LightClientBootstrap: single response
   * - LightClientUpdatesByRange: multiple responses (one per period)
   * - LightClientFinalityUpdate: single response
   * - LightClientOptimisticUpdate: single response
   */
  async *sendRequest(
    peer: PeerId,
    method: ReqRespMethod,
    requestData: Uint8Array
  ): AsyncIterable<ResponseIncoming> {
    const protocolId = PROTOCOL_IDS[method];

    this.logger.debug("Sending req/resp request", {
      method,
      peer: peer.toString(),
      protocolId,
    });

    let stream: Stream | undefined;

    try {
      // Open a stream to the peer on this protocol
      stream = await this.libp2p.dialProtocol(peer, protocolId);

      // Encode and send the request
      const encodedRequest = await encodeRequest(requestData);
      await this.writeToStream(stream, encodedRequest);

      // Signal end of request (half-close)
      await stream.closeWrite();

      // Read and decode responses
      yield* decodeResponse(stream, this.config, method);

      this.logger.debug("Req/resp request completed", {method, peer: peer.toString()});
    } catch (e) {
      this.logger.error("Req/resp request failed", {method, peer: peer.toString()}, e as Error);
      throw e;
    } finally {
      // Clean up the stream
      if (stream) {
        try {
          await stream.close();
        } catch {
          // Ignore close errors
        }
      }
    }
  }

  /**
   * Write data to a stream.
   */
  private async writeToStream(stream: Stream, data: Uint8Array): Promise<void> {
    const writer = stream.sink;
    await writer([data]);
  }
}

/**
 * Create a light client req/resp handler.
 */
export async function createLightClientReqResp(opts: LightClientReqRespOpts): Promise<LightClientReqResp> {
  return new LightClientReqResp(opts);
}
