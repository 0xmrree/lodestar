import worker from "node:worker_threads";
import {privateKeyFromProtobuf} from "@libp2p/crypto/keys";
import {peerIdFromPrivateKey} from "@libp2p/peer-id";
import {Multiaddr, multiaddr} from "@multiformats/multiaddr";
import {Discv5, Discv5EventEmitter} from "@chainsafe/discv5";
import {ENR, ENRData, SignableENR, SignableENRData} from "@chainsafe/enr";
import {Observable, Subject} from "@chainsafe/threads/observable";
import {expose} from "@chainsafe/threads/worker";
import {createBeaconConfig} from "@lodestar/config";
import {getNodeLogger} from "@lodestar/logger/node";
import {Clock} from "../utils/clock.js";
import {Discv5WorkerApi, Discv5WorkerData} from "./types.js";
import {ENRRelevance, enrRelevance} from "./utils.js";

// This discv5 worker will start discv5 on initialization (there is no `start` function to call)
// A consumer _should_ call `close` before terminating the worker to cleanly exit discv5 before destroying the thread
// A `setEnrValue` function is also provided to update the host ENR key-values shared in the discv5 network.

// Cloned data from instatiation
const workerData = worker.workerData as Discv5WorkerData;
if (!workerData) throw Error("workerData must be defined");

const logger = getNodeLogger(workerData.loggerOpts);

// Note: Light client doesn't use metrics in the discv5 worker
// If metrics are needed in the future, they can be added back

const privateKey = privateKeyFromProtobuf(workerData.privateKeyProto);
const peerId = peerIdFromPrivateKey(privateKey);

// TODO(light-client): chainConfig, genesisValidatorsRoot, and genesisTime come from
// the light client's trusted bootstrap/checkpoint sync, not from a full beacon chain.
// The light client should obtain these values from its initialization parameters.
const config = createBeaconConfig(workerData.chainConfig, workerData.genesisValidatorsRoot);

// Initialize discv5
const discv5 = Discv5.create({
  enr: SignableENR.decodeTxt(workerData.enr, privateKey.raw),
  privateKey,
  bindAddrs: {
    ip4: (workerData.bindAddrs.ip4 ? multiaddr(workerData.bindAddrs.ip4) : undefined) as Multiaddr,
    ip6: workerData.bindAddrs.ip6 ? multiaddr(workerData.bindAddrs.ip6) : undefined,
  },
  config: workerData.config,
  // Light client doesn't use metrics
  metricsRegistry: undefined,
}) as Discv5 & Discv5EventEmitter;

// Load boot enrs
for (const bootEnr of workerData.bootEnrs) {
  discv5.addEnr(bootEnr);
}

/** Used to push discovered ENRs */
const subject = new Subject<ENRData>();

/** Define a new clock */
const abortController = new AbortController();
const clock = new Clock({config, genesisTime: workerData.genesisTime, signal: abortController.signal});

const onDiscovered = (enr: ENR): void => {
  const status = enrRelevance(enr, config, clock);
  // Note: Light client doesn't track metrics for enr relevance
  if (status === ENRRelevance.relevant) {
    subject.next(enr.toObject());
  }
};
discv5.addListener("discovered", onDiscovered);

// Discv5 will now begin accepting request/responses
await discv5.start();

const module: Discv5WorkerApi = {
  async enr(): Promise<SignableENRData> {
    return discv5.enr.toObject();
  },
  async setEnrValue(key: string, value: Uint8Array): Promise<void> {
    discv5.enr.set(key, value);
  },
  async kadValues(): Promise<ENRData[]> {
    return discv5.kadValues().map((enr: ENR) => enr.toObject());
  },
  async discoverKadValues(): Promise<void> {
    discv5.kadValues().map(onDiscovered);
  },
  async findRandomNode(): Promise<ENRData[]> {
    return (await discv5.findRandomNode()).map((enr: ENR) => enr.toObject());
  },
  discovered() {
    return Observable.from(subject);
  },
  async scrapeMetrics(): Promise<string> {
    // Light client doesn't collect metrics
    return "";
  },
  writeProfile: async (_durationMs: number, _dirpath: string) => {
    // Light client doesn't support profiling in discv5 worker
    return "";
  },
  writeHeapSnapshot: async (_prefix: string, _dirpath: string) => {
    // Light client doesn't support heap snapshots in discv5 worker
    return "";
  },
  async close() {
    abortController.abort();
    discv5.removeListener("discovered", onDiscovered);
    subject.complete();
    await discv5.stop();
  },
};

expose(module);

const logData: Record<string, string> = {
  peerId: peerId.toString(),
  initialENR: workerData.enr,
};

if (workerData.bindAddrs.ip4) logData.bindAddr4 = workerData.bindAddrs.ip4;
if (workerData.bindAddrs.ip6) logData.bindAddr6 = workerData.bindAddrs.ip6;

logger.info("discv5 worker started", logData);
