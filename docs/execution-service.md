# September 8 execution service: implemented versus verified

This is a **single-host, server-only, sign-only** integration. It has no public
HTTP API, organization quorum UI, transaction broadcaster or receipt verifier
yet. The public Sepolia deployment remains v1. Do not call this a completed live
controlled execution.

## Implemented path

1. `CreExecutionRunner` compiles the real product handler before requesting a
   fresh preflight, starts the fixed loopback transport, supplies the public
   demo policy through runtime secrets and invokes the bounded CRE CLI. It
   validates the exact result/run/hash/expiry and keeps an in-process owned-run
   capability. Browser result JSON and old artifacts cannot create one.
2. `createExecutionStatePort` implements real viem RPC reads at one exact block:
   code hashes, operator/authority, market owner/version, authorization epoch,
   allowlist and proposal state/decision hash. Snapshot positions/config/totals
   are corroborated through the actual RPC adapter; block hashes are rechecked.
3. `SignedReviewStore` recovers an EIP-712 signature from the configured
   independent reviewer set. Domain includes chain/executor; message binds
   change/preflight/decision hashes, approval time and expiry. It rejects
   operator self-review, foreign signers, tampering, replay, expiry and
   conflicting overwrite. **A unit/Anvil signature is not a real human review.**
4. `prepareRelaySigning` accepts only an owned CRE run and verified deployment,
   rechecks ALLOW, live contract/RPC state and persisted review, then obtains
   actual pending nonce, gas estimate, EIP-1559 fees and balance. Freshness is
   checked again after the last asynchronous nonce dependency.
5. `DurableSigningService` records SIGNING before the provider request and
   durably reserves that wallet nonce. Privy reads the expected wallet and
   policy, verifies the complete current policy fingerprint (allowing only
   address casing normalization), and signs the exact call. Recovered signer,
   type, chain, target, value, data, nonce, gas, both fees and empty access list
   must match. No raw signed bytes are returned to a UI.
6. State/approval changes during signing quarantine the signature. Duplicate
   successful jobs return the same verified hash without signing again.
   Timeout/crash/provider ambiguity does **not** retry or allocate a new nonce.

## Real observations (separate proofs)

- [Privy v2 control](evidence/privy-v2-control-2026-09-08.json): a new isolated,
  unfunded wallet signs the exact tuple; 13 wrong outer/inner parameters or
  methods receive actual provider policy denials. The target is preserved v1
  with non-executable v2 test calldata; no chain role, broadcast, human approval
  or quorum is claimed. Nested `execute.intent.*` paths are provider-tested, not
  inferred from SDK types. Provider nonce/gas/fees are not policy fields; their
  exact validation is a trusted-server responsibility.
- [Anvil-only CRE/relay](evidence/relay-anvil-only-2026-09-08.json): owned
  ephemeral node + actual product CRE CLI/WASM, blocked proposal rejection,
  missing-review rejection, RPC-signed EIP-712 review authentication, real
  nonce/gas reads, exact local signing and restart-compatible idempotency. A
  real local authorization-epoch rotation blocks signature reuse. No execute
  call is broadcast; LT stays 8000. This uses an explicitly synthetic
  Graph-shaped envelope over local RPC data; it is **not hosted Graph, real
  human review, Privy signing in the harness, or public Sepolia**.
- [Hosted Studio v1](evidence/graph-studio-deployment-2026-09-08.json): after
  explicit connection-terms confirmation, login and authenticated deployment
  succeeded. The official development endpoint supplied all five positions,
  config and totals at block 11660066; same-block RPC reconciliation and
  freshness checks passed. This is a separate real hosted data-readiness proof,
  not the Anvil fixture, hosted v2 execution input or network publication.

Reproduce with `pnpm spike:relay-anvil` and
`pnpm spike:privy-v2 --create-isolated-test-wallet`. The latter creates/reuses
offchain provider resources. Neither sends a public network transaction.

During rerun, the original one-second Anvil cadence exhausted the 12-block
freshness window under machine load; signing failed closed with a stale-snapshot
error. The harness now uses 12-second blocks. Product checks remain **120
seconds / 12 blocks**; no freshness limit was weakened to obtain a passing run.

## Durable storage and recovery

- Ignored `.local/` subdirectories are mode 0700; atomic JSON files are mode
  0600, bounded to 1MB and fsynced before rename, with directory fsync
  afterward.
- Directory locks coordinate this **single host**. No distributed lease, public
  API auth/rate limit, multi-instance failover or automatic stale-lock cleanup
  is implemented. Disk/host administrators remain trusted.
- `SIGNING` after a crash or `UNKNOWN` after provider ambiguity requires
  inspecting the existing request/nonce/provider status. Do not delete records
  or locks merely to retry. Existing keys are idempotent; a different job ID
  cannot reuse a reserved nonce. Nonce reservations are not auto-released.
- `QUARANTINED` bytes remain private for forensic recovery and are never reused
  by the service. Cryptographic signatures cannot themselves be revoked; chain
  version/epoch/expiry gates are needed too.
- `SIGNED` means signed only, **not sent or executed**. Broadcast ambiguity,
  receipt finality/reorg, same-block state confirmation, final evidence and
  browser timeline are the next R-09/R-10 work.
- Runner artifacts are evidence, not restart authorization. After restart,
  obtain fresh indexed input and a new owned CRE run. CLI simulation cannot
  establish hardware TEE attestation; only public demo secrets belong here.

## Remaining integration gates

Hosted v2 Graph input; finalized independently controlled role addresses; new
reviewed v2 deployment and explorer verification; proposal/decision relay
transactions; real human review UI and identity configuration; final operator
policy installation; controlled broadcasting and receipt/state proof. No final
role policy or existing v1 contract is silently altered to bypass these gates.

## Local verification record

- Format, lint and TypeScript checks passed. The web linter retains one
  pre-existing unused-disable warning in `bounded-process.ts`; no new warning is
  introduced by this work.
- The initial parallel `pnpm verify` test phase hit two default 5-second test
  timeouts under host load. Both failed cases passed isolated reruns; then
  `pnpm exec turbo run test --concurrency=1` passed **all 150 tests using the
  unchanged default test timeout** (32 Foundry, 51 web, 14 CRE, 19 Graph client,
  17 risk engine, 9 evidence, 8 shared). Unchanged packages used valid Turbo
  cache results. This is not a production performance benchmark.
- `pnpm build` passed, including the optimized Next.js build. Candidate ABI /
  source hashes and the preserved v1 manifest were independently checked.
- Public changed files were checked against the known local credentials and
  private Privy resource IDs with no matches. Private logs, signatures and IDs
  remain ignored; this is not a full security audit.
- Remote CI runs the normal repository verification on the pushed revision; its
  result must be checked separately, not inferred from local success.
