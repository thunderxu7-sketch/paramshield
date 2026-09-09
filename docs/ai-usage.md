# AI Usage Disclosure

**Updated:** 2026-09-09. Living factual disclosure, not a human-review
certificate.

## Development assistance

Codex assisted product review, specs/planning, architecture, implementation,
tests, debugging, and integration investigation. AI-assisted areas include
`docs/`, the monorepo/tooling configuration, `apps/web/`, `contracts/`,
`packages/`, `subgraph/`, `workflows/`, `infra/`, and `scripts/` as they are
implemented in incremental commits. The public
[planning/prompt record](planning/README.md) documents the available material
directions; missing history is not invented.

Tests, official documentation, and live provider/chain checks are verification
methods, not evidence that a human performed line-by-line code review. Human
contributions visible in the project conversation include choosing the DeFi
parameter-change direction, proposing/prioritizing scope, choosing the product
and event identity, authorizing account setup/deployment actions, and approving
the revised plan. Final substantive human review, interpretation of limitations,
and real demo narration remain submission gates; do not mark them complete
before they occur. Record any additional tools/models actually used, not
guesses.

## Runtime AI (P0, implementation tracked separately)

Evidence-grounded risk Q&A explains deterministic results from **live Graph**
snapshots. It cites existing evidence fields for every number and can identify
affected indexed positions or compare reviewed results. It cannot change policy,
calculate an executable replacement, fabricate missing data, approve, sign,
send, or turn a failure into ALLOW. Missing model access is displayed honestly
while the deterministic evidence remains usable. This is distinct from using AI
to write the code and is required for our chosen Graph AI-use-case positioning.

## Reuse and disclosure

The reference market and project-specific implementation are developed during
the event. External dependencies are recorded in lockfiles; any official starter
used in a shipped workflow must have its source/license and modifications noted.
The earlier official CRE template spike remains a feasibility check. The
September 7 product workflow uses the documented handler/secret/HTTP
registration pattern with project-specific policy, bounded search and strict
result bindings; its source, SDK dependency/license boundaries and actual local
CLI evidence are recorded in the workflow README. This is not a network TEE
deployment. Do not import private pre-event project-specific code.

Keep the local plan ignored but publish all actual sanitized specs, prompts,
planning artifacts, and runtime instructions before submission. The final video
must use real human narration, not AI voice or sped-up narration.

## September 9 implementation disclosure

The v2 index, local console, HTTP authentication boundary, lifecycle
orchestration, Privy policy restoration, broadcast/receipt/event verification,
AI evidence selector and tests/harnesses were AI-assisted. Actual user
direction: “依次执行今天的任务”. This authorizes implementation and
verification, not a claim that the user has already reviewed a specific fresh
risk decision or signed it.

The runtime instruction is checked in verbatim in
[`evidence-explanation.ts`](../apps/web/src/lib/server/evidence-explanation.ts).
The model, when explicitly configured, selects only existing source-field IDs;
the application renders the corresponding deterministic sentences and values.
This deliberately narrower implementation is not unrestricted generative Q&A. No
AI provider was called during the September 9 implementation verification:
provider-response tests are mocked, and the real UI displays the non-AI
fallback. No runtime model name is claimed without an actual provider run.
