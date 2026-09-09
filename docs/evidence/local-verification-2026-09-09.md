# September 9 verification record

Scope: independent hosted v2 index and a local single-user review/execution
console. This is **not** a completed public Sepolia execution, human-review
certificate, runtime AI demonstration or public deployment.

## Automated checks

- `pnpm verify` passed: formatting, lint, TypeScript, workspace tests and
  production builds, including both separate v1 and v2 subgraphs. That run
  contained **210 tests**: 32 contracts, 14 CRE, 9 evidence, 22 Graph client, 8
  shared, 17 risk engine and 108 web tests. Unchanged Turbo tasks included cache
  hits; they are not represented as fresh reruns.
- After adding two analysis-ID/restart regressions, the web suite passed with
  **110 tests in 11 files**, followed by typecheck, lint and production build.
  The combined current suite therefore contains **212 tests**, not 320.
- The final UI-only draft/evidence binding fix was followed by typecheck, lint,
  production build and actual browser regression checks. Server and contract
  suites were not needlessly rerun for that UI-only change.
- Lint has one existing warning in `bounded-process.ts`: an unused
  `eslint-disable` directive. No lint errors remain.
- Runtime: Node 20.19.2, pnpm 10.34.5, Foundry 1.5.1-stable.

## Live and integration evidence

1. **Hosted Graph:** independent `paramshield-sepolia-v-2` version `v0.2.1`, CID
   `QmefV5eQoaRnQpHDzLnTAEkeBo1ZjEPNSYVHad5LojU42s`. The
   [manifest](../../deployments/graph-sepolia-v2.json) pins deployment and
   source hashes. [Same-block RPC evidence](graph-live-v2.json) checks all five
   positions, totals/config, stateVersion 7, executor roles, epoch 1 and
   allowlist at block 11665167. No paid Graph Network publication occurred.
2. **Actual CRE CLI:** the final source-bound
   [hosted-v2 run](cre-hosted-v2-2026-09-09.json) consumed blocks 11665257
   and 11665259. Threshold 7000 returned BLOCK; a distinct fresh 7942 intent
   returned ALLOW. All recorded source hashes matched the working files when
   checked. Hardware TEE, human review and execution are explicitly false.
3. **Real local contracts:** the isolated
   [Anvil receipt harness](receipt-anvil-only-2026-09-09.json) passed six
   checks: exact envelope/events/receipt-block state for propose, decision and
   execute, plus altered-plan rejection for each. Final local LT 7942/version 8
   is **not** public Sepolia state. The owned Anvil process was stopped.
4. **Real local HTTP:** authenticated status returned 200 and verified
   stateVersion 7, DENY, zero operator balance and no configured AI provider.
   Missing session and foreign Origin returned 401. Extra client RPC fields,
   unissued execution and changed threshold under an existing analysis ID
   returned 409. Repeating the original ID/input after restart returned its
   inactive historical result without changing the persisted file. No signing or
   chain write was requested by these checks.
5. **Browser:** real Chrome interaction exercised BLOCK, deterministic
   recommendation, fresh ALLOW, four-cell evidence and explicitly non-AI
   fallback. Reload retained history without restoring authorization. The final
   handoff tab is in the participant's **Xu** Chrome profile; no work profile
   wallet was connected.
6. **Wallet preparation:** the participant's Xu MetaMask connected the existing
   admin account on Sepolia. The console requested a 0.01 Sepolia ETH transfer
   to the already-designated operator. At handoff there was **no returned
   transaction hash or verified receipt**. This is a pending wallet request, not
   a funded-operator or completed-transfer claim. Inspect the original MetaMask
   request/activity before any repeat; do not reload the waiting page to bypass
   uncertainty.

## Failures found and corrected

- Number-selected Graph `_meta` returned `hash: null`. Hash-selected queries
  plus canonical RPC checks fixed this without weakening provenance.
- Next normalized the internal request URL to `localhost`. The local API now
  accepts that internal representation while still requiring exact external
  Host/Origin, port and session token; regression and actual HTTP checks passed.
- An existing analysis ID could return a result for a different requested
  threshold. Exact input binding now rejects the mismatch, including after
  restart; two regression tests and real HTTP checks passed.
- A reloaded draft could display 70% alongside a historical 79.42% ALLOW.
  History selection/loading now synchronizes the draft; the verdict explicitly
  names its bound threshold. Editing the draft without recomputing shows a
  warning and disables all authorization buttons. Busy operations prevent
  changing the selected flow or draft.
- The first local receipt script had a process-name shadowing error, and the
  first restart HTTP probe used the wrong private journal directory. Both
  harness issues were corrected before their passing results; neither first
  attempt is claimed as a pass.

## Preservation and privacy

- V1 manifest SHA-256 remains
  `d98aa57f79c3fc916f3582c79c3d7254f00f94cb87b96f0c22e11119421e35e4`. V1
  contracts, ABI, Studio index and the existing deployment-helper port were not
  replaced.
- `.env.local`, private Graph endpoint, reviewer identity, Privy resource IDs,
  session URLs and raw authorization artifacts remain local/ignored. A scan
  against their actual values found no occurrence in public candidate files.
- Next deployment traces contained no `.local` or `.env` files. The console
  binds only to `127.0.0.1:4180`; this is not production authentication.
- Local `PLAN.md` remains ignored; the reviewed public planning copy and
  implementation/sponsor status were updated separately.

## Not completed

- Dedicated operator test gas and actual human EIP-712 review.
- Operator-specific live Privy policy activation/signing, independent authority
  transaction, public Sepolia propose/decision/execute receipt verification, and
  resulting new Graph events changing analysis.
- Runtime AI provider configuration/live call, hardware TEE attestation, public
  hosting, repeated complete demos and final video.

Mocked provider tests, Anvil signing and agent-operated UI checks cannot satisfy
those gates. Follow the [console runbook](../console-runbook.md); do not relax
freshness, reuse expired review evidence or auto-resend ambiguous transactions.
