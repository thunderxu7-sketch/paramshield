# Sponsor Integration Readiness

**Updated:** 2026-09-08. Account, local build, live read, control proof, and
final product integration are different gates. No credentials are included here.

## Matrix

| Sponsor       | Verified evidence                                                                                                                                                                   | Still missing                                                                                                              |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| The Graph     | Studio v1 DEPLOYED/SYNCED; five positions/config/totals from the official hosted endpoint independently RPC-corroborated at a fresh pinned block; separate local fallback preserved | Hosted v2 index, new-event-to-analysis demonstration, runtime grounded AI and sponsor qualification                        |
| Chainlink CRE | Actual product handler on local live Graph; 7000 BLOCK and fresh 7942 ALLOW; actual CLI/Anvil trusted-relay proof with RPC and review adapters                                      | Full hosted-v2 execution chain; no hardware TEE/network deployment claimed                                                 |
| Privy         | Separate real isolated exact-v2-tuple signature and 13 provider policy denials; RPC/review/signing adapters and durable sign-only coordination verified separately                  | Final operator policy and independent roles onchain, actual human review, public Sepolia broadcast and receipt/state proof |

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

| Time (UTC)     | Integration      | Actual result                                                                                                                                                                       |
| -------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sep 4–5        | Graph            | Account/email/CLI readiness; no hosted subgraph created                                                                                                                             |
| Sep 4 21:40    | CRE              | Official starter: nine tests and local simulation; not hardware TEE                                                                                                                 |
| Sep 4 21:51–54 | Privy            | SDK authentication passed; unused initial app secret revoked                                                                                                                        |
| Sep 7 03:12    | Privy            | One recovered sign-only payload and four policy denials (chain, target, value, calldata argument); no broadcast                                                                     |
| Sep 7          | Graph            | Local Graph Node synced real deployed v1 events and RPC reconciliation passed; see timestamped [artifact](evidence/graph-local-live-v1.json)                                        |
| Sep 7          | CRE              | Product handler returned BLOCK/recommended 7942 and independent ALLOW; real CLI/WASM, local Graph source, no execution; see [artifact](evidence/cre-local-graph-preview.json)       |
| Sep 7 04:16    | Studio diagnosis | TLS-verified curl probe: public page 200, login GraphQL API 503, deploy endpoint GET 200; reachability is not authenticated deployment                                              |
| Sep 8 08:54    | Hosted Graph v1  | Studio v0.1.0 deployed/synced; official hosted query at block 11660066 matched RPC for all five positions/config/totals; 8-second block age, zero lag at validation; no transaction |

The actual Privy check is recorded in
[the machine-readable evidence file](evidence/privy-control-spike-2026-09-07.json).
It never stores raw signed transactions, keys, app IDs/secrets, or resource IDs.
The control library uses decoded Ethereum calldata conditions, not an
unsupported `ethereum_transaction.data` field. API policy-denial responses use
HTTP 400 in this account; a mere HTTP error is not counted as a policy denial.

The test wallet is app-managed and intentionally has no market/executor role.
Its proof policy restricts sign-only calls; final policy configuration and
reviewer authorization must be implemented and verified independently.

## Outage fallback and remaining gates

The [connectivity evidence](evidence/graph-studio-connectivity-2026-09-07.json)
supports an unavailable Studio API path from this egress, not a global outage or
an identified upstream root cause. Retrying a wallet signature or funding it
cannot repair that HTTP 503. Do not reinstall the wallet, change accounts, or
turn off security software merely because Studio's public shell loads.

The [local Graph fallback](../infra/graph-local/README.md) unblocks development.
It uses actual events, but local-only data does **not** complete The Graph prize
requirement. No `graph` provenance is fabricated and no stale/fixture data is
promoted into execution. Goldsky remains a conditional option: account setup and
award suitability would need verification; neither is claimed here.

1. Studio login and hosted v1 deployment/read are complete. Confirm a real new
   event changes the analysis using a separately reviewed transaction; migrate
   to a separately versioned hosted v2 index after v2 deployment.
2. Review/deploy v2 with distinct operational roles, preserved v1 records and
   newly pinned code hashes; update indexing/version manifests.
3. Connect the verified real RPC, persisted-review and exact-signing adapters to
   final live roles and actual human review. Complete the trusted-relay → real
   transaction → receipt/state/evidence chain.
4. Add runtime grounded AI, durable console/idempotency/recovery, repeated demo,
   human review/narration and complete submission materials.

The September 7 local regression had 120 passing tests; September 8 has **150
passing tests** plus actual separated Privy/Anvil proofs. See the
[exact verification record](execution-service.md#local-verification-record). The
hosted deployment continuation changed only configuration/docs/evidence;
subgraph compilation and the real hosted/RPC read passed. It did not rerun
unrelated tests or send a chain transaction.

Sources checked Sep 7:
[The Graph prize](https://ethglobal.com/events/ethonline2026/prizes/the-graph),
[Chainlink prize](https://ethglobal.com/events/ethonline2026/prizes/chainlink),
[Privy prize](https://ethglobal.com/events/ethonline2026/prizes/privy),
[Privy policy documentation](https://docs.privy.io/controls/policies/overview).
Qualification remains subject to the partners' rules and judges, not guaranteed.

## September 8 progress (does not supersede pending live gates)

- Studio recovery progressed beyond HTTP 200: the user confirmed the connection
  terms, the existing event wallet logged in, and the v1 index was deployed and
  queried.
  [Deployment/source evidence](evidence/graph-studio-deployment-2026-09-08.json)
  and [live risk input/output](evidence/graph-live-v1.json) are separate from
  the local fallback. This is a Studio development endpoint, not onchain network
  publication; its documented limit is 3,000 queries/day. See
  [official deployment documentation](https://thegraph.com/docs/en/subgraphs/developing/deploying-publishing/using-subgraph-studio/).
- Real CRE execution-shaped CLI runs and RPC/review/signing adapters passed an
  [owned Anvil integration](evidence/relay-anvil-only-2026-09-08.json). Graph
  provenance there is explicitly synthetic and cannot count for The Graph.
- [Privy v2 tuple control](evidence/privy-v2-control-2026-09-08.json) verifies a
  separate isolated wallet, exact signed fields and 13 actual policy denials. No
  final operator role, funding, organization quorum or public broadcast.
- [v2 preparation](../deployments/v2/README.md) and
  [sign-only service](execution-service.md) are ready for the next live gates;
  no sponsor eligibility or complete E2E is claimed from these layered proofs.
