# Light Client Network Decoupling Status

This document tracks the progress of removing beacon-node dependencies from the copied network code.

## ⚠️ SESSION STATUS: INCOMPLETE

**This work is incomplete and may need to be started fresh.**

The approach taken was to copy the entire `beacon-node/src/network/` directory and then systematically remove beacon-node dependencies. While significant progress was made, there are still many files with broken imports and the code does not compile.

**Key insight for next attempt**: The beacon-node networking code is very tightly coupled. A cleaner approach might be to:
1. Start with minimal files (just what light client needs)
2. Use `@lodestar/reqresp` and `@chainsafe/libp2p-gossipsub` directly
3. Only copy specific utilities as needed

**What was attempted**:
- Remove all metrics
- Replace NetworkEventBus with callbacks
- Create local copies of utilities (Clock, peerId, dataColumns, etc.)
- Replace ReqRespBeaconNode with ReqRespLightClient that extends base ReqResp
- Remove SubnetsService (light client doesn't need attestation/sync subnets)

## Deleted Directories/Files
- [x] `processor/` - Gossip handlers, heavily coupled to IBeaconChain
- [x] `reqresp/handlers/` - Request handlers, light client is dial-only
- [x] `core/` - Network core with metrics and worker threading
- [x] `subnets/` - Attestation/sync committee subnet management
- [x] `gossip/metrics.ts` - Gossip metrics
- [x] `reqresp/utils/dataColumnResponseValidation.ts` - Data column validation
- [x] `reqresp/ReqRespBeaconNode.ts` - Replaced with ReqRespLightClient

## Created Local Utilities (in `utils/` and `util/`)
- [x] `utils/clock.ts` - Clock and IClock for slot timing (copied from beacon-node)
- [x] `utils/eventLoop.ts` - callInNextEventLoop, nextEventLoop
- [x] `utils/strictEvents.ts` - StrictEventEmitterSingleArg type helper
- [x] `util/peerId.ts` - NodeId, computeNodeId, prettyPrintPeerId utilities
- [x] `util/dataColumns.ts` - getCustodyGroups, computeColumnsForCustodyGroup (spec functions)
- [x] `util/types.ts` - SSZ types for reqresp (BeaconBlocksByRootRequestType, etc.)
- [x] `util/shuffle.ts` - shuffle, shuffleOne utilities
- [x] `util/sortBy.ts` - sortBy utility
- [x] `constants.ts` - GoodByeReasonCode, GOODBYE_KNOWN_CODES, Libp2pEvent

## New Files Created
- [x] `reqresp/ReqRespLightClient.ts` - Light client specific ReqResp extending base `@lodestar/reqresp`
  - Only implements light client methods (bootstrap, updates, finality, optimistic)
  - Dial-only: does not handle incoming requests
  - No metrics collection
  - Simplified peer scoring integration

## Fixed Files

### Completed
- [x] `gossip/interface.ts` - Removed IBeaconChain, created local GossipAction/GossipActionError types
- [x] `gossip/topic.ts` - Uses local imports from interface.ts
- [x] `gossip/gossipsub.ts` - Removed metrics, replaced NetworkEventBus with callbacks
- [x] `discv5/worker.ts` - Uses local Clock, removed metrics and profiling
- [x] `discv5/utils.ts` - Uses local IClock
- [x] `events.ts` - Uses local types, simplified PendingGossipsubMessage
- [x] `util.ts` - Fixed import path for PeerIdStr
- [x] `peers/peersData.ts` - Uses local NodeId from util/peerId.ts
- [x] `peers/discover.ts` - Updated imports to use local utils
- [x] `peers/score/interface.ts` - Uses local constants
- [x] `peers/score/store.ts` - Fixed imports
- [x] `peers/score/score.ts` - Fixed imports
- [x] `peers/utils/prioritizePeers.ts` - Fixed imports (shuffle, sortBy)
- [x] `reqresp/types.ts` - Uses local util/types.ts
- [x] `reqresp/index.ts` - Exports ReqRespLightClient instead of ReqRespBeaconNode

### In Progress
- [ ] `peers/peerManager.ts` - Needs SubnetsService removed, simplify for light client
  - Updated interface to `IReqRespLightClientPeerManager`
  - Commented out attnetsService, syncnetsService in PeerManagerModules
  - Still needs:
    - Remove SubnetsService private fields and constructor assignments
    - Remove NetworkCoreMetrics references
    - Simplify heartbeat logic (no attestation/sync subnet management)

### Remaining Work
- [ ] `peers/utils/assertPeerRelevance.ts` - May need light client specific peer relevance logic
- [ ] `peers/utils/getConnectedPeerIds.ts` - Verify imports
- [ ] `reqresp/utils/collect.ts` - Has SerializedCache import to fix
- [ ] `reqresp/utils/collectSequentialBlocksInRange.ts` - Has SerializedCache import to fix
- [ ] `options.ts` - References deleted files
- [ ] `index.ts` - References deleted files

## Key Decisions

### ReqRespLightClient Architecture
Created `ReqRespLightClient` that extends the base `ReqResp` class from `@lodestar/reqresp`:
- **Dial-only**: Uses `registerDialOnlyProtocol()` - doesn't handle incoming requests
- **Light client methods**: Only implements `sendLightClientBootstrap`, `sendLightClientUpdatesByRange`, `sendLightClientFinalityUpdate`, `sendLightClientOptimisticUpdate`
- **Basic protocols**: Also implements `sendStatus`, `sendGoodbye`, `sendPing`, `sendMetadata` for peer management
- **No handlers**: Light client doesn't serve data to other peers

### Peer Relevance for Light Client
Light client needs different peer relevance criteria than beacon-node:
- Beacon-node checks: fork digest, finalized root, clock, attestation subnets
- Light client should check: fork digest, clock, supports light client protocols

**TODO**: Add placeholder in `peers/utils/assertPeerRelevance.ts` for light client specific logic.

### Gossipsub Events
Replaced NetworkEventBus with simple callbacks:
- `onGossipMessage?: GossipMessageHandler` callback in Eth2GossipsubModules
- Call `reportValidationResult()` method directly instead of event emission

### Chain State for Discv5
Light client obtains chainConfig, genesisValidatorsRoot, genesisTime from:
- Trusted bootstrap/checkpoint sync (not from a running beacon chain)
- These values are passed to Discv5WorkerData same as beacon-node

### SubnetsService Removal
Light client doesn't need attestation/sync committee subnet management:
- Remove attnetsService, syncnetsService from PeerManagerModules
- Simplify heartbeat to only manage general peer count, not subnet-specific peers
- Remove subnet queries from discovery

## Components Status Summary

| Component | Status | Notes |
|-----------|--------|-------|
| ReqResp | REPLACED | New `ReqRespLightClient` extends base class |
| Peer Scoring | KEEP | Required for peer management |
| Metrics | REMOVED | Not needed for MVP |
| Topic Caching | KEEP | GossipTopicCache is useful |
| Message Validation | SIMPLIFIED | Removed processor/, keep basic deserialize |
| Event System | SIMPLIFIED | Replaced with callbacks |
| IBeaconChain | REMOVED | Fixed in gossip/interface.ts |
| SubnetsService | TO REMOVE | Not needed for light client |
| Clock | LOCAL COPY | Copied to utils/clock.ts |
| NodeId utils | LOCAL COPY | Copied to util/peerId.ts |

## Progress Log

### Session 1
- Copied network directory from beacon-node
- Deleted processor/, reqresp/handlers/, core/, subnets/, gossip/metrics.ts
- Fixed gossip/interface.ts - removed IBeaconChain, created local error types
- Fixed gossip/topic.ts - use local imports
- Identified remaining dependencies to fix

### Session 2
- Created local utilities: Clock, eventLoop, strictEvents, peerId, dataColumns, types, shuffle, sortBy
- Created constants.ts with GoodByeReasonCode, GOODBYE_KNOWN_CODES, Libp2pEvent
- Fixed gossip/gossipsub.ts - removed metrics, simplified to use callbacks
- Fixed discv5/worker.ts - uses local Clock, removed metrics/profiling
- Fixed events.ts - uses local types
- Fixed multiple files' import paths (peersData, discover, score/store, score/score, prioritizePeers)
- Created `ReqRespLightClient.ts` extending base `@lodestar/reqresp` ReqResp class
- Deleted `ReqRespBeaconNode.ts`
- Updated peerManager.ts interface naming and commented out SubnetsService

## Next Steps

1. **Complete peerManager.ts simplification**:
   - Remove SubnetsService private fields
   - Remove metrics references
   - Simplify heartbeat (no subnet management)

2. **Fix remaining import errors**:
   - reqresp/utils/collect.ts - SerializedCache
   - reqresp/utils/collectSequentialBlocksInRange.ts - SerializedCache
   - options.ts, index.ts

3. **Test compilation**:
   - Run TypeScript compiler to find remaining issues
   - Fix any remaining import errors

4. **Integration**:
   - Wire up ReqRespLightClient to P2P transport layer
   - Test with actual P2P network

## Files Structure After Decoupling

```
packages/light-client/src/network/
├── constants.ts                    # Local constants (GoodByeReasonCode, etc.)
├── events.ts                       # Simplified event types
├── interface.ts                    # Libp2p interface
├── util.ts                         # Connection utilities
├── utils/
│   ├── clock.ts                    # Clock for slot timing
│   ├── eventLoop.ts                # Event loop utilities
│   ├── index.ts                    # Exports
│   └── strictEvents.ts             # Event type helper
├── util/
│   ├── peerId.ts                   # NodeId, PeerId utilities
│   ├── dataColumns.ts              # Custody group calculations
│   ├── types.ts                    # SSZ types for reqresp
│   ├── shuffle.ts                  # Array shuffle
│   └── sortBy.ts                   # Sort utility
├── discv5/
│   ├── index.ts
│   ├── types.ts
│   ├── utils.ts                    # ENR relevance (uses local Clock)
│   └── worker.ts                   # Discv5 worker (uses local Clock, no metrics)
├── gossip/
│   ├── constants.ts
│   ├── encoding.ts
│   ├── gossipsub.ts                # Simplified (no metrics, callbacks instead of events)
│   ├── interface.ts                # Local GossipAction/GossipActionError types
│   ├── scoringParameters.ts
│   └── topic.ts
├── peers/
│   ├── client.ts
│   ├── discover.ts
│   ├── peersData.ts
│   ├── peerManager.ts              # Needs SubnetsService removal
│   ├── score/
│   │   ├── constants.ts
│   │   ├── index.ts
│   │   ├── interface.ts
│   │   ├── score.ts
│   │   ├── store.ts
│   │   └── utils.ts
│   └── utils/
│       ├── assertPeerRelevance.ts
│       ├── enrSubnetsDeserialize.ts
│       ├── getConnectedPeerIds.ts
│       ├── index.ts
│       ├── prioritizePeers.ts
│       └── subnetMap.ts
└── reqresp/
    ├── index.ts
    ├── interface.ts
    ├── protocols.ts
    ├── ReqRespLightClient.ts       # NEW: Light client specific ReqResp
    ├── score.ts
    ├── types.ts
    └── utils/
        ├── collect.ts              # Needs SerializedCache fix
        └── collectSequentialBlocksInRange.ts  # Needs SerializedCache fix
```
