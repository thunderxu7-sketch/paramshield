# Sepolia v2 — deployed, execution locked

The user approved the role topology, rehearsal, transaction review and broadcast
on September 8. A **new** `ParamShieldBootstrapV2` was deployed in block
[11660450](https://sepolia.etherscan.io/block/11660450), transaction
[0x94bc…233a6](https://sepolia.etherscan.io/tx/0x94bc330ac8eb839bd2eabb8ff907143a169f567b9c9fdbfb48b82d17f08233a6).
The current record is [sepolia-v2.json](../sepolia-v2.json). The September 6
[historical v1 manifest](../sepolia.json) and `deployments/abi/` remain
unchanged.

## Deployed addresses and roles

| Component          | Address                                      |
| ------------------ | -------------------------------------------- |
| BootstrapV2        | `0x67F456834a22cEF89867eFfC8AeC7d33657A63C2` |
| Reference market   | `0x9e268E23cb6ecce47E2482D6Ce222068b03Af35a` |
| Executor           | `0xD971505e814235b668fB56d7000492a9c68D9749` |
| Admin / deployer   | `0x5bE049630A2c8B18F1B6BF53bE95120A3f982fcc` |
| Privy operator     | `0x2801d0FbD05972D40aF0ace94413364f6aE2A3E1` |
| Decision authority | `0x24bd7DFeF1f99Bad775698bb0D8F662fb4C1FC22` |

The selected reviewer is an **offchain** role, not a constructor argument; its
private configuration remains local and its real review-signature workflow is
not yet verified. Selecting separate addresses does not prove independent
organization governance. Admin and the common Privy app/host remain trusted.

## Verification completed

- All **32 contract tests** passed, followed by a successful Foundry Sepolia
  simulation without `--broadcast`. The first invocation had an incorrect
  relative script path and failed before simulation; correcting the working
  directory resolved it. No contract code or safety check was weakened.
- The single dry-run creation input, sender, nonce and predicted address matched
  the wallet plan. A fresh RPC check still returned nonce **9383** immediately
  before the MetaMask confirmation. The confirmed transaction's complete input,
  chain, value, sender, nonce, Gas limit and both fee caps matched exactly.
- Exact RPC gas estimate: **4,422,059**; wallet Gas limit with 20% allowance:
  **5,306,471**; actual gas: **4,386,082**. Actual fee: **0.004465034002383232
  Sepolia ETH**. Transaction value was zero.
- All five deployed runtime bytecodes match the compiled artifacts outside
  compiler-declared immutable slots; their immutable getters were checked
  independently. The complete deployed code hashes are pinned in the manifest.
- Same-block checks verified all roles, market ownership, allowlist, epoch
  **1**, stateVersion **7**, LT **8000**, price **2000**, all five positions,
  token ownership/decimals, total **55 mock ETH / 68,300 mock USDC debt**, and
  actual token balances. `DeploymentCompleted` and the receipt block hash
  matched.
- All five contracts have exact creation/runtime matches on Sourcify and
  verified source on Blockscout. Explorer publication results are recorded per
  contract in the manifest. Sourcify's automatic Etherscan forwarding reported a
  daily submission limit for the bootstrap, market and executor; no Etherscan
  verification is claimed.
- After deployment, a fresh Privy API read confirmed the same wallet binding and
  unchanged [wildcard DENY policy](operator-lock-policy.json). No operator
  funding, key export/import, policy activation, proposal, decision or execution
  transaction was performed.

## Deployment is not execution activation

The initial
[candidate proof](../../docs/evidence/privy-operator-candidate-2026-09-08.json)
is a timestamped pre-deployment snapshot. That candidate is now the onchain
operator, **still locked**; the two older isolated proof wallets were not
reused. The policy is app-managed and can be changed by the app secret, so it is
not admin-proof or independently approved organizational quorum.

The earlier plan incorrectly put final executable policy / human-review
integration before deployment. Those are **activation gates**, not constructor
requirements. The current bootstrap required the approved distinct nonzero
admin/operator/authority addresses and the admin sender, allowing the safe
locked initial deployment above.

Remaining activation work, in order:

1. Deploy/index a **distinct hosted v2 subgraph**, then reconcile its complete
   input against same-block RPC and demonstrate a new event changing analysis.
   Keep v1/local previews clearly separated; do not reuse the v1 endpoint as v2.
2. Authenticate the selected reviewer and decision-authority workflow. An
   address supplied in chat or set in a constructor is not a real human
   approval.
3. Review operator gas funding and the exact propose/decision/execute controls.
   Install only the reviewed intent-specific policy after fresh CRE/RPC/review
   checks; never add an unrestricted `ALLOW` to make a demo pass.
4. Complete real controlled transactions, receipt/state/reorg checks and the
   final evidence bundle. The deployment transaction does not prove this E2E.

## Rehearsal artifacts and reproduction

[preparation.json](preparation.json) is the **10:05 UTC pre-broadcast
snapshot**; its `PREPARED_NOT_DEPLOYED` status is historical, not the current
chain state. `abi/` now corresponds to the source actually deployed as v2.
Source commit: `711ba792af2d32f79eae919eff23279b6585e5fd`; Solidity
`0.8.30+commit.73712a01`, optimizer 200, EVM Prague.

`pnpm deployment:v2:prepare` is a read-only preparation tool and has no signer
or broadcaster. Do not rerun it merely to deploy v2 again or treat a stale
balance, nonce or payload as current. A future deployment needs a separate
reviewed plan. The one-shot local MetaMask helper and its durable submission
journal remain ignored; it cannot automatically send the deployment twice.

Official references:
[Privy policy evaluation](https://docs.privy.io/controls/policies/overview) and
[Sourcify API v2](https://docs.sourcify.dev/docs/api/index.html).
