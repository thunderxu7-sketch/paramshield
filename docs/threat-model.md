# ParamShield Threat Model

**Revision:** 2026-09-07. Reference-market demo only; no production deposits.

## Assets and trust

Assets: exact parameter intent, complete indexed snapshot, policy secrecy,
authorization, replay/expiry state, and truthful evidence. Mock balances have no
real economic value. The operator/browser is untrusted for risk decisions.

Trust: selected P0 uses **CRE CLI simulation + trusted relay**, not remote TEE
attestation. The relay can lie if compromised; the contract authenticates its
address, not its policy computation. Distinct Privy operator and decision
identities reduce accidental bypass but do not eliminate common-host risk.
Governance admin is trusted and can reconfigure roles/allowlists. Production
requires independent infrastructure/governance and a separately verified report
path. Do not market the demo as admin-proof or audited lending infrastructure.

## Required invariants

1. No valid ALLOW and Privy control means no execution. BLOCK/ESCALATE cannot be
   changed to ALLOW; a fresh reviewed intent is required.
2. Intent hash binds executor, operator, chain, target, value, calldata, nonce,
   preflightHash, expiry, market version, and authorization epoch.
3. Every risk-relevant market mutation invalidates old approvals atomically.
   Authorization changes also revoke pending intents, even after role
   restoration.
4. Graph pagination uses one block/hash; totals/count reconcile; stale data,
   indexing errors and RPC disagreement fail closed, not a fixture fallback.
5. The confidential handler recomputes risk from a complete validated snapshot,
   not frontend summary numbers. Private policy evaluation/search stays there.
6. Preflight and decision hashes exclude future receipts. Final-bundle integrity
   is verified separately and never misrepresented as pre-execution anchoring.
7. LLM output cannot alter constraints, calculate an executable value,
   authorize, sign, send, or override failure. Numeric claims require evidence
   references.
8. Receipt success and matching block-pinned state are both required for
   success. On ambiguous submission recover the existing transaction before
   retrying.

## Failure matrix

| Attack/failure                            | Gate and test requirement                                                                  |
| ----------------------------------------- | ------------------------------------------------------------------------------------------ |
| Forged, truncated or stale Graph data     | Block/hash/freshness checks, complete pagination, totals reconciliation, RPC corroboration |
| Changed calldata/nonce/domain/evidence    | Strict encoding and hash parity; contract mismatch/replay tests                            |
| State changes after approval              | Market version at propose and execute; test every mutation and another approved change     |
| Authority/operator/allowlist rotated back | Authorization epoch; stale-epoch tests                                                     |
| Malformed/late/foreign CRE result         | Owned runner, strict schema + exact run/intent bindings; no fabricated fallback            |
| Operator self-approves                    | Distinct roles; separate secrets; unauthorized decision tests                              |
| Secret leakage through outputs            | Explicit public schemas/allowlist, no full search trace or raw logs; safe errors           |
| Repeated recommendation probing           | Service authentication and rate limits; acknowledge unavoidable inference leakage          |
| Wallet policy bypass                      | Actual provider allow/deny evidence; exact target/chain/method restrictions                |
| Duplicate submit/browser reload           | Durable idempotency and receipt recovery; E2E regression                                   |
| Demo rerun changes baseline               | Reviewed reset or new fixture; three-run rehearsal                                         |

## Secrets and privacy

Graph deploy/query tokens, CRE credentials and policy, Privy app secret and
authorization keys, and deployer keys stay in ignored mode-0600 local files or a
server secret store. Never expose them in errors, logs, browser state, generated
builds, evidence, git, or planning artifacts. `.env.example` lists names only.

The public fixture policy is deliberately disclosed for reproducibility. Using
these values as a demo secret exercises secret delivery but does not make them
private. Real policy values must differ and remain external to source. CLI
simulation is not a TEE and should not process real sensitive production input.
Policy versions, verdicts, and recommendations themselves leak some information;
no claim of zero knowledge or information-theoretic privacy is made.

## Local fallback and runner boundary

The development fallback indexes real Sepolia via local Graph Node but emits
`graph-local` previews only. It does not bypass the hosted-source requirement
for v2 preflight creation or imply prize eligibility. The loopback request
server is a local transport, not a public authenticated product API.

The runner executes fixed internal commands with one-run locking and strict
output/time bounds. Any timeout, ambiguous output, wrong run/hash, stale input
or schema failure prevents acceptance. A lock is not durable job idempotency;
crash recovery, authenticated requests and hosted orchestration remain gates.

Pre-sign preparation checks a pinned v2 deployment, distinct roles, fresh
corroborated state, onchain ALLOWED/decision hash and a persisted matching human
review through trusted ports. The ports currently have unit implementations, not
production RPC/identity adapters. Neither forged browser approval booleans nor
structurally valid CLI output alone authorize a transaction. A compromised
server, review store or governance remains inside the stated trust model.

## Release gates

- Local v2 protections are **not** active at the recorded September 6 v1
  addresses.
- Test contract/unit/integration/browser paths separately; no empty-test pass.
- Before public push, scan changed public files and staged diff for secrets.
- Before demo, validate real Graph/CRE/Privy evidence and explorer/state parity.
- Before submission, audit all actual specs/prompts/plans and AI/human
  attribution.
