# ParamShield Implementation Plan

**Updated:** 2026-09-08 (Asia/Shanghai). Public execution plan; full planning
artifact and material prompt record are in [planning](planning/README.md).

## Scope and status rules

P0: one LT change, one stress, live Graph input, confidential policy/search,
Privy control, exact guarded Sepolia execution, evidence, grounded AI, one
console. Defer history, IPFS, second stress, extra markets, and rich quorum UX.

`Complete` needs a command/result or chain/provider artifact. Account setup,
local tests, live reads, and live execution are independent gates. Empty
packages and `--passWithNoTests` do not count as tested implementations.

## Ordered execution queue

| ID / priority | Task                                                               | Depends on                     | Acceptance                                                                                                                    | Status                                                      |
| ------------- | ------------------------------------------------------------------ | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| R-01 / P0     | Correct policy, privacy, trust, evidence and schedule specs        | Review approved                | Public complete plan, ADR, prompt record; no stale 78% promise                                                                | Complete                                                    |
| R-02 / P0     | Implement bigint risk engine and bounded private search            | R-01                           | Four-cell metrics; 7942 passes/7941 fails; absolute cap has no solution; rounding/boundary/invalid tests                      | Complete (local)                                            |
| R-03 / P0     | Implement versioned acyclic evidence and exact intent hash         | R-01                           | Deterministic serialization; tamper/privacy rejection; TS/Solidity hash parity                                                | Complete (structural verification)                          |
| R-04 / P0     | Harden local v2 contracts                                          | R-03                           | Any risk-state change or authorization rotation invalidates old intent; separate roles; replay/hold tests                     | Complete (local; not deployed)                              |
| R-05 / P0     | Index existing Sepolia v1 and consume complete live Graph snapshot | Deployed v1, R-02              | Pinned block/hash, all pages/totals, live query changes input, freshness failures tested                                      | Hosted v1 verified; new-event demonstration pending         |
| R-06 / P0     | Verify actual Privy wallet and enforceable control                 | Existing account/SDK           | Isolated test wallet; allowed request and denied request with sanitized evidence, no signing keys in output                   | Complete (isolated sign-only control proof)                 |
| R-07 / P0     | Product CRE handler and trusted relay                              | R-02, R-03, R-05               | Secret loaded inside handler, recomputation/search there; real CLI run; validated relay bindings, timeout/tamper rejection    | Actual CLI/Anvil relay verified; live hosted v2 pending     |
| R-08 / P0     | Review and deploy v2, connect distinct roles                       | R-04, R-06, transaction review | New manifest/ABIs, explorer verification, public source revision; old v1 artifacts preserved                                  | Bootstrap/ABI/budget prepared; roles and deployment pending |
| R-09 / P0     | First full controlled execution                                    | R-05 through R-08              | BLOCK old intent; new nonce/review; Privy-controlled real Sepolia update; exact receipt/state/evidence                        | Pending                                                     |
| R-10 / P0     | One console, durable timeline, grounded risk Q&A                   | R-03, R-09                     | Source-linked numbers, unavailable-AI fallback, refresh/idempotency/recovery tests                                            | Pending                                                     |
| R-11 / P0     | Freeze, adversarial regression, repeatable demo                    | R-09, R-10                     | Three successful complete runs; stale/version/epoch, timeout, duplicate, bad payload, policy-denial, receipt-failure coverage | Pending                                                     |
| R-12 / P0     | Submission artifacts and demo video                                | R-11                           | All actual specs/prompts/plans, AI/human contribution log; reproducible setup; real narration, 2–4min, ≥720p                  | Pending                                                     |
| R-13 / P0     | Submit daytime, reserve evening buffer                             | R-12                           | Dashboard submission confirmed before official deadline                                                                       | Pending                                                     |

## Critical path

`policy + evidence interfaces -> live snapshot -> confidential result/relay -> guarded v2 + Privy -> first real transaction -> console/AI -> regression -> video`.

A local v1 Graph read is a **data-readiness milestone**, not permission to
execute with v2 preconditions on a v1 contract. Reindex/version endpoint config
when v2 is deployed; reject a manifest/ABI/snapshot version mismatch.

## Calendar (China time; targets, not completion claims)

- **Sep 7:** R-01–R-04 core invariants, R-05 live Graph, R-06 early wallet
  control.
- **Sep 8:** finish evidence interfaces and CRE/relay integration choice;
  resolve any provider blockers before investing in UI. Review v2 deployment
  payload.
- **Sep 9–10:** R-07–R-10 first complete BLOCK → new review → real execution;
  minimal console and grounded AI. Host the runner with bounded concurrency,
  durable records, explicit simulator status, and no arbitrary shell payloads.
- **Sep 11:** feature freeze; R-11 regression, approved reset/re-provisioning,
  recovery and repeated demo. No new historical replay or second scenario.
- **Sep 12:** docs, final sponsor evidence, real-narrated video, submission
  ready.
- **Sep 13 daytime:** submit; evening is only recovery buffer.
- **Hard deadline:** Sep 14 00:00 Asia/Shanghai = Sep 13 12:00 EDT.

## External gates and fallbacks

- Graph account access ≠ deployed index. After the September 7 HTTP 503 and
  September 8 connectivity recovery, the user confirmed the connection terms;
  authenticated Studio deployment and a fresh hosted v1 read now passed.
  [The v1 record](evidence/graph-studio-deployment-2026-09-08.json) is separate
  from the still-valid `graph-local` fallback. Both remain non-executable v1
  data-readiness evidence. The Studio development endpoint is rate-limited and
  has not been published to The Graph Network. New-event-to-analysis, hosted v2
  and sponsor qualification are still separate gates; no alternate provider
  account has been created.
- CRE private-beta network access is optional for the selected CLI lane; record
  simulation honestly. A mock result or isolated template is not product
  integration.
- Privy authentication ≠ control. Verify a policy-bound test wallet first; do
  not invent quorum availability or weaken execution just to show a transaction.
- Contract revision needs a new reviewed deployment. Never overwrite old ABIs or
  report local v2 protections as already active on Sepolia.
- Provider outage never changes BLOCK/ESCALATE into ALLOW. Re-run with a fresh
  snapshot/nonce after recovery; do not reuse stale approval.

## Submission gates

The three selected partners are The Graph (AI tooling/use case), Chainlink
(Confidential Workflow), and Privy (B2B financial product). Qualification is
subject to their current rules and judging, not guaranteed by this plan.

Track meaningful human product decisions and actual review/narration separately
from AI-generated implementation. Never mark human review complete based only on
automated tests. Keep personal account data, keys, and unrelated private project
material out of public artifacts.

## September 7 verification record

- Risk/evidence/shared/client and local contract tests run through
  `pnpm verify`.
- Local Graph Node v0.45.0 indexed the deployed v1 events; all five positions,
  totals and config were RPC-corroborated at the indexed block/hash.
  [Local live evidence](evidence/graph-local-live-v1.json) does not claim a
  hosted index or a new-event-to-analysis test.
- [Privy provider evidence](evidence/privy-control-spike-2026-09-07.json): one
  recovered signature, four provider policy denials, no broadcast or funding.
- Separate local v2 changes preserve the historical Sepolia manifest and ABIs.
- [Actual product CRE/WASM preview](evidence/cre-local-graph-preview.json): 7000
  BLOCK → computed 7942 → independent fresh-input ALLOW, all non-executable.
  Runtime secret delivery, bounded process/output, strict binding and failure
  tests are implemented; CLI is not a hardware TEE.
- Server-side unsigned-call preparation has synthetic v2/approval-port tests.
  Reviewed v2 deployment, real RPC/identity adapters, final Privy policy and
  live signing/broadcast remain unimplemented gates, not inferred from those
  tests.
- `pnpm verify`: 120 passing tests plus format/lint/types/build. Final E2E,
  runtime AI, durable relay, public prompt reconciliation, human review and
  video remain pending.

## September 8 verification record

- Separate v2 bootstrap, deployment script and candidate ABIs are prepared;
  [preparation report](../deployments/v2/preparation.json) retains null final
  roles/payload and explicitly reports no deployment. Read-only Sepolia checks
  confirm v1 remains at LT 8000 and is rejected by the v2 adapter.
- Real RPC and authenticated EIP-712 review adapters, owned CRE execution
  runner, exact Privy policy/transaction checks, durable sign-only idempotency
  and nonce reservations are implemented. They do not expose an authenticated
  public API or implement transaction broadcasting/receipt recovery yet.
- [Actual Privy control](evidence/privy-v2-control-2026-09-08.json): all signed
  transaction fields verified, 13 provider denials; isolated, unfunded, no
  roles.
- [Actual CRE/Anvil relay](evidence/relay-anvil-only-2026-09-08.json): 12
  checks, BLOCK / ALLOW, persisted signature review, local sign-only idempotency
  and real epoch rotation rejection. Synthetic Graph-shaped test envelope is
  explicitly not hosted Graph; no public Sepolia or execute transaction sent.
- Following the user's action-time connection confirmation, Studio login and
  authenticated deployment of `paramshield-sepolia-v-1` version `v0.1.0`
  succeeded. Studio reported DEPLOYED / SYNCED / 100%; the hosted query at block
  11660066 reconciled all five positions/config/totals against RPC, with an
  8-second block age and zero block lag at validation. The live snapshot fed the
  7000/15%-stress calculation, not a fixture. See
  [hosted query evidence](evidence/graph-live-v1.json). No new Sepolia event, v2
  index, network publication or execution is inferred from this result.

- Local format/lint/types and production build passed; the complete 150-test set
  passed with Turbo concurrency 1 after two host-load/default-timeout failures
  in the first parallel run. Default test timeouts and all product
  freshness/signing controls remain unchanged. See the
  [exact validation record](execution-service.md#local-verification-record).
