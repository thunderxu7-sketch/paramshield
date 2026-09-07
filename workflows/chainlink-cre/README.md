# ParamShield confidential policy workflow

The product handler is implemented and was compiled to WASM and run with CRE CLI
1.32.0 against **real Sepolia data indexed by local Graph Node** on September 7.
It is no longer just the earlier official starter's arbitrary scoring function.

## Reproduce the non-executable preview

From the repository root, with a synced local Graph stack:

```bash
pnpm spike:cre-local
```

Requirements: Node/pnpm, Bun (SDK compiler), CRE CLI 1.32.0 with working local
setup, and the [local Graph runbook](../../infra/graph-local/README.md). The CLI
may check Sepolia RPC connectivity even though this workflow does not write to
the chain. No wallet key is passed and `--broadcast` is never used.

The runner compiles first, reads/corroborates a fresh Graph snapshot for
**each** review, starts one loopback-only request server, injects public demo
policy values as a runtime secret, and executes two independent reviews:

- LT 8000 → 7000: **BLOCK**, closest passing alternative **7942**.
- New run, fresh input, LT 8000 → 7942: **ALLOW**, still `executable: false`.

The input is the deployed five-position v1 market, not a JSON fixture loaded as
live data. Values are computed by the risk engine/search within the confidential
handler; the runner asserts the expected demonstration outcomes afterward.

[Machine-readable evidence](../../docs/evidence/cre-local-graph-preview.json)
records requests/results, exact hashes, CLI version, source/lockfile hashes and
WASM SHA-256. `.local/cre-run/` holds ignored runtime files and bounded private
failure diagnostics. This checked-in evidence is a historical observation, not a
current approval to replay later.

## Boundaries

- `cre.handlerInTee` registers AWS Nitro/us-west-2. Secret loading, simulation,
  policy evaluation and candidate search occur in the handler core.
- Returned objects are strict allowlists. No private thresholds, candidate
  traces, raw provider errors, logs, reports or transactions leave the handler.
- **CLI simulation is not a hardware TEE or remote attestation.** Only public
  demo policy values are supplied in this lane; no production secret should be
  tested here. Beta/network deployment is not claimed.
- Local input is labelled `graph-local`, produces only a preview envelope, and
  never acquires a change intent/hash, executable approval or Privy signature.
- A separate v2 execution protocol binds the exact preflight, change hash, run
  ID, policy version and expiry. Its current evidence is unit-test coverage;
  live v2 and hosted Graph input are still required. Binding validation by
  itself does not authenticate a runner or establish truth of a policy verdict.
- Only trusted server code may supply runner commands, config, pinned deployment
  and approval stores. Do not expose arbitrary shell/config/URL selection or
  client-supplied result JSON through an API.
- One run lock; bounded process duration/output; failed/late/ambiguous output
  yields no accepted decision. CLI results are strictly parsed and revalidated
  against freshness and request bindings. Temporary HTTP listener closes after
  success or failure.
- Relative ASCII paths are used for CLI flags because CRE rejects non-ASCII
  `--wasm` paths. The WASM runtime lacks WHATWG `URL`; config validation uses a
  conservative ASCII URL subset instead of assuming Node/browser APIs exist.

## Signing preparation (not live integration)

[Server-side pre-sign checks](../../apps/web/src/lib/execution-preflight.ts)
accept only a bound ALLOW from the trusted runner, a reviewed v2 bytecode/role
configuration, fresh corroborated Graph/RPC state, an onchain ALLOWED proposal
with the same decision hash, and a matching persisted authenticated review. They
build only the exact unsigned Sepolia `execute` calldata and recheck freshness
after asynchronous dependencies.

Production RPC/approval-store adapters, authenticated UI, final Privy control,
actual signing/recovery/broadcast, durable idempotency and receipt handling are
**not** implemented by those pure pre-sign checks. The existing live Privy
sign-only control proof remains isolated/unfunded and has no executor role.

## Reference and verification

Registration/secret/HTTP API pattern follows Chainlink's
[official confidential workflow template](https://github.com/smartcontractkit/cre-templates/tree/main/starter-templates/hello-confidential-workflows)
and
[confidential workflow documentation](https://docs.chain.link/cre-templates/hello-confidential-workflows).
The product policy and protocol are project-specific; the disposable generated
reference is not shipped. SDK 1.18.0 and transitive dependencies/licenses remain
recorded in the lockfile and upstream packages; the project license does not
relicense the SDK.

`pnpm --filter @paramshield/chainlink-cre test` checks policy changes, private
error redaction, exact bindings, expiry/staleness, recommendation consistency
and the handler boundary. Vitest inlines the Bun-targeted SDK for Node unit
tests. These tests are separate from the real CLI/WASM run and from a deployed
network workflow.
