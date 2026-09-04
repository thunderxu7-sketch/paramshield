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

| Sponsor       | Account access                                                  | Tool/SDK spike                               | Advanced feature                                                                                       | Current status                               |
| ------------- | --------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------------- |
| The Graph     | Studio is reachable; event-profile wallet unlock is pending     | Graph CLI 0.98.1 runs on Node 20.19.2        | Studio deploy/query key will be required for deployment                                                | Toolchain verified; blocked on wallet unlock |
| Chainlink CRE | CLI sign-in page is ready; event-account login is pending       | CRE CLI 1.32.0 and Bun 1.4.1 installed       | Confidential Workflows production access is private beta; local confidential simulation remains usable | Toolchain verified; authentication pending   |
| Privy         | Developer sign-in form is ready; event-account login is pending | `@privy-io/node` 0.34.0 imports successfully | Manual approvals/key quorums may require an eligible plan; policy or scoped signer is the P0 fallback  | SDK verified; authentication pending         |

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

| UTC time          | Integration   | Check                                                | Sanitized result                                                                      |
| ----------------- | ------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 2026-09-04        | The Graph     | Opened Subgraph Studio from the event Chrome profile | Dashboard reachable; wallet connection requires the installed wallet to be unlocked   |
| 2026-09-04T20:56Z | The Graph     | Ran `pnpm spike:graph`                               | Graph CLI 0.98.1 started successfully on Node 20.19.2                                 |
| 2026-09-04T20:56Z | Chainlink CRE | Ran `pnpm spike:cre`                                 | Official CRE CLI 1.32.0 started successfully; authentication is pending               |
| 2026-09-04T20:56Z | Privy         | Ran `pnpm spike:privy`                               | Official Node SDK 0.34.0 imported successfully; authenticated read awaits credentials |

## Go/no-go gates

- **2026-09-05:** install official CLIs/SDKs, verify account paths, and capture
  a minimal sanitized success log for each integration.
- **2026-09-07:** a live Graph query must affect simulation input.
- **2026-09-09:** a confidential CRE simulation must return a validated verdict.
- **2026-09-10:** Privy must authorize a real Sepolia transaction.

If an advanced feature is unavailable, use the documented P0 fallback without
claiming the unavailable feature in the submission.
