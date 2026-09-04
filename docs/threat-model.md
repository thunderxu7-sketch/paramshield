# ParamShield Threat Model

**Status:** Initial model; update when each integration lands  
**Date:** 2026-09-05

## Assets

- Authority to change a protocol risk parameter.
- Privy app credentials and authorization private keys.
- Chainlink CRE secrets and confidential policy values.
- The exact transaction calldata approved by reviewers.
- Live position snapshots and risk calculation integrity.
- Evidence bundles, hashes, receipts, and audit history.

## Trust assumptions

- Ethereum Sepolia behaves as a public test network, not as a production safety
  guarantee.
- The Graph accurately reflects indexed chain events up to its declared block;
  ParamShield is responsible for freshness checks.
- CRE confidential execution provides the documented isolation and attestation
  properties; workflow source code itself is not assumed confidential.
- Privy enforces the configured owner, signer, quorum, and policy rules.
- Browser input, RPC responses, GraphQL responses, and model output are
  untrusted until validated.

## Threats and controls

| Threat                                            | Impact                                 | Required control                                                                      | Verification                       |
| ------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------- |
| UI shows one value while calldata encodes another | Reviewer authorizes a hidden change    | Decode canonical calldata server-side; show decoded fields; bind hash to raw calldata | Round-trip and tamper tests        |
| Reuse a valid verdict for another call            | Unauthorized parameter update          | Bind chain, target, calldata, nonce, evidence hash, and expiry                        | Contract replay/binding tests      |
| Use stale Graph state                             | Decision ignores new risky positions   | Record indexed block/time and enforce freshness                                       | Stale-data integration test        |
| Forge or mutate a Graph response                  | Incorrect risk result                  | Schema validation, canonical snapshot hash, endpoint metadata                         | Invalid-response tests             |
| Manipulate rounding near health factor 1          | Missed liquidations                    | Fixed-point integer math and explicit rounding direction                              | Boundary/property tests            |
| Leak private policy values                        | Reveals risk operations or credentials | Fetch inside confidential boundary; return rule IDs only; prohibit secret logging     | Log review and canary test         |
| CRE unavailable or malformed                      | Policy bypass                          | No valid verdict means no executable state                                            | Timeout/malformed-output tests     |
| Frontend bypasses approval                        | Unauthorized execution                 | Privy control plus executor-level authorization                                       | Direct-call revert test            |
| Compromised scoped signer calls arbitrary target  | Wallet loss or unsafe calls            | Restrict target, selector, chain, value, and expiry in policy and executor            | Negative policy tests              |
| Replayed or expired approval                      | Stale authorized change executes       | Nonces, expiries, and consumed-change storage                                         | Contract tests                     |
| LLM invents evidence or safe values               | Unsafe recommendation                  | Treat LLM output as presentation only; deterministic engine owns numbers              | Prompt/adversarial tests           |
| UI marks a dropped transaction successful         | False audit trail                      | Require receipt success and state readback                                            | Dropped/reverted transaction tests |
| Evidence file is changed after execution          | Audit mismatch                         | Canonical serialization and onchain-bound hash                                        | Hash verification test             |
| Seed data is presented as live                    | Misleads judges/users                  | Label source mode and block production claims                                         | E2E assertion                      |

## Security invariants

1. No valid current decision means no execution.
2. `BLOCK` can never reach the target contract.
3. `ESCALATE` cannot use the ordinary approval threshold.
4. A change decision is valid for one exact chain, target, calldata, nonce,
   evidence hash, and expiry.
5. The LLM cannot sign, submit, alter hard constraints, or produce an executable
   parameter without deterministic re-validation.
6. Secrets are never committed, sent to the browser, embedded in public build
   output, emitted in events, or written to evidence.
7. Execution success requires receipt success and matching onchain state.

## Secret inventory

| Secret                          | Location                          | Rotation / containment                                      |
| ------------------------------- | --------------------------------- | ----------------------------------------------------------- |
| Graph deploy/query key          | server or deployment secret store | restrict endpoint/domain where possible; rotate on exposure |
| CRE authentication/session      | local CRE config                  | never copy into repository or evidence                      |
| CRE private thresholds          | Vault/secrets path                | expose only rule identifiers outside TEE                    |
| Privy app secret                | server secret store               | server-only; rotate immediately on exposure                 |
| Privy authorization private key | dedicated server secret           | public key only in dashboard/repository docs                |
| Sepolia deployer key            | local/deployment secret store     | use a testnet-only low-value account                        |

The repository ignores `.env*`, private key files, CRE secret YAML files, build
broadcasts, and local planning material. The committed `.env.example` contains
names and descriptions only.

## Review gates

- Update this document after contract interfaces stabilize.
- Add exact policy restrictions after Privy feature access is confirmed.
- Add exact CRE confidentiality boundary after the workflow spike.
- Run secret scanning before every public push and before submission.
- Revisit residual risks before recording the demo.
