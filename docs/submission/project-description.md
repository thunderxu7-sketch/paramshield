# Project form copy — current-status draft

These are prepared answers, not saved dashboard fields. Actual field names and
character limits must be checked in the live form; none are assumed here.

## Name and tagline

**ParamShield**

Evidence-bound risk checks before DeFi parameter changes execute.

## Short description

ParamShield helps protocol risk teams evaluate a liquidation-threshold change
before it reaches an execution wallet. It combines indexed positions,
deterministic stress tests, confidential policy evaluation and exact-intent
controls. Unsafe changes are blocked; a computed alternative requires fresh
analysis and review. The current prototype includes hosted-data CRE analyses and
a tested local execution lifecycle; final Sepolia execution and runtime AI
acceptance remain pending.

## How it works

The Graph supplies complete block-pinned positions and market/executor state.
Same-block RPC checks corroborate those inputs without replacing the Graph
source. A Chainlink confidential handler recomputes four before/after risk
cells, loads policy and searches for the closest passing LT decrease. We use the
actual CRE CLI simulation lane with a trusted relay, not a hardware-attested
network deployment.

A BLOCK ends that intent. An alternative starts a new snapshot, nonce, analysis
and human review. The dedicated Privy operator is distinct from the offchain
reviewer and onchain decision authority. Exact transaction policies, nonce
reservations, state versions, authorization epochs and canonical receipt checks
bind execution to the reviewed payload. The console preserves interrupted
progress instead of automatically re-signing or broadcasting.

An optional AI evidence selector can choose existing fact IDs; deterministic
code renders the explanation. It cannot invent numeric facts or authorize
transactions. When no model is available, the console explicitly labels its
non-AI fallback. Live AI verification is still pending.

## What is different

- **An execution gate, not another risk dashboard:** evidence is bound to
  calldata, state, permissions and expiry.
- **A rejected proposal stays rejected:** a suggested value is never patched
  into an old approval.
- **Incremental risk, not misleading totals:** existing stressed exposure is
  separated from exposure introduced by this change.
- **Recoverability without silent authorization:** a refresh restores records,
  not expired permissions; confirmed requests do not broadcast again.

## Challenges solved

Matching TypeScript and Solidity rounding; rejecting policy/search leakage;
binding asynchronous review to unchanged state; preserving ambiguous signing
results; and verifying actual mined transaction semantics rather than trusting a
success status or wallet popup. MetaMask compatibility, hosted-index outages and
controlled provider policies were addressed with separated, labeled proof. See
the [architecture](../architecture.md) and [threat model](../threat-model.md).

## Verified scope and limitations

Hosted v2 data, actual CLI analyses and isolated Privy sign/control evidence are
recorded separately. The September 10 source passed 358 unit/contract tests and
three isolated Anvil/CRE lifecycle rehearsals. These are not three real
Sepolia/Privy/human runs. Full public-chain execution, indexed AFTER, runtime
AI, public hosting and human recording are still acceptance gates.

The reference market uses seeded mock assets, one LT parameter and one stress.
It excludes slippage, liquidation costs, oracle dynamics and production solvency
certification. Contract governance and the relay are trusted. Private production
policies are not demonstrated; simulation uses public demo values.

## Human and AI contributions

The participant selected the problem, product direction, scope and account
topology, and directed iterative work. AI assisted specs, implementation, tests,
debugging and this submission draft. Automated tests and chat approvals do not
establish substantive human risk review. The participant must review the final
claims and narrate the actual demonstration. Exact known directions, remaining
history gaps and runtime instructions are in the [AI disclosure](../ai-usage.md)
and [planning record](../planning/README.md).

## Next steps — not shipped features

Close the existing live acceptance gates before adding markets or scenarios.
Network-attested CRE, production governance integration and historical replay
are future work, not capabilities claimed by this submission.
