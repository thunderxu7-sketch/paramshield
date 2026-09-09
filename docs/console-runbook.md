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
   disables authorization; loading/selecting history restores that run's input.
4. **Human review.** Prepare the reviewer wallet before the new analysis. Read
   the four-cell comparison and evidence fields, then the user clicks the
   EIP-712 review button and signs with the designated offchain reviewer. A chat
   “confirmed,” a test signature or an agent click is not a certificate of human
   risk review. The server recovers and verifies the real signer.
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

- Keep the **120 seconds / 12 blocks** snapshot freshness limits and intent
  expiry. Compilation occurs before reading the fresh input. Human delay,
  provider delay, version/epoch changes or a reorg can invalidate a run. A new
  run requires a new human signature; there is no automatic extension.
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
- A process restart can display durable history and inspect receipts, but it
  **cannot restore an owned CRE authorization from old JSON**. Start a fresh
  analysis for further signing. Do not rebuild/restart during an active review.
- Policy cleanup runs in `finally` and refuses to overwrite an unexpected
  external policy. A process crash during temporary activation cannot guarantee
  automatic DENY restoration: the remaining policy is still exact-intent-bound,
  and its durable recovery journal must be inspected before proceeding. The
  trusted app administrator can edit policies; this is not admin-proof quorum.

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
