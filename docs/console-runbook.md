# Local v2 operation console

## What is implemented

`/console` is a **single-user, loopback-only** control plane over the reviewed
Sepolia v2 deployment. It is not publicly deployed and is not production
multi-user governance. V1 addresses, ABIs, Studio index and evidence remain
unchanged. The [Graph v2 manifest](../deployments/graph-sepolia-v2.json) pins
the independent index deployment.

```sh
pnpm install --frozen-lockfile
pnpm --dir apps/web build
pnpm console:start
```

The launcher binds **127.0.0.1:4180**, checks that the port is free, generates a
32-byte session token and saves the private opening URL to
`.local/console/open-url.txt` (0600). Open that file's URL in the participant's
Chrome profile. The fragment is consumed into sessionStorage and immediately
removed from the address bar. Never paste the token/URL into public docs, commit
it, expose this port through a tunnel, or serve `.local`.

Prerequisites, all local and ignored:

- Root `.env.local`: `GRAPH_V2_QUERY_URL`, `NEXT_PUBLIC_PRIVY_APP_ID`,
  `PRIVY_APP_SECRET`, optional `SEPOLIA_RPC_URL`. No private key is needed.
- Existing reviewed `.local/deployment-review/approved-v2-roles.json` with
  `chainId`, `admin`, `operator`, `decisionAuthority`, `reviewer`.
- Existing dedicated `.local/privy-operator-candidate/resources.json` with
  `walletId`, `policyId`, `address`, `assignedExecutor`, `assignedChainId`.
- The actual CRE CLI at `~/.cre/bin/cre`, repository toolchain and SDK
  dependencies.
- MetaMask accounts for the existing admin, offchain reviewer and independent
  decision authority. The Privy operator is not a MetaMask private-key import.

Role values must match the reviewed v2 manifest and be distinct. Missing local
configuration disables the API; it never silently substitutes demo accounts.

## Ordered workflow

The console first restores the local durable journal independently of live
Privy/RPC checks. A slow or unavailable provider must not erase history or reset
the selected run to READY. Selection, draft and pending-request metadata survive
reload; credentials remain in sessionStorage and signatures/raw transactions are
never browser recovery data. Wallet account/network changes update passively.
Only the current next action is shown; completed steps remain completed even
when their evidence can no longer authorize another step.

1. **Prepare gas.** Read the operator balance/policy. If needed, the console
   prepares a 0.01 Sepolia ETH funding transfer from the approved admin. Review
   the destination and network in MetaMask. This is test gas, not a role grant,
   faucet claim, paid network publication or protocol token transfer.
2. **Analyze 70%.** Fetch the pinned hosted v2 snapshot, reconcile all positions
   and totals with same-block RPC, and run the actual CRE CLI handler. The
   seeded market produces BLOCK. No signing or transaction is available for
   BLOCK.
3. **Recompute the candidate.** The recommendation comes from deterministic
   search inside the handler. Click the candidate to create a **new** snapshot,
   intent nonce, preflight and CRE decision. Never modify the old BLOCK record.
   The verdict names its bound threshold. Editing the draft without recomputing
   disables authorization. Selecting history deliberately restores that run's
   input; reloading the page preserves an edited draft separately from evidence.
4. **Human review.** Read the four-cell comparison and evidence fields, then the
   user clicks the EIP-712 authorization button and signs with the designated
   offchain reviewer. New runs use a fixed ten-minute maximum from analysis and
   explicitly require refreshed data to remain identical. The server refreshes
   Graph/RPC before issuing and accepting this signature. A chat “confirmed,” a
   test signature or an agent click is not a certificate of human risk review.
   The server recovers and verifies the real signer.
5. **Propose.** Privy gets one exact `propose` intent policy. The server
   verifies the complete signed EIP-1559 transaction, restores and reads back
   wildcard DENY, revalidates state, then broadcasts. Two confirmations, the
   exact mined envelope, both proposal events and the receipt-block proposal are
   required.
6. **Decision.** Switch MetaMask to the independent decision authority. Review
   the exact zero-value `recordDecision` transaction. The server verifies its
   sender/nonce/gas/fees/data and canonical receipt before accepting ALLOWED.
7. **Execute.** Recheck the owned CRE result, review, data freshness, live code
   hashes/roles/owner/allowlist, stateVersion, epoch, proposal and nonce. The
   dedicated Privy wallet signs only the exact `execute` intent, then returns to
   DENY before broadcast. Success requires exact events and LT/version reads at
   the receipt block. Two confirmations are **not finality**.
8. **Graph postcondition.** After execution, use the read-only “Graph new
   events” check. It requires indexed LT/state-version events and matching
   proposal hashes, plus a changed health calculation from the fresh AFTER
   snapshot. It will not fabricate this proof if the index has not caught up.
9. **Download evidence.** The private canonical bundle includes actual resource
   IDs and stays under `.local/console/evidence`. The downloadable public proof
   redacts them and has its **own** hash; it is not falsely presented as the
   unredacted bundle's hash.

## Failure, expiry and recovery

- Keep the **120 seconds / 12 blocks** snapshot freshness limits. NEW
  `exact-state-v1` grants acquire fresh observations of the identical reviewed
  state at every step. Human authorization has a separate ten-minute maximum.
  Legacy reviews keep the old snapshot-bound window. Neither mode extends intent
  expiry. Changed inputs/permissions or reorgs require a new review. Compilation
  still precedes snapshot acquisition.
- Raw MetaMask V4 payloads explicitly include `types.EIP712Domain`; otherwise
  wallet hashing can differ from viem's inferred domain. The backend never
  accepts legacy domain-omitting signatures as a fallback.
- The countdown is only the time budget, not proof of valid block distance,
  signer, code or market state. `ISSUED` means review content was prepared; only
  `ACCEPTED` / “审核签名已验证” means the configured signer was authenticated.
  Rejected attempts persist phase, issue/completion times, remaining time and a
  fixed reason code, but never rejected signatures or raw provider payloads.
  `REVIEW_SIGNER_MISMATCH` is not reported as expiry. Inspect the code before
  retrying; a fresh run still requires substantive human review.
- Every operation uses a single-host durable lock. Signing reserves the wallet
  nonce before calling a provider; ambiguous, timed-out or quarantined jobs keep
  that reservation. Do not delete lock files or release a nonce blindly.
- Broadcast is journaled before RPC. Unknown response / pending receipt never
  triggers automatic resend, replacement fees, a new nonce or a new signature.
- Read-only recovery uses the stored exact plan/hash and repeats canonical
  transaction/event/state verification. If the browser lost an authority hash
  before persisting it, inspect MetaMask/RPC and the private journal manually.
  Do not invent a replacement hash or resend to make the UI green.
- Historical receipt rechecks require RPC access to the **receipt block's
  historical state**, not merely its transaction/receipt. A pruned-state error
  leaves recorded progress intact but is not a successful recheck. Configure and
  verify an archive-capable read endpoint separately; never remove same-block
  state/event checks to hide a provider failure.
- A process restart can display durable history and inspect receipts, but it
  **cannot restore an owned CRE authorization from old JSON**. An existing
  unfinished on-chain flow must be inspected first; do not create a duplicate
  proposal just to get fresh evidence. Do not rebuild/restart during a review.
- Policy cleanup runs in `finally` and refuses to overwrite an unexpected
  external policy. A process crash during temporary activation cannot guarantee
  automatic DENY restoration: the remaining policy is still exact-intent-bound,
  and its durable recovery journal must be inspected before proceeding. The
  trusted app administrator can edit policies; this is not admin-proof quorum.

### Two clocks, no migration of old signatures

The console displays the **authorization deadline** separately from the last
fresh observation. Aging of the original report does not reset completed steps
or invalidate a new exact-state grant by itself. The next action automatically
verifies NEW data; there is no “make old data fresh” button. Changed state stays
blocked, even if a new simulation would ALLOW it.

Old flows are not migrated. For a confirmed proposal/decision whose actual
intent has expired, use **核验链上到期并结束旧授权（不发交易）**. It rechecks
the receipt, canonical state and contract deadline and retires the LOCAL grant.
It preserves the proposal/hash and sends no transaction. Unknown/issued wallet
requests and unavailable historical RPC must be reconciled first. Then create a
NEW analysis, nonce and scoped signature.

See [ADR 0002](decisions/0002-exact-state-authorization.md) for exact bindings,
the reference-market assumption, direct-wallet authority limitation, restart
behavior and local tests. No new contract deployment is required. Public Sepolia
acceptance is a separate user-authorized step.

## Optional grounded AI

Add **both** `OPENAI_API_KEY` and `PARAMSHIELD_EXPLANATION_MODEL` to the ignored
root environment file, choosing an available model with Responses structured
output support, then restart only when no operation is in flight. No key/model
is currently configured or live-verified. Do not paste a key into chat or a
`NEXT_PUBLIC_*` variable.

The server sends only the bounded question and public, numeric evidence facts to
the fixed OpenAI Responses endpoint, with `store: false`, no tools, a timeout
and bounded response size. It does not send role addresses, raw positions,
resource IDs, signatures, policy secrets or raw transactions. The model can only
select existing fact IDs; displayed sentences/numbers come from the
deterministic evidence. Refusal, invalid IDs, incomplete output, missing config
or timeout displays a clearly **non-AI fallback**. AI is never an execution
dependency or authority. See
[official structured-output documentation](https://developers.openai.com/api/docs/guides/structured-outputs).

## Deployment boundary

The existing Next app is preserved. The runner needs the local CRE executable
and durable filesystem/locks; do not copy it to a static host or assume a
Cloudflare Worker can run it. Public hosting and production authentication are
separate, uncompleted gates. Private files are excluded from Next deployment
traces. The browser API uses exact Host/Origin and a bearer token, rejects
forwarded-host changes and unknown request fields, and sends no CORS allowance.
Next internally normalizes loopback URLs to `localhost`; the literal external
Host and browser Origin still must match `127.0.0.1:4180` exactly.

The Graph control/event query pins the **block hash**, then checks canonical RPC
again. During live verification, number-only `_meta` returned a null hash;
hash-selected queries preserve the existing provenance checks rather than
relaxing them.
[The Graph's query documentation](https://thegraph.com/docs/en/subgraphs/querying/graphql-api/#time-travel-queries-example)
also notes reorg limitations; no indexer response by itself proves finality.

### MetaMask EIP-7702 decision receipts (2026-09-10)

If a decision has a hash but the UI reported a missing reviewer signature, do
not re-sign or re-send it. The narrow MetaMask v1.3.0 wrapper verifier described
in [ADR 0003](decisions/0003-metamask-decision-receipts.md) can recognize the
exact inner decision and recover its existing receipt. Unknown formats still
block. Use **只读检查已记录交易（不重发）**. Successful recovery restores
**链上决策已确认**; it does not mean the parameter was executed or an expired
authorization renewed.
