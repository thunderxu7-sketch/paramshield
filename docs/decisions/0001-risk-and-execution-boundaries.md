# ADR 0001 — Make the change gate measurable and its trust explicit

**Accepted:** 2026-09-07 following the user's approval of the planning review.

## Decisions

- Change the demo's absolute stress cap to an **incremental** cap. Retain an
  absolute-mode `NO_SAFE_VALUE` regression. A passing change is not a safe
  market.
- Search only supported decreases, inside the confidential handler. Public
  metrics are reproducible; private candidate decisions are not public evidence.
- Use a DAG of preflight, intent, decision, and final-bundle hashes; no cycles
  or future receipt in the pre-execution hash. Keep `evidenceHash` as the
  Solidity field name, meaning **preflightHash**, not the eventual final bundle
  hash.
- Harden a local v2 market/executor with state-version and authorization-epoch
  checks. Keep the September 6 Sepolia v1 manifest and ABIs immutable. Redeploy
  only after tests and explicit transaction review; never relabel v1 as v2.
- P0 is a reproducible CRE CLI simulation with a **trusted relay**. It is not
  remotely attested TEE execution. Operator and decision authority are different
  identities; governance is trusted and the relay is an explicit residual risk.
- `ESCALATE` is a hold. New review means a new intent and nonce, not overwriting
  a blocked/escalated decision. An alternative must be independently reviewed.
- Choose Privy's first verified enforceable wallet policy/signer control, not a
  speculative complex quorum. Verify real wallet control early.
- Target The Graph AI tooling/use-case category with grounded risk Q&A. Do not
  claim a standardized/composable-subgraph prize based on an isolated custom
  index.
- One operator console; failure paths and repeatability are P0. History, extra
  scenarios, and IPFS cannot delay the primary evidence-backed flow.
- Keep the working `PLAN.md` ignored but publish a sanitized **complete** plan
  plus available material prompts and disclosure. Summaries alone are not
  enough.

## Validation numbers (canonical demo fixture, not private production policy)

All debt figures are mUSDC; total debt is 68,300 and stress is collateral -15%.

| LT bps | Normal liquidatable debt | Stressed liquidatable debt | Additional stressed debt |
| ------ | -----------------------: | -------------------------: | -----------------------: |
| 8000   |                        0 |                      22800 |                        0 |
| 7000   |                    22800 |                      48300 |                    25500 |
| 7800   |                        0 |                      36300 |                    13500 |
| 7941   |                        0 |                      36300 |                    13500 |
| 7942   |                        0 |                      22800 |                        0 |

The 2% incremental allowance is 1,366. No decrease passes the original absolute
2% cap. Simple stressed collateral shortfall is zero throughout this table;
there is no demonstrated avoided bad debt or realized loss reduction.

## Sources checked 2026-09-07

- [Event rules, AI disclosure, and submission requirements](https://ethglobal.com/events/ethonline2026/info/details)
- [The Graph prizes](https://ethglobal.com/events/ethonline2026/prizes/the-graph)
- [Chainlink confidential workflow requirements](https://ethglobal.com/events/ethonline2026/prizes/chainlink)
- [Privy prizes](https://ethglobal.com/events/ethonline2026/prizes/privy)
- [Confidential workflow execution and simulation boundary](https://docs.chain.link/cre-templates/hello-confidential-workflows)

These choices are our interpretation of fit, not a guarantee of eligibility.
