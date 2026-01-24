import {ContainerType, ListCompositeType, ValueOf} from "@chainsafe/ssz";
import {BeaconConfig} from "@lodestar/config";
import {ForkName, isForkPostDeneb, isForkPostElectra} from "@lodestar/params";
import {ssz} from "@lodestar/types";

// Misc SSZ types used for reqresp

export const BeaconBlocksByRootRequestType = (fork: ForkName, config: BeaconConfig) =>
  new ListCompositeType(ssz.Root, isForkPostDeneb(fork) ? config.MAX_REQUEST_BLOCKS_DENEB : config.MAX_REQUEST_BLOCKS);
export type BeaconBlocksByRootRequest = ValueOf<ReturnType<typeof BeaconBlocksByRootRequestType>>;

export const BlobSidecarsByRootRequestType = (fork: ForkName, config: BeaconConfig) =>
  new ListCompositeType(
    ssz.deneb.BlobIdentifier,
    isForkPostElectra(fork) ? config.MAX_REQUEST_BLOB_SIDECARS_ELECTRA : config.MAX_REQUEST_BLOB_SIDECARS
  );
export type BlobSidecarsByRootRequest = ValueOf<ReturnType<typeof BlobSidecarsByRootRequestType>>;

export const DataColumnSidecarsByRootRequestType = (config: BeaconConfig) =>
  new ListCompositeType(ssz.fulu.DataColumnsByRootIdentifier, config.MAX_REQUEST_BLOCKS_DENEB);
export type DataColumnSidecarsByRootRequest = ValueOf<ReturnType<typeof DataColumnSidecarsByRootRequestType>>;
