# ParamShield Implementation Plan

**Updated:** 2026-09-09 (Asia/Shanghai). Public execution plan; full planning
artifact and material prompt record are in [planning](planning/README.md).

## Scope and status rules

P0: one LT change, one stress, live Graph input, confidential policy/search,
Privy control, exact guarded Sepolia execution, evidence, grounded AI, one
console. Defer history, IPFS, second stress, extra markets, and rich quorum UX.

`Complete` needs a command/result or chain/provider artifact. Account setup,
local tests, live reads, and live execution are independent gates. Empty
packages and `--passWithNoTests` do not count as tested implementations.

## Ordered execution queue

| ID / priority | Task                                                               | Depends on                     | Acceptance                                                                                                                    | Status                                                        |
| ------------- | ------------------------------------------------------------------ | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| R-01 / P0     | Correct policy, privacy, trust, evidence and schedule specs        | Review approved                | Public complete plan, ADR, prompt record; no stale 78% promise                                                                | Complete                                                      |
| R-02 / P0     | Implement bigint risk engine and bounded private search            | R-01                           | Four-cell metrics; 7942 passes/7941 fails; absolute cap has no solution; rounding/boundary/invalid tests                      | Complete (local)                                              |
| R-03 / P0     | Implement versioned acyclic evidence and exact intent hash         | R-01                           | Deterministic serialization; tamper/privacy rejection; TS/Solidity hash parity                                                | Complete (structural verification)                            |
| R-04 / P0     | Harden local v2 contracts                                          | R-03                           | Any risk-state change or authorization rotation invalidates old intent; separate roles; replay/hold tests                     | Complete (deployed as separate v2)                            |
| R-05 / P0     | Index existing Sepolia v1 and consume complete live Graph snapshot | Deployed v1, R-02              | Pinned block/hash, all pages/totals, live query changes input, freshness failures tested                                      | Hosted v1 + v2 verified; post-execution event proof pending   |
| R-06 / P0     | Verify actual Privy wallet and enforceable control                 | Existing account/SDK           | Isolated test wallet; allowed request and denied request with sanitized evidence, no signing keys in output                   | Complete (isolated sign-only control proof)                   |
| R-07 / P0     | Product CRE handler and trusted relay                              | R-02, R-03, R-05               | Secret loaded inside handler, recomputation/search there; real CLI run; validated relay bindings, timeout/tamper rejection    | Actual hosted-v2 CLI + local lifecycle verified               |
| R-08 / P0     | Review and deploy v2, connect distinct roles                       | R-04, R-06, transaction review | New manifest/ABIs, explorer verification, public source revision; old v1 artifacts preserved                                  | Complete (v2 deployed/verified; operator locked)              |
| R-09 / P0     | First full controlled execution                                    | R-05 through R-08              | BLOCK old intent; new nonce/review; Privy-controlled real Sepolia update; exact receipt/state/evidence                        | Gas funded; real human approval/Sepolia execution pending     |
| R-10 / P0     | One console, durable timeline, grounded risk Q&A                   | R-03, R-09                     | Source-linked numbers, unavailable-AI fallback, refresh/idempotency/recovery tests                                            | Local console + fallback implemented; live AI/hosting pending |
| R-11 / P0     | Freeze, adversarial regression, repeatable demo                    | R-09, R-10                     | Three successful complete runs; stale/version/epoch, timeout, duplicate, bad payload, policy-denial, receipt-failure coverage | Pending                                                       |
| R-12 / P0     | Submission artifacts and demo video                                | R-11                           | All actual specs/prompts/plans, AI/human contribution log; reproducible setup; real narration, 2–4min, ≥720p                  | Pending                                                       |
| R-13 / P0     | Submit daytime, reserve evening buffer                             | R-12                           | Dashboard submission confirmed before official deadline                                                                       | Pending                                                       |

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
  has not been published to The Graph Network. Hosted v2 was separately verified
  on September 9. New-event-to-analysis and sponsor qualification remain
  separate gates; no alternate provider account has been created.
- CRE private-beta network access is optional for the selected CLI lane; record
  simulation honestly. A mock result or isolated template is not product
  integration.
- Privy authentication ≠ control. Verify a policy-bound test wallet first; do
  not invent quorum availability or weaken execution just to show a transaction.
  A
  [separate locked operator candidate](evidence/privy-operator-candidate-2026-09-08.json)
  now has a provider-verified deny policy and was assigned the v2 operator role
  in the approved deployment. It is not either isolated proof wallet and remains
  unfunded with no signing permission. Authority / reviewer authentication and
  reviewed exact-intent activation remain pending.
- Future contract revisions need a new reviewed deployment. Never overwrite old
  ABIs or attribute v2 protections to the historical v1 addresses; only the
  separately verified v2 manifest identifies the new deployment.
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

- The separate v2 bootstrap, deployment script and ABIs were prepared before
  deployment. The
  [10:05 UTC preparation report](../deployments/v2/preparation.json) records the
  confirmed roles and exact payload; its no-broadcast status is a historical
  snapshot, not the current deployment status. Read-only checks confirmed v1
  remained at LT 8000 and was rejected by the v2 adapter.
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

### Approved deployment and post-transaction verification

- After explicit role/deployment authorization, all 32 contract tests and the
  read-only Sepolia rehearsal passed. The new bootstrap transaction in block
  11660450 exactly matched the reviewed input and transaction fields.
- The [v2 manifest](../deployments/sepolia-v2.json) records all five contract
  addresses, exact Sourcify/Blockscout source verification, runtime code hashes,
  role/ownership/allowlist checks, epoch 1 and the complete five-position seed.
- The actual product RPC adapter in v2 mode read stateVersion 7 from the new
  market at the deployment block. This is a direct RPC check, not hosted Graph
  indexing or end-to-end execution.
- The post-deployment Privy read confirmed the unchanged wildcard DENY policy.
  No operator funding, policy activation or propose/decision/execute transaction
  occurred; v1 artifacts remain unchanged.

## September 9 implementation and verification

Exact checks, corrected failures and remaining coverage are recorded in the
[September 9 validation record](evidence/local-verification-2026-09-09.md).

1. **Hosted v2 data:** independent Studio subgraph `paramshield-sepolia-v-2`,
   version `v0.2.1`, CID and source hashes in
   [its manifest](../deployments/graph-sepolia-v2.json). The previous `v0.2.0`
   revision is retained there. Formatting was followed by an actual redeploy,
   not an invented source-to-deployment match. Same-block RPC corroboration
   includes all five positions plus indexed executor/epoch/allowlist.
2. **Actual CRE on hosted v2:**
   [BLOCK and fresh ALLOW evidence](evidence/cre-hosted-v2-2026-09-09.json). No
   human-review or execution claim; no hardware TEE claim.
3. **Controlled lifecycle:** local token/Origin protected console; strict
   request fields; exact propose and execute policy; default DENY restored
   before broadcast; pending/unknown signing and nonce reservations held
   durably; full mined transaction, two confirmations, semantic events and
   receipt-block state required.
   [Owned Anvil](evidence/receipt-anvil-only-2026-09-09.json) exercised all
   three lifecycle transactions; mocked provider tests are labeled.
4. **Evidence-first console:** four-cell comparison, source/hash/version/epoch,
   human review entry, transaction timeline, read-only receipt recovery,
   redacted evidence download and a post-execution Graph check. The latter must
   observe the new LT/stateVersion events and changed computed health before
   marking the new-event demonstration complete.
5. **AI:** a bounded, optional Responses API evidence selector can only return
   existing fact IDs; all rendered numbers/text are deterministic. No provider
   is configured yet. Fallback is explicitly non-AI and cannot authorize writes.

### Remaining ordered actions

- Operator test gas is now funded: the
  [verified transfer](evidence/operator-gas-2026-09-09.json) delivered 0.01
  Sepolia ETH at block 11665366. No repeat funding is needed.
- The first human review was not accepted. The
  [review diagnosis and fix](evidence/review-rejection-2026-09-09.md) cover a
  reproducible MetaMask/domain hash mismatch and misleading expiry labeling. New
  diagnostic records distinguish content issuance from accepted signatures.
- User performs a fresh exact EIP-712 review, then the independent authority
  transaction. Chat confirmation and agent-operated signing are not evidence of
  substantive human risk review.
- Execute one fresh ALLOW through the exact Privy gate and verify real Sepolia
  receipt/state, then verify its newly indexed Graph events affect analysis.
- Configure and verify a real runtime AI provider, select a safe public hosting
  boundary, and complete repeated demo/regression/video gates.

The console runs on one trusted local host, not a public multi-user service. The
120-second/12-block freshness limits remain unchanged. If a review expires,
create a new run, intent and signature; never refresh a timestamp in place.
