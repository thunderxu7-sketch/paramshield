# September 7 local verification

Command: `pnpm verify` — **passed** on the revised workspace (Node 20.19.2, pnpm
10.34.5, Solidity 0.8.30). Format, lint, typecheck, automated tests and builds
ran. CI runs the same command without local integration credentials.

| Suite               | Passing tests | Scope                                                                                                                                            |
| ------------------- | ------------: | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Foundry             |            30 | v2 state/epoch/role/replay/hold guards, reference market, bootstrap, hash vector                                                                 |
| Shared schemas      |             8 | Strict versioned uint/intent/decision transport                                                                                                  |
| Risk engine         |            17 | Four-cell metrics, bounded search, 7942/7941, absolute cap with no solution, arithmetic/input limits                                             |
| Evidence            |             9 | Canonical/hash/receipt/state/privacy binding; graph-local cannot create executable preflight                                                     |
| Graph client        |            19 | Pinned complete pagination and RPC reconciliation; exact loopback reader, no credentials/URL bypass                                              |
| Web/runner/pre-sign |            23 | Isolated provider-policy construction, bounded subprocess/parsing, exact unsigned v2 call and failed-state/review/reorg guards (synthetic ports) |
| CRE product         |            14 | Private-policy-driven search, request/result binding, local preview restrictions, expiry/tampering, redacted handler/HTTP/secret boundary        |
| **Total**           |       **120** | Unit/contract/client tests, **not complete browser E2E**                                                                                         |

The Subgraph additionally completed `graph codegen && graph build` (WASM)
against the deployed v1 ABIs. The Next.js production scaffold built. Neither
fact proves that the end-to-end console is complete; the separate real local
index evidence below establishes only the local data-readiness milestone. The
previous web `--passWithNoTests` escape hatch was removed; all implemented TS
packages have actual tests rather than empty package placeholders.

## Separate real provider result

The [Privy control spike](privy-control-spike-2026-09-07.json) is **live**
provider evidence, not a mocked unit test: one allowed signed payload recovered
to the created test wallet, four forbidden mutations denied by Privy policy. It
did not broadcast a transaction, fund a wallet, assign executor roles, or prove
human approval/quorum. Its raw signed transaction is not published.

## Separate real local integration results

- [Local Graph live data](graph-local-live-v1.json): Graph Node v0.45.0 and
  pinned images; v1 deployment events, five positions and totals/config match
  the RPC at the same block/hash. Actual mapping/runtime proof, not synthetic
  HTTP. Source is `graph-local`; official/hosted index qualification remains
  unproven.
- [CRE product CLI preview](cre-local-graph-preview.json): actual compiled WASM,
  fresh Graph/RPC input per review, runtime demo secret, 7000 BLOCK with
  computed 7942 recommendation, independently reviewed 7942 ALLOW.
  Source/lock/WASM hashes and complete public result/request records are stored.
  No hardware TEE or executable approval is claimed.
- Local Compose startup/repeated deploy, healthy/synced status, redacted logging
  and restart preserving the existing index were checked. No chain transaction
  was sent and the Privy control/roles were not changed.

## Still not verified

- Hosted Graph deployment/query and new-event-to-analysis change (Studio API
  returned 503). The local index does not complete that gate.
- Live v2 CRE execution lane and durable trusted relay/real RPC and review-store
  adapters. Local product preview is verified separately, not a signing
  authority.
- Deployment of local v2 source, role separation onchain and real Privy
  execution.
- Runtime grounded AI, browser E2E, durable idempotency/recovery and three-run
  demo.
- Final prompt-artifact reconciliation, substantive human review and video.

The September 6 `deployments/sepolia.json` and `deployments/abi/` are unchanged.
The repository-local author config now uses the event GitHub account's verified
public noreply identity for new commits; no prior history was rewritten.
