# Separate v2 deployment preparation — NOT deployed

The September 6 v1 manifest and ABIs remain unchanged. Files in this directory
are **candidate v2 ABIs and a read-only preparation report**, not an active
deployment manifest. Do not configure these ABIs against v1 addresses.

## Prepared

- `ParamShieldBootstrapV2` creates/fully seeds the same five-position market,
  installs the current version/epoch-aware executor and transfers market/token
  ownership. Admin, operator and decision authority must all be distinct,
  nonzero addresses; only the named admin can deploy the bootstrap.
- `contracts/script/DeploySepoliaV2.s.sol` accepts public role addresses and
  refuses any chain except 11155111. It does not load a private key from source.
- `pnpm deployment:v2:prepare` rebuilds artifacts, writes candidate ABIs here,
  reads the public Sepolia balance/fees/nonce and v1 state, and proves the v2
  adapter does not silently downgrade on v1. It has **no signer or
  broadcaster**.
- The
  [Anvil-only integration](../../docs/evidence/relay-anvil-only-2026-09-08.json)
  consumed 4,386,070 gas for bootstrap creation. This is not the final Sepolia
  transaction estimate. The preparation report uses a labelled 5.5M-gas planning
  ceiling until final role addresses are chosen.

## Remaining deployment sequence

1. Select and verify the operator and independent decision-authority
   capabilities, including final Privy policies. The two isolated signing-proof
   wallets have **not** been assigned these roles. Separate addresses alone do
   not provide independent infrastructure; common app/host and governance admin
   remain trusted.
2. Set `PARAMSHIELD_OPERATOR` and `PARAMSHIELD_DECISION_AUTHORITY` to those
   verified public addresses and rerun `pnpm deployment:v2:prepare`. This
   generates the exact constructor payload, live estimate +20% gas allowance,
   fee budget and nonce in ignored `.local/deployment-review/`. Review these
   fresh values, never yesterday's balance/nonce.
3. Use the reviewed wallet/keystore path to deploy **a new** bootstrap. Without
   Foundry `--broadcast`, the deployment script only simulates. Neither current
   script nor preparation performs an automatic broadcast.
4. Verify source and actual deployed code; read all roles, version/epoch, owner,
   totals and five positions. Save a new `deployments/sepolia-v2.json` with
   deployment block, addresses, bytecode hashes and explorer evidence. Never
   overwrite `deployments/sepolia.json` or `deployments/abi/`.
5. Configure a v2 subgraph and prove hosted indexing, complete same-block RPC
   reconciliation and a new event changing analysis. Only then enable guarded
   execution; keep the v1/local preview separately labelled.

The checked-in [preparation report](preparation.json) has `roles: null`,
`payload: null`, `PREPARED_NOT_DEPLOYED` and `broadcast: false` deliberately.
Missing final role facts are not filled with invented addresses.
