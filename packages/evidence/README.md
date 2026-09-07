# Versioned public evidence

The hash DAG is preflight → exact v2 change intent → decision → receipt/final
bundle. Solidity's `evidenceHash` means the **preflight** hash, never the final
bundle. Versioned canonical JSON sorts object keys, preserves array order,
requires decimal-string uints and safe integer numbers, and rejects lossy
values. This is a project-defined format, not a blanket claim of RFC 8785
conformance.

- `createPreflight`: strict schemas, v2/market/state/expiry binding, fixed
  calldata, live-source freshness, and recomputed deterministic metrics.
- `verifyPreflight`: schema and metric/hash integrity, not a fresh chain read.
- `hashChangeIntent`: Solidity ABI parity, including executor/operator domain,
  market stateVersion and authorizationEpoch. Shared golden-vector regression.
- `bindDecision`: exact bindings and strict public output; not a TEE verifier.
- `createFinalBundle`: consistent ALLOW, receipt event hashes and final state.

Internal consistency does not prove a Graph response is genuine, a CLI run
occurred, a Privy request was authorized, or the chain finalized. The trusted
relay must independently fetch and verify those facts. Fixtures cannot create an
executable preflight. Extra fields/private-policy/search-trace blobs are
rejected; never put secrets in otherwise free-text reason fields.

```bash
pnpm --filter @paramshield/evidence test
```
