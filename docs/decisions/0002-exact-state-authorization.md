# ADR 0002 — Exact-state authorization with fresh observations

Date: 2026-09-09. Implemented locally; this change does not authorize any new
public-chain transaction or deployment.

## Problem and decision

The original 120-second snapshot window covered human review, Privy signing,
proposal confirmations, independent authority review/confirmation and execution.
Asking the human to hurry or resetting the timestamp does not fix this model.

New console runs explicitly opt into `exact-state-v1`:

1. Compile first, acquire/corroborate fresh hosted Graph data and run actual CRE
   CLI. **Snapshot freshness stays 120 seconds / 12 blocks.**
2. Create one immutable v2 intent with the protocol's existing **ten-minute
   maximum, measured from preflight validation**, not from each signature. BLOCK
   never creates a grant.
3. The reviewer signs `ExactStateAuthorization` in the NEW EIP-712 domain
   `ParamShield exact-state authorization`, version `1`. The wallet displays
   market, operator, original/authorized LT, state version, permission epoch,
   policy version and fixed deadline. The scope hash also commits to the exact
   change/preflight/decision hashes, complete economic state hash, complete
   policy hash and freshness limits.
4. Before issuing/accepting review, preparing each transaction, after signing
   and before Privy broadcast, fetch a NEW snapshot. Reconcile every position
   and market field with same-block RPC; check current code, owner, roles,
   allowlist, version, epoch, proposal, nonce, canonical blocks and deadline.
5. Only **observation block metadata and fetch time** may differ from the
   reviewed snapshot. Source/deployment, every position, totals, price,
   decimals, LT and version must match exactly. Even a new ALLOW over changed
   inputs is insufficient. Changed inputs/permissions/policy require new
   analysis/review.
6. Append separate freshness checkpoints: snapshot hash/fetch time, pinned
   blocks, checked time and scope hash. Never rewrite the original report,
   hashes, decision, expiry, nonce or signature. Reconstruct a refreshed
   snapshot from the original economic state plus checkpoint metadata to
   independently compare its hash.

The initial CRE ALLOW is not rerun for unchanged inputs: this demo's model is
fully deterministic, its complete policy is pinned, and every risk input must
match. This remains a **trusted local relay**, not hardware TEE attestation. A
refresh alone is not proof of human approval.

## Existing v2 contract and bounded assumptions

The reference market increments `stateVersion` on every modeled economic
mutation, including positions, price and LT. The executor binds exact calldata,
evidence, nonce, expiry, version and permission epoch and checks them again at
mining. Roles stay separated; proposal/decision keep the SAME original hashes.
No contract, deployment manifest or index migration is needed.

The independent authority sends directly from MetaMask. The server checks
freshness before issuing that request, but **cannot intercept its later wallet
broadcast** after a human delay. This transaction authorizes only the exact
intent and the contract enforces expiry/version/epoch; it does not change the
market. Actual execution still requires fresh server checks and atomic contract
guards. Do not claim a post-signature server check for the direct-wallet leg.

This is NOT automatically valid for arbitrary lending protocols. Interest
accrual, time-dependent risk, unversioned oracles, proxies or omitted inputs
require a different attestation/freshness and contract design. Keep the reviewed
manifest/code-hash boundary.

## Compatibility and recovery

- Legacy `ParamShieldReview` signatures retain their old meaning and directory.
  Neither signature type can be used as the other type.
- The owned runner privately records acceptance time, policy hash and explicit
  mode. Historical binding uses that immutable acceptance time ONLY in the
  scoped path, followed by mandatory fresh checks. Browser/disk JSON cannot
  create this in-process capability.
- Page reload preserves progress; server restart still revokes CRE capability. A
  durable signature alone cannot resume signing. Do not rebuild/restart during a
  live authorization.
- No automatic signature, nonce change, policy relaxation or rebroadcast after
  rejected/unknown/timed-out requests. Fixed expiry is never renewed.
- Direct API analysis cannot bypass an unfinished transaction. An explicit
  read-only retirement of a CONFIRMED expired proposal/decision rechecks its
  receipt and canonical on-chain deadline, retains stage/hash/evidence and sends
  NO `markExpired`, cancellation or other transaction. Issued/unknown requests
  must first be reconciled; a UI timer is insufficient.
- Historical RPC unavailability blocks retirement/rechecks; it does not prove
  failure. Do not remove receipt-block checks to hide a provider issue.
- Privy exact-intent sign-only policy, restored DENY before broadcast, full
  EIP-1559 validation, durable locks and semantic two-confirmation receipt
  checks remain. This is not admin-proof provider quorum or finality.

## Verification

Unit tests cover a five-minute human delay, immutable evidence, MetaMask V4 wire
hashing, wrong/legacy/tampered signatures, changed
state/roles/code/policy/nonce, reorgs, stale/future/lagging observations, slow
dependencies, fixed expiry, all three delayed legs, restart, unknown requests
and read-only retirement.

```sh
pnpm --dir apps/web exec tsx scripts/scoped-authorization-anvil.ts --anvil-only
```

The isolated harness passed using actual CRE CLI, local EIP-712 signatures, all
three v2 transactions, durable signing/broadcast, canonical receipts and final
LT 7942. A real local epoch rotation after signing was blocked, as was
post-execution replay. It simulates 180 seconds of human delay and 60 seconds
between steps. Graph and signer envelopes are explicitly LOCAL fixtures, not
hosted Graph or Privy acceptance. See the
[Anvil-only evidence](../evidence/scoped-authorization-anvil-2026-09-09.json).

A new, substantively reviewed grant on public Sepolia is a separate
user-authorized acceptance step. Old confirmed proposals are not migrated.
