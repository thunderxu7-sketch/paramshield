# Deterministic risk engine

`simulate(snapshot, proposedBps, stressBps)` validates/reconciles the complete
snapshot and computes four bigint matrices with Solidity-equivalent staged
floors. Outputs use decimal strings and null for infinite health; liquidatable
debt is distinct from simple collateral shortfall and never labelled actual
loss.

`@paramshield/risk-engine/policy` exposes `assessAndRecommend`. Run this
**inside the CRE confidential handler** with a secret-loaded policy. Bounded
enumeration never raises LT above current, exposes no candidate trace, and
distinguishes `NO_SAFE_VALUE`, `NO_CHANGE`, and a real recommendation. The
policy library by itself is not a TEE or product CRE integration.

The public fixture subpath is explicitly for tests, not a live fallback. Tests
match DemoSeed.sol and the Solidity preview boundary: 7942 passes the demo's
incremental policy, 7941 fails; the original absolute 2% cap has no solution.

```bash
pnpm --filter @paramshield/risk-engine test
```
