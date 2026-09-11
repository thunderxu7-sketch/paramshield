# Partner application drafts

Prepared September 11. Copy only after reviewing the actual form and replacing
pending claims with genuine evidence, or retaining these explicit limitations.
This file does not select prizes or guarantee eligibility. Current category
requirements and source links are in [rules and gates](rules-and-gates.md).

## The Graph — Best AI Tooling or AI Use Case (From Scratch)

### Integration answer

ParamShield is a protocol-operations risk application. Its hosted v2 Subgraph
indexes reference-market positions, configuration and executor authorization
state. The reader pins all pages to one block, reconciles counts/totals and
corroborates the block and values with RPC. Indexed amounts feed a bigint
before/after stress calculation rather than a raw query display. A missing,
stale or incomplete Graph response fails closed.

The AI feature selects existing evidence facts to explain the proposed change;
the deterministic renderer preserves their numeric values and citations. This
feature is implemented but the runtime model has not yet been verified. The
current fallback is explicitly non-AI. We therefore do not yet claim completion
of the AI-use-case acceptance gate.

### Evidence and remaining proof

- [Hosted v2 data](../evidence/graph-live-v2.json),
  [deployment/source manifest](../../deployments/graph-sepolia-v2.json),
  [reader](../../packages/graph-client/src/index.ts),
  [AI selector](../../apps/web/src/lib/server/evidence-explanation.ts).
- Remaining: real model result over live evidence, and new execution events
  changing the AFTER calculation. Local Anvil evidence is not a Graph-provider
  substitute. We are not claiming composable/standardized-product eligibility.

### Experience / feedback

We hit a Studio login API outage while the public site was reachable, so a local
Graph Node kept development moving without mislabeling local data as hosted.
After recovery we deployed separate v1/v2 indices and retained their source/CID
history. Clearer distinctions between account login, index sync and query
readiness would help diagnose this workflow. The observation is from our
recorded access path, not a claim of a global outage.

## Chainlink — Best Confidential Workflow

### Integration answer

The product registers `handlerInTee`; inside the handler it loads a policy
secret, recomputes risk, applies constraints and searches for the nearest
passing decrease. The result leaves through a strict structured boundary:
verdict, rule identifiers, recommendation and bindings, not raw private limits
or full search traces. Removing this handler removes the policy decision path.

We ran the actual CRE CLI/WASM product workflow using hosted v2 input and
obtained BLOCK for 7000, then ALLOW on a fresh 7942 analysis. The chosen lane is
CLI simulation plus a trusted relay. Public demo policy values exercise secret
delivery; we do not claim production-policy confidentiality, hardware TEE
execution, network deployment or onchain attestation.

### Evidence and remaining proof

- [Hosted-input CLI runs](../evidence/cre-hosted-v2-2026-09-09.json),
  [registration](../../workflows/chainlink-cre/src/main.ts),
  [handler](../../workflows/chainlink-cre/src/workflow.ts),
  [workflow README](../../workflows/chainlink-cre/README.md),
  [local lifecycle proof](../evidence/local-rehearsal-2026-09-10.json).
- Remaining: final integrated human-recorded demonstration. Do not turn the
  allowed CLI lane into a claim that the whole Sepolia flow is complete.

### Experience / feedback

The CLI path enabled product integration without depending on network-beta
deployment access. Our runner compiles before acquiring the fresh snapshot and
uses relative ASCII paths for CLI flags; WASM configuration validation avoids
Node-only URL assumptions. More explicit examples of these runtime/path
boundaries would shorten integration. The SDK/template sources and reuse
boundary are disclosed in the workflow README.

## Privy — Best B2B financial product

### Integration answer

ParamShield targets protocol risk councils and operational teams, not retail
trading. A dedicated Privy-managed operator is responsible for the exact
proposal/execution transactions. The application narrows a policy to one
reviewed transaction, verifies the signed fields, restores and verifies DENY,
and rechecks state before broadcast. Persisted nonce reservations prevent an
ambiguous result from becoming a second signing attempt.

The reviewer and onchain decision authority are separate from the operator. The
reviewer supplies an offchain exact-intent signature; the authority sends the
decision transaction through MetaMask. This is not Privy-native quorum approval,
an autonomous AI signer or a production multi-user governance system.

### Evidence and remaining proof

- [Actual isolated control proof](../evidence/privy-v2-control-2026-09-08.json)
  records one exact sign-only request and 13 real policy denials.
- [Deployed roles](../../deployments/sepolia-v2.json),
  [signing service](../../apps/web/src/lib/server/transaction-signing.ts),
  [broadcast coordinator](../../apps/web/src/lib/server/transaction-broadcast.ts).
- Remaining: full fresh human-reviewed Privy/Sepolia execution and final state
  proof. Isolated sign-only evidence is not completion of the business workflow.

### Experience / feedback

Exact decoded-calldata controls gave us a concrete provider-enforced boundary,
instead of treating successful authentication as control. In this account,
policy denials returned HTTP 400; our checks distinguish an actual provider
policy denial from a generic error. Examples combining policy restoration,
durable nonce locks and receipt recovery would be valuable for B2B operators.
