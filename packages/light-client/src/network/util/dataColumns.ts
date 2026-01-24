import {digest} from "@chainsafe/as-sha256";
import {ChainForkConfig} from "@lodestar/config";
import {NUMBER_OF_COLUMNS} from "@lodestar/params";
import {ColumnIndex, CustodyIndex, ssz} from "@lodestar/types";
import {bytesToBigInt} from "@lodestar/utils";
import {NodeId} from "./peerId.js";

/**
 * Computes the column indices for a given custody group index
 *
 * SPEC FUNCTION
 * https://github.com/ethereum/consensus-specs/blob/v1.6.0-alpha.4/specs/fulu/das-core.md#compute_columns_for_custody_group
 */
export function computeColumnsForCustodyGroup(config: ChainForkConfig, custodyIndex: CustodyIndex): ColumnIndex[] {
  if (custodyIndex >= config.NUMBER_OF_CUSTODY_GROUPS) {
    throw Error(`Invalid custody index ${custodyIndex} >= ${config.NUMBER_OF_CUSTODY_GROUPS}`);
  }
  const columnsPerCustodyGroup = Number(NUMBER_OF_COLUMNS / config.NUMBER_OF_CUSTODY_GROUPS);
  const columnIndexes = [];
  for (let i = 0; i < columnsPerCustodyGroup; i++) {
    columnIndexes.push(config.NUMBER_OF_CUSTODY_GROUPS * i + custodyIndex);
  }
  columnIndexes.sort((a, b) => a - b);
  return columnIndexes;
}

/**
 * Converts nodeId and a the number of custody groups to an array of custody indices. Indexes must be
 * further converted to column indices
 *
 * SPEC FUNCTION
 * https://github.com/ethereum/consensus-specs/blob/v1.6.0-alpha.4/specs/fulu/das-core.md#get_custody_groups
 */
export function getCustodyGroups(config: ChainForkConfig, nodeId: NodeId, custodyGroupCount: number): CustodyIndex[] {
  if (custodyGroupCount > config.NUMBER_OF_CUSTODY_GROUPS) {
    throw Error(`Invalid custody group count ${custodyGroupCount} > ${config.NUMBER_OF_CUSTODY_GROUPS}`);
  }

  // Skip computation if all groups are custodied
  if (custodyGroupCount === config.NUMBER_OF_CUSTODY_GROUPS) {
    return Array.from({length: config.NUMBER_OF_CUSTODY_GROUPS}, (_, i) => i);
  }

  const custodyGroups: CustodyIndex[] = [];
  // nodeId is in bigendian and all computes are in little endian
  let currentId = bytesToBigInt(nodeId, "be");
  while (custodyGroups.length < custodyGroupCount) {
    // could be optimized
    const currentIdBytes = ssz.UintBn256.serialize(currentId);
    const custodyGroup = Number(
      ssz.UintBn64.deserialize(digest(currentIdBytes).slice(0, 8)) % BigInt(config.NUMBER_OF_CUSTODY_GROUPS)
    );

    if (!custodyGroups.includes(custodyGroup)) {
      custodyGroups.push(custodyGroup);
    }

    const willOverflow = currentIdBytes.reduce((acc, elem) => acc && elem === 0xff, true);
    if (willOverflow) {
      currentId = BigInt(0);
    } else {
      currentId++;
    }
  }

  custodyGroups.sort((a, b) => a - b);
  return custodyGroups;
}

/**
 * Get the data columns for a node based on its nodeId and custody group count
 */
export function getDataColumns(config: ChainForkConfig, nodeId: NodeId, custodyGroupCount: number): ColumnIndex[] {
  return getCustodyGroups(config, nodeId, custodyGroupCount)
    .flatMap((custodyIndex) => computeColumnsForCustodyGroup(config, custodyIndex))
    .sort((a, b) => a - b);
}
