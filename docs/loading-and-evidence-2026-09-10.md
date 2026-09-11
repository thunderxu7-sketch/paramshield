# September 10 — Loading feedback and evidence-first console

Scope: the Sep 9–10 R-07–R-10 development window. At the user's direction,
unfinished chain verification/execution is **paused**, not marked complete. No
old authorization is retired, renewed or reused by this work.

## Ordered implementation

1. **Loading:** shared busy buttons, high-contrast sticky operation banner,
   elapsed time/slow-request wording, wallet-specific waiting, local Graph/CRE,
   market/Privy, timeline and explanation indicators, first-load skeletons and
   route fallback. No fake percentages or automatic progress completion.
   Existing records stay visible during refresh. Recovered unknown requests are
   static warnings, not fabricated active requests. Reduced-motion preference
   disables animations but retains text/status and disabled controls.
2. **T-502 source traceability:** four-cell values link to their source fields;
   source inspector shows snapshot block/hash/time, algorithm, price, positions
   count, decision/recommendation and original preflight hash. Historical data
   is explicitly not fresh authorization.
3. **T-504 analysis evidence:** separately hashed, whitelisted analysis summary
   downloadable even without final execution. Original preflight and decision
   bindings are checked. It never claims receipt verification/TEE or uses its
   summary hash as an on-chain anchor. No reviewer identity, per-position
   account, signature, raw transaction, policy thresholds, secrets or provider
   URL.
4. **T-505 grounded Q&A:** suggested questions, exact answered question, model
   (only after a real AI response), prompt version, evidence hashes/block and
   per-source citations. Missing/refused/invalid/oversized provider output stays
   explicitly non-AI. Numeric rendering remains deterministic.
5. **Runtime preparation:** optional provider readiness command, prompt/config
   disclosure and the existing single-host runner boundary below. No public
   hosting, new account, key or remote permission is created.

## Runtime AI setup (pending external configuration)

The environment was checked by **presence only**: no project AI key or model is
configured. Do not paste keys into chat or expose `NEXT_PUBLIC` credentials. Set
`OPENAI_API_KEY` and `PARAMSHIELD_EXPLANATION_MODEL` locally in `.env.local`;
select a model supporting Responses API Structured Outputs. See
[official structured output documentation](https://developers.openai.com/api/docs/guides/structured-outputs).
Model selection itself is not a successful provider test.

From repository root, configuration-only check (no provider call):

```sh
node --env-file=.env.local --import ./apps/web/node_modules/tsx/dist/loader.mjs apps/web/scripts/explanation-readiness.ts --check
```

After explicit runtime configuration, execute one read-only provider smoke test
against an existing flow (no new analysis, signature, transaction or journal
write):

```sh
PARAMSHIELD_ROOT="$PWD" node --env-file=.env.local --import ./apps/web/node_modules/tsx/dist/loader.mjs apps/web/scripts/explanation-readiness.ts --live --flow <existing-flow-id>
```

Only `verified: true` / `mode: ai` is live-provider acceptance. The prompt
constant and version are in `apps/web/src/lib/server/evidence-explanation.ts`;
no tool or signing interface is supplied to the model. Unit provider responses
are mocks.

## Runner/hosting boundary

The execution runner is already single-process, token/Origin authenticated and
loopback-only, with a global exclusive mutation lock, bounded subprocesses,
timeouts and durable nonce/job/receipt records. Preserve the same local session
and journals when restarting for a UI build; never restore a CRE capability from
JSON. Public hosting of this admin surface is **not** deployment-ready: account
and reviewer access, remote authentication, durable storage and execution
isolation require a separate reviewed deployment. Do not expose port 4180 or
upload `.local`, `.env.local`, or the operator control resources to a static
host.

## Kept pending

- R-09: real Sepolia final execute and Graph post-execution event verification,
  explicitly paused by user. Previously confirmed propose/decision are
  preserved.
- R-10 external gates: actual AI provider call (key/model absent), safe public
  hosting selection/deployment. Development and mocked tests are not acceptance.
- Sep 11 regression/three live demo runs, Sep 12 video/artifacts and submission
  remain their own work, not silently added to this day's scope.

## Verification — September 10 evening

- Web suite: 245/246 passed on the initial parallel run. One pre-existing
  broadcast-idempotency case exceeded the unchanged 5-second test timeout under
  host load; rerunning only that file with `--maxWorkers=1` passed all 17 cases.
  No test timeout or transaction safeguard was relaxed.
- Final loading regression: 5/5 passed, including the disabled/busy CSS
  specificity fix. Busy controls remain disabled but no longer inherit the
  idle-disabled opacity of 0.35.
- Typecheck and production build passed. Web lint passed with one existing
  unused eslint-disable warning in `bounded-process.ts`. Changed UI/server files
  passed formatting checks; `git diff --check` passed.
- Xu Chrome: the rebuilt console restored the original selected flow and
  recorded proposal; source links scrolled to the exact highlighted field. The
  analysis report downloaded successfully with `executionProven: false`.
- Loading visuals were inspected using the real shared components/CSS in an
  explicitly labeled synthetic, loopback-only fixture: spinner, dots, progress
  sweep, skeletons and wallet-specific banner. This did not open MetaMask or
  claim live wallet/CRE acceptance. The temporary preview server/tab was closed.
- The same private session was retained across the local rebuild. SHA-256
  comparison of 154 protected local files found no changes to saved flows,
  approval/signing/broadcast records or session configuration.
- Configuration-only AI check returned `configured: false`, key/model absent,
  `providerCalled: false`. No new analysis, signature, transaction broadcast,
  authorization retirement or unfinished receipt recovery was performed.
