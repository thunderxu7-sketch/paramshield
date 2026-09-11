# ParamShield Product Specification

**Revision:** 2026-09-07, incremental-exposure-v2

**Clarification (2026-09-11):** the registered confidential handler is exercised
through the CLI simulation lane specified in FR-05, not hardware attestation.

**Mode:** ETHOnline 2026, Building from Scratch

**Status:** Specification, not a claim that every integration is complete.

## Problem, user, and promise

Protocol risk councils and parameter operators need to connect the transaction
being signed to the data and risk analysis reviewed. ParamShield checks one
liquidation-threshold change against live indexed positions, a deterministic
stress, and a confidential policy; it blocks the original or routes a separately
reviewed replacement through controlled execution and verifiable evidence.

Retail trading, yield optimization, and autonomous portfolio management are not
our use case. The demo is a reference market, not production lending software.

## Reference scenario and policy

| Input                     | Demo value                                                                                   |
| ------------------------- | -------------------------------------------------------------------------------------------- |
| Current LT / proposal     | 8,000 / 7,000 bps                                                                            |
| Assets and decimals       | mETH (18), mUSDC (6)                                                                         |
| Collateral price / stress | $2,000 / -15%; debt stays $1                                                                 |
| Maximum single decrease   | 300 bps                                                                                      |
| Normal-price rule         | No newly liquidatable positions                                                              |
| Stress rule               | Additional stressed liquidatable debt over the **same-snapshot baseline** ≤ 2% of total debt |

These are **public demo policy values**, not production secrets. The workflow
loads a configurable policy from a secret; private deployments must supply their
own values. Never place actual private values in source, the browser, or
evidence.

The canonical fixture has 68,300 mUSDC debt. Its baseline stressed liquidatable
debt is already 22,800. The proposed 70% produces 48,300; 78% produces 36,300.
The nearest passing decrease is **79.42%**, while 79.41% fails. This is a test
expectation, not a UI constant. An **absolute** stressed-debt cap of 2% has no
passing decrease here; it must return `NO_SAFE_VALUE`, not raise LT to hide
risk.

This is a **change gate**, not a market solvency certificate. Liquidatable debt
is not realized liquidation, loss, or bad debt. Report simple collateral
shortfall separately, with the explicit omission of liquidation costs, slippage,
oracle dynamics, and recovery. The fixture's simple shortfall is zero.

## Frozen P0 scope

1. One reference lending market, seeded mock positions, one LT change, one
   stress.
2. Live The Graph Subgraph data that directly changes the analysis.
3. Bigint simulation of current/proposed LT × normal/stressed price.
4. Confidential policy evaluation **and candidate search** in a registered CRE
   confidential handler; P0 uses CLI simulation, not hardware TEE execution.
5. `ALLOW`, `BLOCK`, `ESCALATE`; missing/invalid/late data fails closed.
6. Privy-controlled operator wallet with a verified, enforceable control.
7. Independent decision authority, exact-calldata gate, and real Sepolia
   receipt.
8. Acyclic preflight/decision/final evidence hashes and independent
   verification.
9. One operator console with a durable, recoverable status timeline.
10. Evidence-grounded AI explanation/Q&A over live Graph input and deterministic
    metrics, targeting The Graph's AI tooling/use-case category.
11. Timeout, expiry, stale approvals, duplicate-submit protection, repeatable
    demo.
12. Real tests, public specs/prompts/plans, truthful AI attribution, 2–4 minute
    video.

**Deferred:** historical replay, second stress, IPFS, more
markets/assets/chains, full governance integrations, rich visualizations,
autonomous rollback.

## Functional requirements and acceptance

### FR-01 — Exact intent

The v2 onchain intent binds chain, executor, operator, target, zero value,
calldata, numeric nonce, preflight evidence hash, expected market state version,
expected executor authorization epoch, and expiry. Reason and decoded parameters
are included in the preflight core. Displayed values must round-trip through ABI
encoding. Unsupported calls/chains/targets, invalid numbers, expired intents,
reused nonces, or mismatched bindings fail closed.

### FR-02 — Complete live snapshot

Record the Graph endpoint identity (without keys), query, indexed block/hash,
fetch time, totals, parameters, and all positions. Pin every page to one block;
reconcile totals and position count. Index position **amounts** and recompute
health after configuration changes, not cached event health factors. Reject
partial data, indexing errors, stale/future timestamps, unavailable endpoints,
and block-hash mismatches. A trusted relay corroborates the snapshot with RPC at
that block; the Graph is still the data source, never silently replaced by RPC.

### FR-03 — Deterministic risk model

Use the same staged integer floors as `ReferenceLendingMarket`. Zero debt has
infinite health; `HF < 1` (not `<=`) is liquidatable. Report each matrix cell,
newly liquidatable positions/debt, baseline/proposed/additional stressed debt,
parameter delta, minimum/median finite health, and simple collateral shortfall.
Identical validated input must yield identical output. Invalid input is an
error, not an invented safe result. State/supply totals must reconcile before
analysis.

### FR-04 — Confidential policy and nearest recommendation

The confidential handler receives the validated complete snapshot and intent,
recomputes metrics, loads its private policy, evaluates constraints, and
searches only `[proposal, current]`. Bounded integer enumeration (≤ 4,501
candidates) is sufficient for P0, with a fail-closed cap of 50,000 position ×
candidate evaluations; do not assume monotonicity for a future model. No
hard-coded recommendation or LLM candidate selection. A result equal to current
is `NO_CHANGE`; no passing candidate is `NO_SAFE_VALUE`.

Publish policy version, rule identifiers, verdict, recommendation, hashes, and
expiry, **not** private thresholds or the full search trace. Recommendations and
repeated queries inherently leak some information; do not promise zero leakage.
Rate limiting is required at the service boundary.

### FR-05 — Explicit trust and execution

P0 selects **CRE CLI simulation + trusted relay** to avoid private-beta
deployment access blocking the demo. This exercises a confidential handler but
simulation is **not hardware TEE execution or onchain attestation**. The relay
validates the run, schemas, exact bindings, snapshot, and deterministic outputs
before its separate decision-authority signer records a decision. The contract
trusts that authority. A future network-attested lane requires separately
verified report validation and never silently falls back to simulation.

The Privy operator and decision authority must be distinct. Governance remains
trusted: it can alter roles/allowlists. Authorization changes invalidate old
intents via an epoch; all risk-relevant market changes invalidate old approvals
via a state version checked atomically at execution. Initial Graph TTL is not
enough. `BLOCK` and `ESCALATE` are terminal holds for that intent, not approval
buttons. A replacement or escalated review needs a new nonce, snapshot,
decision, and Privy authorization. Receipt success alone is not final-state
verification.

### FR-06 — Acyclic evidence

```text
intentCore + snapshot + simulation -> preflightHash
preflightHash + exact v2 intent    -> changeHash
changeHash + CRE decision          -> decisionHash
onchain events + receipt + state   -> finalBundleHash
```

No upstream hash includes itself or a future receipt. The final bundle includes
the preflight and decision, workflow/run metadata and explicit trust mode, Privy
authorization evidence, receipt, and block-pinned final state. Its own hash is
**not** claimed to have been anchored before execution. Secret-bearing logs, raw
policy values, and full candidate traces never enter the public bundle.

### FR-07 — One console and grounded AI

`DRAFT -> DATA_READY -> SIMULATED -> ALLOWED -> APPROVAL_PENDING -> APPROVED -> SUBMITTED -> EXECUTED | FAILED | EXPIRED`.
`BLOCKED` and `ESCALATED` terminate that intent. Recover from durable
server/onchain state, not optimistic navigation. Show chain, addresses, nonce,
calldata, freshness, trust mode, and errors. Only mark `EXECUTED` after
successful receipt **and** matching block-pinned state.

AI answers why the proposed change is blocked, which indexed positions matter,
and what the reviewed alternative changes. Every numeric claim links to an
existing evidence field. AI may not change policy, calculate executable values,
approve, sign, send, or turn a failure into allow. If unavailable, show the
verified evidence and an honest explanation-unavailable state.

## Non-functional requirements

Target Graph reads <3s, deterministic simulation <2s, and full decision <20s;
measure separately rather than claim unmeasured performance. Support desktop
1280px+, non-color-only statuses, explicit fixture/simulation labels, bounded
requests/retries, idempotency, and secure server-side credentials.

## Definition of done

A clean browser can repeat BLOCK → new analysis → authorized replacement → real
Sepolia execution → downloadable verified evidence three times. Reset uses a
fresh reviewed change or a newly provisioned fixture, never an unrestricted
reset backdoor. Every sponsor claim has separate live evidence; local tests or
SDK imports alone do not satisfy those gates. See the implementation plan for
status.
