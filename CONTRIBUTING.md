# Contributing

ParamShield is developed in small, reviewable increments during ETHOnline 2026.

## Workflow

1. Read the relevant spec and acceptance criteria before implementation.
2. Keep a change focused on one independently verifiable outcome.
3. Add or update tests before marking the outcome complete.
4. Run `pnpm verify` locally.
5. Use a Conventional Commit subject such as
   `feat(risk): simulate threshold changes`.

Do not commit private keys, API keys, authorization keys, account identifiers,
local CRE sessions, deployment broadcasts, or evidence containing secrets.

## Definition of reviewable

A reviewer should be able to identify the requirement, inspect the
implementation and tests, reproduce the result, and understand any remaining
limitation without relying on an uncommitted local note.
