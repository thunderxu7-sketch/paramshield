# Judge quickstart

## 0–2 minutes: understand the claim

ParamShield checks **one LT decrease on a reference lending market**, not an
entire protocol's solvency. It connects indexed positions and risk policy to the
exact payload that can execute. A rejected intent cannot become approved by
editing its parameter; the candidate requires a fresh analysis and review.

Start with the [product spec](../product-spec.md),
[trust boundary](../decisions/0001-risk-and-execution-boundaries.md) and
[current execution status](../implementation-plan.md). The latest source may
still be local/unpublished; the submission manifest does not certify GitHub.

## 2–6 minutes: deterministic public example

From a clone or downloaded reviewed source, with Node 20.19+ and pnpm 10.34.5:

```sh
pnpm install --frozen-lockfile
pnpm --dir apps/web exec tsx scripts/judge-preview.ts
pnpm --dir packages/risk-engine test
pnpm --dir packages/evidence test
```

Installation time depends on the machine/network; ten minutes is an inspection
target, not a measured clean-install SLA. No `.env`, wallet, RPC, Docker, CRE
login or Privy account is needed for this example. The preview prints explicit
`liveGraph: false`, `creCli: false`, `privy: false` and `executable: false`.

Expected public fixture results (basis points; USD quantities in JSON use 18
decimals):

| Measurement                           | Result       |
| ------------------------------------- | ------------ |
| Current / proposed LT                 | 8000 / 7000  |
| Current stressed liquidatable debt    | 22,800       |
| Proposed stressed liquidatable debt   | 48,300       |
| Additional stressed liquidatable debt | 25,500       |
| Initial verdict / nearest passing LT  | BLOCK / 7942 |
| Fresh evaluation at 7942              | ALLOW        |
| Regression at 7941                    | BLOCK        |

These values are computed, not an executable recommendation for today's chain
state. Liquidatable debt is not realized loss or bad debt. The separate
[September 10 local rehearsal](../evidence/local-rehearsal-2026-09-10.json)
contains local receipts and zero-duplicate checks, not Sepolia proof.

## 6–10 minutes: inspect sponsor evidence and code

| Layer              | Inspect                                                                                                                                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hosted Graph input | [v2 query evidence](../evidence/graph-live-v2.json), [index manifest](../../deployments/graph-sepolia-v2.json), [reader](../../packages/graph-client/src/index.ts)                                      |
| Policy/search      | [handler registration](../../workflows/chainlink-cre/src/main.ts), [private handler](../../workflows/chainlink-cre/src/workflow.ts), [hosted-input CLI runs](../evidence/cre-hosted-v2-2026-09-09.json) |
| Privy control      | [policy/signing](../../apps/web/src/lib/server/transaction-signing.ts), [provider control evidence](../evidence/privy-v2-control-2026-09-08.json) — isolated sign-only                                  |
| Guarded execution  | [executor](../../contracts/src/ParamShieldExecutor.sol), [v2 deployment](../../deployments/sepolia-v2.json), [receipt checker](../../apps/web/src/lib/server/lifecycle-receipt.ts)                      |
| Risk explanation   | [bounded evidence selector and runtime prompt](../../apps/web/src/lib/server/evidence-explanation.ts); no verified runtime AI yet                                                                       |

Provider evidence is dated and not a reusable authorization. Existing public
artifacts do not yet prove the final full Sepolia execution/Graph AFTER gate.

## Optional deeper checks

```sh
pnpm --dir contracts test
pnpm --dir apps/web exec tsx scripts/submission-check.ts
# Only with Foundry, Bun and configured CRE CLI; disposable local chains:
pnpm rehearse:local
```

The three-run harness takes longer and needs CRE setup. Do not use it to reset
an existing node/market. To operate the private live console, follow the
[separate runbook](../console-runbook.md) using independently reviewed accounts
and configuration. Public clone reproduction must not depend on copying the
author's `.local`, credentials or private review/signature journals.
