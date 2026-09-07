# ParamShield Implementation Plan

**Updated:** 2026-09-07 (Asia/Shanghai). Public execution plan; full planning
artifact and material prompt record are in [planning](planning/README.md).

## Scope and status rules

P0: one LT change, one stress, live Graph input, confidential policy/search,
Privy control, exact guarded Sepolia execution, evidence, grounded AI, one
console. Defer history, IPFS, second stress, extra markets, and rich quorum UX.

`Complete` needs a command/result or chain/provider artifact. Account setup,
local tests, live reads, and live execution are independent gates. Empty
packages and `--passWithNoTests` do not count as tested implementations.

## Ordered execution queue

| ID / priority | Task                                                               | Depends on                     | Acceptance                                                                                                                    | Status                                      |
| ------------- | ------------------------------------------------------------------ | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| R-01 / P0     | Correct policy, privacy, trust, evidence and schedule specs        | Review approved                | Public complete plan, ADR, prompt record; no stale 78% promise                                                                | Complete                                    |
| R-02 / P0     | Implement bigint risk engine and bounded private search            | R-01                           | Four-cell metrics; 7942 passes/7941 fails; absolute cap has no solution; rounding/boundary/invalid tests                      | Complete (local)                            |
| R-03 / P0     | Implement versioned acyclic evidence and exact intent hash         | R-01                           | Deterministic serialization; tamper/privacy rejection; TS/Solidity hash parity                                                | Complete (structural verification)          |
| R-04 / P0     | Harden local v2 contracts                                          | R-03                           | Any risk-state change or authorization rotation invalidates old intent; separate roles; replay/hold tests                     | Complete (local; not deployed)              |
| R-05 / P0     | Index existing Sepolia v1 and consume complete live Graph snapshot | Deployed v1, R-02              | Pinned block/hash, all pages/totals, live query changes input, freshness failures tested                                      | Built/tested; live login/deployment pending |
| R-06 / P0     | Verify actual Privy wallet and enforceable control                 | Existing account/SDK           | Isolated test wallet; allowed request and denied request with sanitized evidence, no signing keys in output                   | Complete (isolated sign-only control proof) |
| R-07 / P0     | Product CRE handler and trusted relay                              | R-02, R-03, R-05               | Secret loaded inside handler, recomputation/search there; real CLI run; validated relay bindings, timeout/tamper rejection    | Pending                                     |
| R-08 / P0     | Review and deploy v2, connect distinct roles                       | R-04, R-06, transaction review | New manifest/ABIs, explorer verification, public source revision; old v1 artifacts preserved                                  | Pending                                     |
| R-09 / P0     | First full controlled execution                                    | R-05 through R-08              | BLOCK old intent; new nonce/review; Privy-controlled real Sepolia update; exact receipt/state/evidence                        | Pending                                     |
| R-10 / P0     | One console, durable timeline, grounded risk Q&A                   | R-03, R-09                     | Source-linked numbers, unavailable-AI fallback, refresh/idempotency/recovery tests                                            | Pending                                     |
| R-11 / P0     | Freeze, adversarial regression, repeatable demo                    | R-09, R-10                     | Three successful complete runs; stale/version/epoch, timeout, duplicate, bad payload, policy-denial, receipt-failure coverage | Pending                                     |
| R-12 / P0     | Submission artifacts and demo video                                | R-11                           | All actual specs/prompts/plans, AI/human contribution log; reproducible setup; real narration, 2–4min, ≥720p                  | Pending                                     |
| R-13 / P0     | Submit daytime, reserve evening buffer                             | R-12                           | Dashboard submission confirmed before official deadline                                                                       | Pending                                     |

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

- Graph account access ≠ deployed index. Missing live Graph data blocks live
  claims; fixtures remain labelled unit-test fixtures and cannot authorize.
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
- Subgraph schema and mappings compile against the existing v1 ABI; live
  deployment/runtime reconciliation is not yet proven.
- [Privy provider evidence](evidence/privy-control-spike-2026-09-07.json): one
  recovered signature, four provider policy denials, no broadcast or funding.
- Separate local v2 changes preserve the historical Sepolia manifest and ABIs.
- Final E2E, runtime AI and CRE product/relay gates remain pending. Public
  prompt artifact reconciliation and substantive human review remain submission
  gates.
