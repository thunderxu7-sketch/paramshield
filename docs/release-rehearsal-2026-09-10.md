# R-11 brought forward — release regression and rehearsal

Originally scheduled September 11; implementation moved to September 10 at the
user's request. Existing public-chain verification remains paused. Feature
freeze means no new market, scenario, history replay, wallet role, or execution
bypass. Local evidence is not a live-release certificate.

## Ordered delivery and acceptance

| Item                   | Development / local acceptance                                                                                                                            | External acceptance                                                  |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Source freeze          | SHA-256 manifest covers tracked and untracked source, configs, lockfile, public deployment manifests and tests; checks edits/additions/deletions          | Refreeze and rerun affected checks after a consequential change      |
| Failure regression     | Existing stale/version/epoch/timeout/nonce/policy/receipt/refresh tests plus new Graph-after provenance and rehearsal-isolation tests                     | Browser wallet and provider failures require their own real evidence |
| Demo reset             | Each rehearsal provisions a new owned loopback Anvil process, deployment and isolated source/runtime workspace                                            | No existing Sepolia market or wallet is reset by this tool           |
| Three local rehearsals | Actual CRE CLI BLOCK 7000 → fresh recommended ALLOW → synthetic local EIP-712 review → propose/decision/execute → receipt/state → restart/duplicate guard | Not three hosted Graph/Privy/human/browser/Sepolia runs              |
| Security checks        | Dependency advisory check, bounded/strict inputs and existing role/encoding/evidence regressions                                                          | Not a full security audit or production-safety claim                 |

## Regression matrix

Synthetic unit fixtures must never be relabeled as a hosted provider response.

| ID   | Preconditions and steps                                                                                      | Expected result                                                                               | Automated evidence                                                              |
| ---- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| F-01 | Valid snapshot; stale/future timestamps, excessive block lag, missing pages or changed totals                | Fail closed; never substitute fixtures for live data                                          | `packages/shared`, `packages/graph-client` tests                                |
| F-02 | Review one LT/nonce/domain; alter calldata, evidence, signer or state                                        | Reject different intent; preserve previous evidence                                           | evidence/contract, review-store and scoped-authorization tests                  |
| F-03 | Rotate authority/operator/allowlist away and back after signing                                              | Epoch changes revoke the old intent even after restoration                                    | contract tests; owned-Anvil post-sign epoch race                                |
| F-04 | Lose signing or POST result; reload; repeat submit                                                           | Keep unknown state/hash and nonce reservation; no automatic re-sign/send                      | transaction-signing, transaction-broadcast, console-request/state/journal tests |
| F-05 | RPC success with wrong envelope, wrapper, log, receipt block or final state                                  | No success promotion; keep original hash for read-only recovery                               | decision-7702 and lifecycle-receipt tests                                       |
| F-06 | Missing session, foreign Origin or additional RPC/command/body fields                                        | Reject before privileged operation                                                            | console-auth tests                                                              |
| F-07 | Valid indexed execution; mutate deployment/block/roles/epoch/allowlist/preflight/decision/tx/events or reorg | Reject partial or mismatched Graph-after success                                              | new graph-v2-state tests; no live Graph verification                            |
| F-08 | Expired selected flow; network unavailable; delayed older response                                           | Saved progress remains, no restored process capability or renewed authorization               | console-state/journal tests                                                     |
| F-09 | Missing AI config, refusal, wrong source IDs, oversized/failed response                                      | Explicit deterministic fallback; no invented numeric claim or signing access                  | evidence-explanation tests                                                      |
| F-10 | Tamper independent analysis summary bindings                                                                 | Reject; analysis download never becomes execution proof                                       | analysis-report tests                                                           |
| F-11 | Seed secrets/journals and modify/add/delete source in a temporary repository                                 | Copy only frozen source, reject symlinks/source drift/target reuse, strip private environment | new release-workspace tests                                                     |
| F-12 | Fresh local baseline each time; repeat confirmed request after reconstructing durable service                | LT 8000/version 7 → 7942/version 8; original evidence unchanged; zero duplicate broadcasts    | three-run owned-Anvil harness                                                   |

## Commands

From repository root:

```sh
pnpm release:freeze
# Use the exact manifest path printed by the previous command.
pnpm release:check .local/releases/freeze-<id>.json
pnpm rehearse:local
```

The rehearsal command accepts no arbitrary RPC, wallet or reset target. It
refuses an occupied Anvil port rather than killing another process. Each run
copies only frozen repository sources into a unique ignored directory, links
installed dependencies, and creates its own `.local` state. Existing `.env*`,
console session, flows and signing journals are not copied or modified. The CRE
CLI uses its existing local authentication; no new account/key is created.

Artifacts go to `.local/rehearsals/<id>/report.json`, with per-run private raw
proofs inside their isolated workspaces. Incomplete runs remain incomplete in
the report. Old attempts and historical September 9 evidence are not replaced.
Do not upload raw local files. Review a whitelisted summary before publication.

The source freeze covers the working tree, not only Git HEAD, because changes
have not been committed/pushed. It is not a claim that the repository, public
website or partner deployment has been released.

## Public demo reset boundary

The current market is owned by the executor, not directly by the admin EOA. The
admin has role/allowlist management, but the executor has no generic demo reset
function. The current product policy supports LT decreases only. Do not invent
an admin-only reset, force 79.42% back to 80%, clear nonce journals, rotate
roles or relax policy to speed up a demo.

For identical live reruns, prefer separately reviewed fresh deployment(s),
separately bound index/config and exact wallet controls, retaining prior
manifests/evidence. That needs deployment/role/transaction review first. A
continued scenario from a changed market also needs a new baseline, analysis,
intent and review; it cannot be called a rerun of the original 80% baseline.

## Tomorrow's external checklist (ordered)

1. Reconcile the previously recorded transaction hashes and expired intents; do
   not resubmit an old proposal. Current pending flows stay preserved today.
2. Complete one fresh human-reviewed Sepolia flow with distinct reviewer and
   authority, exact Privy operator control, canonical receipts and state reads.
3. Verify hosted Graph indexed the new LT/state-version events and changed the
   calculation, not only that the index is reachable.
4. Configure a project-only AI key/model locally and run the documented live
   evidence-selector check; fallback is not AI acceptance.
5. Approve a safe public-demo hosting boundary and a repeat-run baseline plan.
   Never expose the token-authenticated local admin console as a static demo.
6. Perform three real browser/provider runs with separately recorded intent,
   transaction/evidence hashes and screenshots. Then proceed to September 12
   narration/video and submission material gates.

No reminder/automation, wallet permission, deployment or public publication was
created by moving this development work forward.

## Verification record

Completed on September 10, on the post-remediation frozen source and lockfile:

| Check                            | Result                                                                                                                                                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit and contract regression     | **358 passed**: web 256, shared 8, risk engine 17, evidence 9, Graph client 22, CRE 14, contracts 32. Original Graph tests are preserved; six additional cases and four workspace-isolation cases were added. |
| Production build                 | **8/8 tasks passed**, six cached; web and CRE were built again after the dependency patch.                                                                                                                    |
| Lint / type checks               | Workspace checks passed; affected web lint/types and CRE tests were repeated after the patch.                                                                                                                 |
| Final isolated rehearsals        | **3/3 passed**, each from a fresh owned Anvil deployment and source copy. Actual CRE CLI BLOCK → new ALLOW → local review → three lifecycle transactions → canonical receipts/state → disk-backed recovery.   |
| Safety invariants                | All three: post-sign epoch change and replay rejected; zero duplicate broadcasts; LT 8000/version 7 → LT 7942/version 8.                                                                                      |
| Source freeze                    | **180 source/config/test files**, including uncommitted files and the patched lockfile; no drift during the final runs.                                                                                       |
| Existing console records         | **154 protected files unchanged**, including saved flows, reviews, signing/broadcast records and session.                                                                                                     |
| Production dependency advisories | **0** after the scoped `ws` patch; this is not a full security audit.                                                                                                                                         |

The [sanitized local evidence](evidence/local-rehearsal-2026-09-10.json)
includes per-run local receipt hashes, baseline/final state, a source-manifest
digest and explicit `false` values for live sponsor, human and Sepolia
acceptance. Those transaction hashes belong to disposable local chains, not
Sepolia explorers. Private raw reports and verification logs remain under
ignored `.local`.

The existing loopback console was rebuilt and restarted with its session
preserved. No pending flow was advanced, retired or re-signed. No source was
committed, pushed or publicly hosted.

One initial test-command invocation incorrectly forwarded a Vitest option to
Forge and was rejected before tests ran. The corrected per-package test and
Forge commands passed; that invocation is not counted as a product test result.
Browser wallet/provider E2E, hosted Graph-after verification, real AI response,
public hosting and three live rehearsals remain **unverified**, not passed.

### Dependency finding and remediation

**PS-DEP-WS-20260910** — the production dependency inventory found `ws 8.18.3`
under `@chainlink/cre-sdk 1.18.0 → viem 2.34.0`. The advisories report a high
severity memory-exhaustion issue fixed in 8.21.0 and a moderate
memory-disclosure issue fixed in 8.20.1. This is a dependency finding, not proof
that the local HTTP-only product path was exploited. See the
[maintainer's memory-exhaustion advisory](https://github.com/advisories/GHSA-96hv-2xvq-fx4p)
and
[memory-disclosure advisory](https://github.com/advisories/GHSA-58qx-3vcg-4xpx).

A scoped `viem@2.34.0>ws: 8.21.0` override updates only that transitive
dependency, without changing CRE SDK/viem APIs or the direct web/Privy
dependency line. The lockfile also normalizes ESLint peer identities without
changing their versions. `pnpm audit --prod --json` after installation reports
zero production advisories across 158 dependencies. Development dependencies and
full SAST/DAST were not part of this check. No `audit --fix`, major upgrade,
push or public release was performed.

The three pre-patch local runs passed but are retained as **pre-patch
evidence**. The final source/lockfile was frozen separately and all three
CRE/Anvil rehearsals passed again on that exact version. Only the final set is
included in the linked summary; the earlier runs do not certify the new
dependency tree.
