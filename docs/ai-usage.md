# AI Usage Disclosure

**Status:** Living disclosure  
**Date:** 2026-09-05

ParamShield is being developed with AI-assisted planning and implementation.
This file will be updated throughout the hackathon so reviewers can distinguish
AI assistance from the product's runtime decision boundary.

## Development-time use

AI tools may assist with:

- product and implementation planning;
- drafting specifications, architecture notes, tests, and documentation;
- code scaffolding and implementation suggestions;
- debugging, refactoring, and code review; and
- preparing evidence-grounded demo narration.

All generated code and claims are reviewed against repository tests, official
documentation, and live integration results. Commit history remains incremental
so the implementation process is reviewable.

## Runtime use

An optional P1 model may turn verified evidence into a concise explanation for
risk council reviewers. Runtime model output is presentation-only.

It may summarize deterministic risk deltas, point reviewers to positions already
present in the evidence bundle, and compare candidate values that have already
passed deterministic simulation.

It may not:

- change policy rules or thresholds;
- calculate or select an unverified executable value;
- fabricate missing market data;
- approve, sign, or send a transaction; or
- convert an invalid, stale, timed-out, or blocked decision into an allowed one.

## Verification boundary

Every number cited by an AI explanation must reference a field in the canonical
evidence bundle. The UI must remain usable when the model is unavailable. A
model failure cannot weaken the default-deny execution path.

## Planning artifacts

The complete working plan remains local while it changes rapidly. Public specs,
architecture decisions, prompts that materially affect the shipped system, and
this disclosure will be committed before submission in accordance with the
event's spec-driven development requirements.
