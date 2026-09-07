# Sponsor Integration Readiness

**Updated:** 2026-09-07. Account, local build, live read, control proof, and
final product integration are different gates. No credentials are included here.

## Matrix

| Sponsor       | Verified evidence                                                                                                              | Still missing                                                                                                   |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| The Graph     | Prior account/email setup; CLI 0.98.1; v1 schema/mappings compile; pinned pagination/reconciliation client tests               | Studio session is logged out; wallet reconnect, authenticated deployment, live query and new-event proof        |
| Chainlink CRE | Prior CLI 1.32.0 authentication and nine official-template tests/local simulation                                              | Product handler, trusted relay and bound live-input run; private-beta network access remains unverified/pending |
| Privy         | Development app SDK authentication; real isolated policy-bound wallet; valid signature recovered; four provider policy denials | Final execution policy, distinct decision role, human-reviewed organization flow and real Sepolia broadcast     |

## Exact partner positioning

- **The Graph — Best AI Tooling or AI Use Case (From Scratch):** live Graph
  positions feed deterministic decisions and grounded risk Q&A. A custom index
  alone does not prove standardized/composable-product eligibility. Raw query
  display or AI-assisted coding alone is not our runtime AI-use-case evidence.
- **Chainlink — Best Confidential Workflow:** meaningful secret policy and
  candidate evaluation in a registered confidential handler. Selected P0 is
  reproducible **CLI simulation + trusted relay**, not real TEE attestation.
  Product integration must go beyond the earlier isolated official starter.
- **Privy — Best B2B financial product:** policy-bound operator plus separate
  decision authority in a parameter-review workflow. Do not delay P0 for an
  unverified advanced quorum, and do not call the sign-only spike a completed
  organizational approval or onchain execution.

## Sanitized evidence log

| Time (UTC)     | Integration | Actual result                                                                                                                                                         |
| -------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sep 4–5        | Graph       | Event wallet connected, email verified, CLI runs; no live subgraph created                                                                                            |
| Sep 4 21:40    | CRE         | Official confidential starter: nine tests and CLI simulation; secret delivery exercised in simulation, **not hardware TEE**                                           |
| Sep 4 21:51–54 | Privy       | SDK user-list authentication passed; unused initial app secret revoked                                                                                                |
| Sep 7          | Graph       | v1 mappings/codegen/WASM build and pinned client tests pass; browser asks to reconnect wallet/accept service terms                                                    |
| Sep 7 03:12    | Privy       | Isolated sign-only policy/wallet verified; wrong chain, target, nonzero value, and changed calldata argument all rejected by provider policy (HTTP 400); no broadcast |

The actual Privy check is recorded in
[the machine-readable evidence file](evidence/privy-control-spike-2026-09-07.json).
It never stores raw signed transactions, keys, app IDs/secrets, or resource IDs.
The control library uses decoded Ethereum calldata conditions, not an
unsupported `ethereum_transaction.data` field. API policy-denial responses use
HTTP 400 in this account; a mere HTTP error is not counted as a policy denial.

The test wallet is app-managed and intentionally has no market/executor role.
Its proof policy restricts sign-only calls; final policy configuration and
reviewer authorization must be implemented and verified independently.

## Next gates

1. Reconnect Studio, deploy the index, query live state and corroborate at its
   block.
2. Run the actual CRE product handler and validate relay inputs/results.
3. Review v2 deployment and distinct operational roles before changing Sepolia.
4. Complete Privy-controlled real execution with receipt/state/evidence
   matching.
5. Add runtime grounded AI, repeat the demo, and publish all submission
   artifacts.

Sources checked Sep 7:
[The Graph prize](https://ethglobal.com/events/ethonline2026/prizes/the-graph),
[Chainlink prize](https://ethglobal.com/events/ethonline2026/prizes/chainlink),
[Privy prize](https://ethglobal.com/events/ethonline2026/prizes/privy),
[Privy policy documentation](https://docs.privy.io/controls/policies/overview).
Qualification remains subject to the partners' rules and judges, not guaranteed.
