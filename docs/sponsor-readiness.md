# Sponsor Integration Readiness

**Date:** 2026-09-05  
**Purpose:** Record capability checks without storing credentials.

## Status vocabulary

- **Verified:** a real authenticated request or local official-tool simulation
  succeeded and evidence is recorded.
- **Available:** the account/dashboard or CLI is accessible, but the project has
  not made an authenticated request yet.
- **Blocked:** a specific user or provider action is required.
- **Planned:** no live check has been completed.

## Readiness matrix

| Sponsor       | Account access                                                    | Tool/SDK spike                                                  | Advanced feature                                                                                       | Current status                                   |
| ------------- | ----------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| The Graph     | Event wallet connected and dashboard email verified               | Graph CLI 0.98.1 runs on Node 20.19.2                           | A Studio deployment and API key are deferred until the reference contracts emit data                   | Account and toolchain verified; live query next  |
| Chainlink CRE | CLI authentication verified; deployment-access request is pending | CRE CLI 1.32.0 compiled and simulated the official TEE template | Confidential Workflows deployment remains gated; authenticated local confidential simulation is usable | Local confidential path verified                 |
| Privy         | Developer account and ParamShield development app created         | `@privy-io/node` 0.34.0 imports successfully                    | Manual approvals/key quorums may require an eligible plan; policy or scoped signer is the P0 fallback  | App ready; authenticated SDK read pending secret |

## Qualification contract

### The Graph

The final system must consume fresh Subgraph data in the calculation itself. A
static fixture, RPC-only read, or decorative query panel does not qualify. The
demo will expose indexed block, freshness, query hash, and one position change
that alters the verdict.

### Chainlink CRE

The final system must execute a confidential handler that uses at least one
private policy input. The minimum evidence is a reproducible CLI simulation with
redacted logs and structured output; deployment is pursued when account access
permits it. A standard workflow without a real confidential boundary is not
sufficient for the selected prize.

### Privy

Privy must control execution rather than merely authenticate the UI. The P0
implementation will use the strongest feature verified in this order:

1. manual intent approval with a key quorum;
2. key quorum or authorization-key owner;
3. scoped signer with an enforceable policy; or
4. a policy-bound server wallet.

The exact choice will be recorded here after dashboard and plan access are
verified.

## Evidence log

Do not paste secrets, full tokens, private keys, account emails, or screenshots
containing credentials into this file.

| UTC time          | Integration   | Check                                                         | Sanitized result                                                                                   |
| ----------------- | ------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 2026-09-04T20:56Z | The Graph     | Ran `pnpm spike:graph`                                        | Graph CLI 0.98.1 started successfully on Node 20.19.2                                              |
| 2026-09-05        | The Graph     | Connected the event wallet and verified the dashboard email   | Authenticated dashboard is available; no API key or empty subgraph was created                     |
| 2026-09-04T20:56Z | Chainlink CRE | Ran `pnpm spike:cre`                                          | Official CRE CLI 1.32.0 started successfully; authentication was pending                           |
| 2026-09-05T05:40Z | Chainlink CRE | Authenticated, tested, and simulated the official TEE starter | Nine tests passed; simulation returned a redacted verdict and confirmed secret delivery in the TEE |
| 2026-09-05T05:40Z | Chainlink CRE | Checked deployment access and Sepolia support                 | Sepolia is supported; the private-beta deployment request is pending review                        |
| 2026-09-04T20:56Z | Privy         | Ran `pnpm spike:privy`                                        | Official Node SDK 0.34.0 imported successfully; authenticated read awaited credentials             |
| 2026-09-05        | Privy         | Created a development app and stored its public app ID        | App ID is in a mode-0600 ignored file; no secret is committed or logged                            |

## Go/no-go gates

- **2026-09-05:** install official CLIs/SDKs, verify account paths, and capture
  a minimal sanitized success log for each integration.
- **2026-09-07:** a live Graph query must affect simulation input.
- **2026-09-09:** a confidential CRE simulation must return a validated verdict.
- **2026-09-10:** Privy must authorize a real Sepolia transaction.

If an advanced feature is unavailable, use the documented P0 fallback without
claiming the unavailable feature in the submission.
