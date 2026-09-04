# Chainlink CRE Workflow

The production workflow will combine a public intent and deterministic
simulation summary with private risk thresholds. It returns a schema-validated
`ALLOW`, `BLOCK`, or `ESCALATE` result without exposing those thresholds.

## Readiness spike

On 2026-09-05, the authenticated CRE CLI 1.32.0 generated, compiled, tested, and
locally simulated Chainlink's official `hello-confidential-workflows-ts`
template. The spike verified that:

- `cre.handlerInTee` resolved to an AWS Nitro constraint in `us-west-2`;
- a Vault DON secret was injected into an HTTP request without being printed;
- only a redacted verdict crossed back to the Workflow DON; and
- all nine template tests and the TypeScript compiler passed.

The simulator explicitly is not a real TEE. Confidential Workflows deployment
access has been requested and is still pending review, so this evidence proves
local integration readiness rather than a deployed confidential execution.

## Implementation boundary

The generated starter remains a disposable spike and is intentionally not
committed as the product workflow. T-302 will replace the starter's arbitrary
response score with the versioned ParamShield policy from T-301 and bind its
strict output to the live Graph snapshot from T-202. Until then, no generic
template result is represented as a ParamShield risk decision.
