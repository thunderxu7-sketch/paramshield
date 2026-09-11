# ADR 0003 — Strict MetaMask smart-account decision receipt recovery

Date: 2026-09-10. Applies only to the Sepolia demo's **read-only decision
receipt verifier**.

## Incident

MetaMask wrapped a reviewed `recordDecision` in an EIP-7702 transaction to its
DelegationManager. The chain accepted the decision, but the old verifier
expected an exact direct EIP-1559 envelope. Its generic error contained
`reviewed`, which was wrongly classified as a missing human-review signature.
The hash and issued plan were preserved, so recovery requires no new signature
or broadcast.

## Recognition boundary

Direct EIP-1559 verification remains exact. Privy `propose` and `execute` NEVER
accept this compatibility branch. For a decision only, recognize exactly:

- Sepolia, original sender and nonce, zero native value, unchanged fee caps,
  empty access list, canonical successful receipt and consistent block/hash.
- First-use EIP-7702 with exactly one authorization, chain 11155111, sender
  nonce + 1, recovered signer equal to the original authority, the pinned v1.3.0
  stateless DeleGator implementation. No additional account authorizations.
  Already-delegated accounts may send the same wrapper as EIP-1559 without a new
  authorization list; the account designation and pinned code at the receipt
  block remain mandatory.
- The pinned v1.3.0 DelegationManager and one canonical `redeemDelegations`
  entry. Only all-zero SINGLE/default execution mode; no batch, delegatecall,
  trailing payload or alternative encoding.
- The inner packed call is byte-for-byte the original executor + zero value +
  original calldata. It cannot change the decision hash or introduce other
  calls.
- One root self-delegation, with independently recovered EIP-712 signature, and
  exactly the observed NativeTokenBalanceChangeEnforcer caveat: the authority's
  balance-change condition encoded as byte 1 + authority + uint256 zero, empty
  hook args. No third-party delegates, arbitrary hooks or alternate caveats.
- Runtime hashes of manager, implementation and hook, and the authority's
  delegation designation, are checked **at the receipt block**. Unavailable
  historical state is a blocker, not acceptance.
- Wrapper gas can differ only within [planned gas, min(3 × planned gas, 1M)].
  This recognizes an already-mined, wallet-approved envelope; it is NOT a
  signing or broadcasting budget, and does not alter the saved plan or fee caps.
- Existing lifecycle checks still require two confirmations, exact executor
  event and receipt-block proposal/market state, followed by a canonical
  recheck.

This is deliberately not general-purpose EIP-7702 support. Unknown wrappers,
code upgrades, batches, different caveats, and future smart-wallet transports
fail closed and need separate review. No wallet settings are changed.

## Recovery and expiration

The existing authenticated `recover` operation validates the saved decision hash
and advances DECISION_PENDING → DECIDED. It clears only the current error,
retains historical events and all original plans, signatures, evidence and
transaction hashes. It does not renew the intent, rehydrate a CRE capability
after restart, change the Privy policy, resend a transaction or execute the
parameter change. An expired intent remains non-executable even after successful
receipt recovery.

## Sources and reproducibility

- [MetaMask official deployments, v1.3.0](https://github.com/MetaMask/delegation-framework/blob/main/documents/Deployments.md)
- [DelegationManager source](https://github.com/MetaMask/delegation-framework/blob/main/src/DelegationManager.sol)
- [Delegation and caveat structs](https://github.com/MetaMask/delegation-framework/blob/main/src/utils/Types.sol)

The public runtime-code fixture was read from Sepolia block 11672238. Its hashes
are pinned in `decision-7702.ts`; tests verify actual signatures and canonical
encoding using synthetic keys, never the participant's private reviewer details.
The real failed decision receipt is checked separately through configured RPC.

Validation includes mutation rejection (sender, nonce, chain, gas/fees, wrapper,
authorization signer/list/nonce/chain, inner target/value/calldata, modes,
batches, permissions, hook arguments, signatures, code, reverts, receipts and
reorgs), legacy EIP-1559 tests, and non-broadcasting recovery after expiry.
