# September 7 local verification

Command: `pnpm verify` — **passed** on the revised workspace (Node 20.19.2, pnpm
10.34.5, Solidity 0.8.30). Format, lint, typecheck, automated tests and builds
ran. CI runs the same command without local integration credentials.

| Suite             | Passing tests | Scope                                                                                                                                                    |
| ----------------- | ------------: | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Foundry           |            30 | Reference market, all state-version mutations, executor role/epoch/stale/replay/hold guards, bootstrap and golden hash vector                            |
| Shared schemas    |             8 | Strict versioned uint/intent/decision transport                                                                                                          |
| Risk engine       |            17 | Four-cell metrics, 7942/7941 boundary, absolute-policy no solution, changed-input recommendation, integer/zero/overflow/invalid/workload/freshness cases |
| Evidence          |             9 | Canonical serialization, v2 intent hash parity, preflight/decision/receipt/state bindings, tampering and secret-field rejection                          |
| Graph client      |            12 | Synthetic HTTP responses: pinned cursor pagination including >100 positions, incomplete/error/stale/reorg/mismatched data, independent RPC corroboration |
| Web policy helper |             2 | Exact isolated sign-only policy restrictions; malformed target rejection                                                                                 |
| **Total**         |        **78** | Unit/contract/client tests, **not a complete browser E2E run**                                                                                           |

The Subgraph additionally completed `graph codegen && graph build` (WASM)
against the deployed v1 ABIs. The Next.js production scaffold built. Neither
fact proves that the end-to-end console or live index is complete. The previous
web `--passWithNoTests` escape hatch was removed; all implemented TS packages
have actual tests rather than empty package placeholders.

## Separate real provider result

The [Privy control spike](privy-control-spike-2026-09-07.json) is **live**
provider evidence, not a mocked unit test: one allowed signed payload recovered
to the created test wallet, four forbidden mutations denied by Privy policy. It
did not broadcast a transaction, fund a wallet, assign executor roles, or prove
human approval/quorum. Its raw signed transaction is not published.

## Still not verified

- Live Graph deployment/query and onchain-event-to-analysis change (Studio login
  pending).
- Product CRE handler/runner/trusted relay over live input.
- Deployment of local v2 source, role separation onchain and real Privy
  execution.
- Runtime grounded AI, browser E2E, durable idempotency/recovery and three-run
  demo.
- Final prompt-artifact reconciliation, substantive human review and video.

The September 6 `deployments/sepolia.json` and `deployments/abi/` are unchanged.
The repository-local author config now uses the event GitHub account's verified
public noreply identity for new commits; no prior history was rewritten.
