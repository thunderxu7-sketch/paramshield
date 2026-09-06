# Deployments

ParamShield uses a single `ParamShieldBootstrap` contract creation transaction
for its Phase 1 Sepolia deployment. The bootstrap constructor deploys the mock
assets, the reference lending market, and the execution gate; seeds the
canonical five positions; and then transfers market ownership to the gate.

The canonical deployment record is `sepolia.json`. Contract interfaces used by
the web app, indexer, and verification tooling are checked into `abi/`.

## Sepolia

Deployed in block [`11645965`](https://sepolia.etherscan.io/block/11645965) by
[`0x5bE0...2fcc`](https://sepolia.etherscan.io/address/0x5bE049630A2c8B18F1B6BF53bE95120A3f982fcc)
with
[one bootstrap transaction](https://sepolia.etherscan.io/tx/0x2980cde482191ac8481e1a65f2a14cfa46ccc9003b72255a7096f17737bfd2be).

| Contract                 | Address                                                                                             | Verified source                                                                                     |
| ------------------------ | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `ParamShieldBootstrap`   | [`0xDB2F...171A0`](https://sepolia.etherscan.io/address/0xDB2FDFfBa4FBbDc786E8F4823025e24A65D171A0) | [Blockscout](https://eth-sepolia.blockscout.com/address/0xDB2FDFfBa4FBbDc786E8F4823025e24A65D171A0) |
| `MockERC20` (`mETH`)     | [`0x8689...7aCB4`](https://sepolia.etherscan.io/address/0x8689568A568f89CD50536a823C2905Aff427aCB4) | [Blockscout](https://eth-sepolia.blockscout.com/address/0x8689568A568f89CD50536a823C2905Aff427aCB4) |
| `MockERC20` (`mUSDC`)    | [`0x885c...acf66`](https://sepolia.etherscan.io/address/0x885c51aFb58fDd804656EcD45F944E22896acf66) | [Blockscout](https://eth-sepolia.blockscout.com/address/0x885c51aFb58fDd804656EcD45F944E22896acf66) |
| `ReferenceLendingMarket` | [`0xFabd...9fC26`](https://sepolia.etherscan.io/address/0xFabda359d272974F6561E907a4BB740b11A9fC26) | [Blockscout](https://eth-sepolia.blockscout.com/address/0xFabda359d272974F6561E907a4BB740b11A9fC26) |
| `ParamShieldExecutor`    | [`0xF552...381D2`](https://sepolia.etherscan.io/address/0xF5523BDB15d353ABCE276bF6ae02c1C7244381D2) | [Blockscout](https://eth-sepolia.blockscout.com/address/0xF5523BDB15d353ABCE276bF6ae02c1C7244381D2) |

Every contract is an exact creation/runtime match on Sourcify and is published
with verified source on Blockscout. See `sepolia.json` for verification job IDs,
deployment cost, code sizes, roles, and the complete seeded state.

## Reproduce with Foundry

```bash
cd contracts
SEPOLIA_RPC_URL=... \
SEPOLIA_DEPLOYER_PRIVATE_KEY=... \
forge script script/DeploySepolia.s.sol:DeploySepolia \
  --rpc-url sepolia \
  --broadcast
```

Never commit a deployer private key. The initial testnet deployment assigns the
deployer the token owner, Executor admin, operator, and decision-authority
roles. Later integration phases must rotate the operational roles to the
selected Privy and Chainlink CRE controls.
