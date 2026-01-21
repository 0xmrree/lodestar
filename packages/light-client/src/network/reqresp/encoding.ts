/**
 * Req/resp encoding and decoding.
 *
 * Handles SSZ + Snappy encoding for req/resp messages.
 * Adapted from @lodestar/reqresp package.
 */

import {Stream} from "@libp2p/interface";
import snappy from "snappy";
import {BeaconConfig} from "@lodestar/config";
import {ResponseIncoming, ReqRespMethod} from "./index.js";

/** Response status codes per the spec */
const RESP_STATUS_SUCCESS = 0;
const RESP_STATUS_INVALID_REQUEST = 1;
const RESP_STATUS_SERVER_ERROR = 2;
const RESP_STATUS_RESOURCE_UNAVAILABLE = 3;

/** Size of the context bytes (fork digest) */
const CONTEXT_BYTES_LENGTH = 4;

/** Maximum response size (16 MB should be plenty for light client data) */
const MAX_RESPONSE_SIZE = 16 * 1024 * 1024;

/**
 * Encode a request body with SSZ + Snappy compression.
 *
 * Request format:
 * - SSZ-encoded request body
 * - Snappy compressed
 */
export async function encodeRequest(requestData: Uint8Array): Promise<Uint8Array> {
  if (requestData.length === 0) {
    // Empty request (e.g., for finality/optimistic update)
    return new Uint8Array(0);
  }

  // Snappy frame compression
  const compressed = await snappy.compress(requestData);
  return new Uint8Array(compressed);
}

/**
 * Decode response(s) from a stream.
 *
 * Response format (per chunk):
 * - 1 byte: status code (0 = success)
 * - 4 bytes: context bytes (fork digest) - only for success
 * - varint: length of compressed payload
 * - N bytes: snappy-compressed SSZ data
 *
 * Light client protocols may return multiple responses (e.g., LightClientUpdatesByRange).
 */
export async function* decodeResponse(
  stream: Stream,
  _config: BeaconConfig,
  method: ReqRespMethod
): AsyncIterable<ResponseIncoming> {
  const reader = readFromStream(stream);

  // Determine if this method returns multiple responses
  const isMultiResponse = method === "LightClientUpdatesByRange";

  try {
    while (true) {
      // Read status byte
      const statusByte = await reader.readByte();
      if (statusByte === null) {
        // End of stream
        break;
      }

      if (statusByte !== RESP_STATUS_SUCCESS) {
        // Error response - read error message
        const errorMsg = await readErrorMessage(reader);
        throw new Error(`Req/resp error (status ${statusByte}): ${errorMsg}`);
      }

      // Read context bytes (fork digest)
      const contextBytes = await reader.readBytes(CONTEXT_BYTES_LENGTH);
      if (contextBytes === null) {
        throw new Error("Unexpected end of stream reading context bytes");
      }

      // Read payload length (varint)
      const payloadLength = await readVarint(reader);
      if (payloadLength > MAX_RESPONSE_SIZE) {
        throw new Error(`Response payload too large: ${payloadLength}`);
      }

      // Read compressed payload
      const compressedPayload = await reader.readBytes(payloadLength);
      if (compressedPayload === null) {
        throw new Error("Unexpected end of stream reading payload");
      }

      // Decompress payload
      const data = await snappy.uncompress(compressedPayload);

      yield {
        contextBytes,
        data: new Uint8Array(data),
      };

      // For single-response methods, we're done after one response
      if (!isMultiResponse) {
        break;
      }
    }
  } finally {
    // Ensure we clean up the reader
  }
}

/**
 * Read error message from response.
 */
async function readErrorMessage(reader: StreamReader): Promise<string> {
  // Error format: varint length + UTF-8 string
  try {
    const length = await readVarint(reader);
    if (length > 1024) {
      return "<error message too long>";
    }
    const msgBytes = await reader.readBytes(length);
    if (msgBytes === null) {
      return "<error reading message>";
    }
    return new TextDecoder().decode(msgBytes);
  } catch {
    return "<error reading message>";
  }
}

/**
 * Read a varint from the stream.
 */
async function readVarint(reader: StreamReader): Promise<number> {
  let result = 0;
  let shift = 0;

  while (true) {
    const byte = await reader.readByte();
    if (byte === null) {
      throw new Error("Unexpected end of stream reading varint");
    }

    result |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) {
      return result;
    }

    shift += 7;
    if (shift > 35) {
      throw new Error("Varint too long");
    }
  }
}

/**
 * Helper for reading from a libp2p stream.
 */
interface StreamReader {
  readByte(): Promise<number | null>;
  readBytes(n: number): Promise<Uint8Array | null>;
}

function readFromStream(stream: Stream): StreamReader {
  const source = stream.source[Symbol.asyncIterator]();
  let buffer = new Uint8Array(0);
  let bufferOffset = 0;
  let done = false;

  async function ensureBuffer(needed: number): Promise<boolean> {
    while (bufferOffset + needed > buffer.length && !done) {
      const result = await source.next();
      if (result.done) {
        done = true;
        break;
      }

      // Append new data to buffer
      const newData = result.value.subarray();
      const newBuffer = new Uint8Array(buffer.length - bufferOffset + newData.length);
      newBuffer.set(buffer.subarray(bufferOffset));
      newBuffer.set(newData, buffer.length - bufferOffset);
      buffer = newBuffer;
      bufferOffset = 0;
    }

    return bufferOffset + needed <= buffer.length;
  }

  return {
    async readByte(): Promise<number | null> {
      if (!(await ensureBuffer(1))) {
        return null;
      }
      return buffer[bufferOffset++];
    },

    async readBytes(n: number): Promise<Uint8Array | null> {
      if (!(await ensureBuffer(n))) {
        return null;
      }
      const result = buffer.slice(bufferOffset, bufferOffset + n);
      bufferOffset += n;
      return result;
    },
  };
}
