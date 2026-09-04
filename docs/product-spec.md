# ParamShield Product Specification

**Status:** Baseline specification  
**Date:** 2026-09-05  
**Event mode:** Building from Scratch

## 1. Problem

DeFi risk councils routinely change parameters such as liquidation thresholds,
loan-to-value ratios, borrow caps, and oracle controls. The proposal,
simulation, approval, and transaction payload often live in separate tools.
Reviewers cannot easily prove that:

- the analysis used current onchain positions;
- the exact calldata they approve was simulated;
- private operating limits were applied without revealing them;
- an unsafe proposal could not bypass the review path; and
- the executed state matches the approved state.

## 2. Product promise

For every supported parameter transaction, ParamShield answers:

1. Which current positions would be affected?
2. What changes under current prices and a declared stress scenario?
3. Which policy rules pass or fail?
4. Is the transaction `ALLOW`, `BLOCK`, or `ESCALATE`?
5. If unsafe, what is the nearest value that passes all deterministic rules?
6. Who authorized the final payload, and what was executed onchain?

## 3. Primary user and job

**Primary users:** protocol risk councils, DAO multisig signers, parameter
administrators, and lending-market operators.

**Job to be done:** Before signing a parameter update, determine its impact on
current users and stressed market conditions, prevent unsafe execution, and
leave evidence that can be independently reviewed.

Retail trading, yield optimization, and autonomous portfolio management are out
of scope.

## 4. Reference scenario

The demo uses a small ETH-collateral/USDC-debt lending market on Sepolia.

| Input                         | Value                                                            |
| ----------------------------- | ---------------------------------------------------------------- |
| Current liquidation threshold | 8,000 bps (80%)                                                  |
| Unsafe proposal               | 7,000 bps (70%)                                                  |
| Stress scenario               | ETH price decreases by 15%; debt price stays at $1               |
| Private rule 1                | A single threshold decrease cannot exceed 300 bps                |
| Private rule 2                | A change cannot make a currently healthy position liquidatable   |
| Private rule 3                | Stressed liquidatable debt cannot exceed 2% of total market debt |

Expected flow:

1. The Graph returns current positions, parameters, indexed block, and
   freshness.
2. The deterministic simulator shows that the 70% threshold creates new
   liquidations and violates at least one private rule.
3. The CRE confidential handler returns `BLOCK` with rule identifiers but does
   not disclose the private thresholds.
4. The risk engine searches for the nearest passing threshold; no value is
   hard-coded in the interface or workflow.
5. A reviewer approves the safe replacement through a Privy control.
6. The executor changes the market value on Sepolia.
7. The evidence bundle contains both the rejected and executed paths.

## 5. P0 scope

P0 is the minimum submission. Work outside this list cannot delay it.

- Reference lending market, mock assets, seeded positions, and Foundry tests.
- One supported parameter: liquidation threshold.
- One deterministic stress: ETH price down 15%.
- A Sepolia Subgraph that provides live positions and parameter events.
- Before/after risk metrics and a deterministic nearest-safe-value search.
- A CRE Confidential Workflow that handles at least one real private input.
- Structured `ALLOW`, `BLOCK`, and `ESCALATE` verdicts.
- A contract execution path that fails closed for blocked, stale, malformed, or
  replayed decisions.
- A Privy wallet plus at least one substantive policy, signer, key quorum, or
  intent control.
- A real safe-parameter transaction on Sepolia.
- A canonical, downloadable evidence bundle with an onchain-bound hash.
- An operator web flow for draft, analysis, decision, approval, execution, and
  evidence.
- Automated contract, unit, integration, and critical browser tests.
- Reproducible setup documentation, AI disclosure, and a 2–4 minute demo video.

## 6. Deferred scope

### P1, only after the full P0 path is stable

- Aave V2 CRV historical counterfactual replay.
- Evidence-grounded AI explanation for risk council reviewers.
- IPFS publication of the evidence bundle.
- Richer position visualizations and explicit timeout/retry UX.

### P2 roadmap

- Oracle deviation or stablecoin-depeg stress scenarios.
- Multiple assets, markets, and protocol adapters.
- Governance proposal and Safe Transaction Service adapters.
- Post-change monitoring, rollback playbooks, and multi-chain deployment.

## 7. Functional requirements

### FR-01 — Canonical change intent

The system accepts chain ID, target, supported function, calldata, proposed
value, reason, nonce, and expiry. It derives a canonical `changeId` and
`changeHash`.

**Acceptance criteria**

- Displayed arguments round-trip to the encoded calldata.
- Unknown targets, selectors, chains, expired intents, and reused nonces fail.

### FR-02 — Live indexed state

The system queries market state and positions through The Graph.

**Acceptance criteria**

- The response exposes the endpoint, indexed block, fetch time, and data hash.
- A stale, unavailable, or malformed response prevents approval and execution.
- At least one newly emitted Sepolia event changes the analysis result.

### FR-03 — Deterministic simulation

For every position, calculate health and debt exposure under:

1. current parameter + current price;
2. proposed parameter + current price;
3. current parameter + stressed price; and
4. proposed parameter + stressed price.

The primary health-factor model is:

```text
healthFactor = collateralValue * liquidationThreshold / debtValue
```

**Acceptance criteria**

- Outputs include newly liquidatable positions and debt, stressed liquidatable
  debt, projected bad-debt exposure, parameter delta, and minimum/median health
  factors.
- Identical canonical input produces identical output and evidence hashes.

### FR-04 — Confidential policy decision

Public inputs are the canonical intent and simulation summary. Private inputs
include operating thresholds and, when needed, service credentials. CRE returns
strictly validated JSON:

```json
{
  "changeId": "0x…",
  "verdict": "BLOCK",
  "policyVersion": "2026-09-05-v1",
  "violations": ["MAX_LT_DELTA", "ZERO_NEW_LIQUIDATIONS"],
  "recommendedValueBps": 7800,
  "evidenceHash": "0x…",
  "expiresAt": 0
}
```

**Acceptance criteria**

- At least one private value is fetched and used inside the confidential path.
- Logs and outputs do not reveal private rule values.
- Invalid output, timeout, missing attestation, or stale data fails closed.

### FR-05 — Safe parameter recommendation

The risk engine searches within the allowed range for the value nearest the
original proposal that passes every deterministic hard constraint.

**Acceptance criteria**

- Every candidate is re-simulated.
- Monotonic inputs use bounded binary search; non-monotonic inputs use bounded
  enumeration.
- If no candidate passes, the result is `NO_SAFE_VALUE`.

### FR-06 — Policy-bound execution

`BLOCK` cannot execute. `ESCALATE` requires the configured enhanced review.
`ALLOW` still requires its Privy authorization path.

**Acceptance criteria**

- The decision is bound to chain, target, calldata, nonce, evidence hash, and
  expiry.
- Wrong bindings, replay, expired decisions, unknown selectors, or insufficient
  approval revert at the executor.

### FR-07 — Receipt and evidence

The UI cannot show `EXECUTED` until both the receipt succeeds and the contract
read returns the approved value.

The evidence bundle includes the intent, query metadata, simulation input and
output, algorithm versions, workflow identifiers, policy result, recommendation
trace, approval state, transaction receipt, and final state.

## 8. State machine

```text
DRAFT
  -> DATA_READY
  -> SIMULATED
  -> ALLOWED | BLOCKED | ESCALATED
  -> APPROVAL_PENDING
  -> APPROVED
  -> SUBMITTED
  -> EXECUTED | FAILED | EXPIRED
```

State is recovered from durable server/onchain evidence rather than optimistic
client navigation.

## 9. Non-functional requirements

- Graph query target: less than 3 seconds.
- Local simulation target: less than 2 seconds.
- Full decision target: less than 20 seconds, with CRE latency shown separately.
- Desktop demo is usable at widths of 1280px and above.
- Risk status is never communicated by color alone.
- Seed or fallback data is visibly labeled and cannot be presented as live.

## 10. Definition of done

P0 is done only when a clean browser can repeatedly demonstrate a dangerous
change being stopped and a calculated safe replacement being approved and
executed, while every material claim is traceable to live indexed data,
deterministic output, a CRE run, a Privy control, or an onchain transaction.
