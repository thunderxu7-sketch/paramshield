# September 9 MetaMask review diagnosis

Scope: local Sepolia v2 console review compatibility and truthful failure
reporting. This is **not** a real accepted human review, a mainnet action or a
completed propose/decision/execute flow. All times below are Asia/Shanghai.

## Observed live result

- The 79.42% run used snapshot block 11665404 at 11:43:12. CRE returned ALLOW at
  11:43:32; review content was issued at 11:43:45.
- The data time window ended at 11:45:12. At inspection, the UI still showed
  about 32 seconds remaining but displayed a generic expiration error.
- The flow remained ALLOW / waiting for human review. No accepted review was in
  the durable approval store. Signing in MetaMask was not treated as proof that
  the server had accepted the review.
- The old implementation did not persist the specific rejected-review reason.
  Its exact live failure cannot be reconstructed from that record alone.

## Reproduced defects and fix

1. **Raw V4 payload omitted the domain type.** The server returned a viem-style
   typed-data object directly to `eth_signTypedData_v4`, without
   `types.EIP712Domain`. viem infers the domain schema, while MetaMask's
   `eth-sig-util` sanitizes an omitted schema to an empty domain definition.
   Those paths hashed different messages, even with the same test key and fresh
   evidence. This is a reproducible cause of rejected valid-wallet signatures,
   not evidence that the participant selected the wrong account.
   [MetaMask signing example](https://docs.metamask.io/metamask-connect/evm/guides/sign-data/)
   and
   [MetaMask codec source](https://github.com/MetaMask/eth-sig-util/blob/main/src/sign-typed-data.ts).
2. **Misleading expiry classification.** Signer mismatch, a future review
   timestamp and an expired intent shared `Unauthorized or expired review`. The
   UI's expiry matcher mislabeled all three. Typed rejection codes now
   distinguish them, plus snapshot/intent/RPC freshness failures.
3. **Insufficient outcome evidence.** Preparation, acceptance and rejection now
   have separate durable audit entries with phase, timing, fixed reason code and
   sanitized text. Rejected signatures and raw provider errors are not
   persisted. An issued payload is explicitly not an approval.

The domain schema is now explicit: name, version, chainId and verifyingContract.
The server's original domain-bound digest and all authorization checks remain
unchanged. Legacy domain-omitting signatures, other-chain/contract signatures
and expired evidence are rejected; no compatibility bypass was introduced.

## Verification scope

- Before the domain fix, the MetaMask V4 versus viem digest comparison failed
  for the exact API JSON payload. The correct test key's legacy wallet signature
  also reproduced `REVIEW_SIGNER_MISMATCH`.
- Regression coverage uses the pinned Node-20-compatible
  `@metamask/eth-sig-util@8.2.0` as a **development-only** independent codec.
  Public trivial test keys and mocked lifecycle RPC are explicitly labeled;
  these are not real wallet keys, hosted CRE capabilities or human approvals.
- Checks cover compatible wire hashing/signing, wrong signer, missing domain,
  wrong chain/verifier, time-window crossing, future timestamp, issued versus
  accepted status, provider-error redaction and journal-write failure.
- Final local checks passed: **120 web tests in 12 files**, TypeScript, lint
  (one pre-existing unused-directive warning) and the production Next build.
  Explicit domain typing initially exposed number-versus-bigint type errors; the
  uint256 chain ID and its altered-domain test were corrected before the passing
  checks. The full workspace is not claimed as a fresh local rerun.
- The rebuilt console was reopened in the participant's Xu Chrome profile. It
  retained 79.42% history, disabled expired authorization, displayed the new
  acceptance/countdown wording and read DENY, stateVersion 7, epoch 1 and
  0.01000 Sepolia ETH. No review button was clicked by the agent.
- Actual-value privacy scanning found no private reviewer, resource, endpoint or
  credential values in candidate public files. Seven Next deployment traces
  contained no `.local` or `.env` files. Graph source hashes and the v1 manifest
  checksum remained unchanged.
- The 120-second / 12-block limit, independent roles, exact Privy policy,
  wildcard DENY restoration and unknown-transaction recovery rules are
  unchanged.

## Separate funding result

The [canonical funding receipt](operator-gas-2026-09-09.json) proves that the
already-designated operator received **0.01 Sepolia ETH** at block 11665366
(11:35:12). The read-only recheck observed 102 confirmations. This is only gas,
not a parameter update or approval; do not resend it.

A fresh real human review and the controlled Sepolia lifecycle remain pending.
