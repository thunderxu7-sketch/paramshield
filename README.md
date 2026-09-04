# ParamShield

> Preflight risk checks for DeFi protocol parameter changes.

ParamShield is a policy-bound execution layer for DeFi risk councils and protocol
operators. Before a parameter change reaches production, it evaluates live
positions, runs deterministic stress tests, applies confidential policy rules,
and either blocks the transaction or routes a safer alternative through
controlled approval.

## Why it exists

Protocol parameter changes are usually reviewed across dashboards, forum posts,
spreadsheets, simulation notebooks, and multisig payloads. That fragmented flow
makes it difficult to prove that the transaction being signed matches the risk
analysis that reviewers saw.

ParamShield turns that review into one auditable pipeline:

1. Decode and bind the proposed calldata to a canonical change intent.
2. Query current market positions through The Graph.
3. Compare current and proposed parameters under normal and stressed prices.
4. Apply private risk limits in a Chainlink CRE Confidential Workflow.
5. Block unsafe changes or recommend the nearest deterministic safe value.
6. Route allowed changes through a Privy-controlled wallet workflow.
7. Verify the Sepolia receipt and produce a hashable evidence bundle.

## ETHOnline 2026 demo

The reference market starts with an 80% liquidation threshold. An operator
proposes lowering it to 70%. Live indexed positions show that the change would
make healthy borrowers immediately liquidatable, and a 15% ETH price shock
would exceed the market's private risk budget. ParamShield blocks the original
payload, computes the nearest safe threshold from the same live data, and lets
the reviewed replacement execute on Sepolia.

## Sponsor integrations

| Integration | Core responsibility |
| --- | --- |
| The Graph | Index positions, market parameters, and execution events; live query results feed the simulation. |
| Chainlink CRE | Run the confidential policy boundary and return a structured `ALLOW`, `BLOCK`, or `ESCALATE` verdict. |
| Privy | Own or control the execution wallet and enforce a real policy, signer, quorum, or intent-based approval. |

Removing any of these integrations breaks the primary workflow; none is used as
an ornamental login or badge.

## Repository status

This repository is being built from scratch during ETHOnline 2026. The current
milestone establishes the specification, trust boundaries, toolchain, and
integration feasibility before protocol code is added.

## Planned workspace

```text
apps/web/                 Next.js operator console
contracts/                Foundry contracts, scripts, and tests
packages/shared/          Canonical schemas and cross-package types
packages/risk-engine/     Deterministic simulation and parameter search
packages/evidence/        Canonical evidence bundle and hashing
subgraph/                 Sepolia indexing schema and mappings
workflows/chainlink-cre/  Confidential policy workflow
tests/e2e/                Browser-level critical-path coverage
docs/                     Product, architecture, security, and AI disclosure
```

## Local development

Prerequisites:

- Node.js 20.19 or newer
- pnpm 11
- Foundry
- CRE CLI 1.32 or newer for workflow simulation

```bash
pnpm install
pnpm verify
pnpm dev
```

Copy `.env.example` to `.env.local` only when an integration requires local
credentials. Never commit deploy keys, authorization keys, wallet keys, or
service secrets.

## Design documents

- [Product specification](docs/product-spec.md)
- [Architecture](docs/architecture.md)
- [Threat model](docs/threat-model.md)
- [AI usage disclosure](docs/ai-usage.md)
- [Sponsor readiness](docs/sponsor-readiness.md)

## Safety principles

- Missing or stale evidence fails closed.
- The value shown in the UI must equal the encoded calldata.
- A verdict is bound to chain, target, calldata, nonce, evidence, and expiry.
- An LLM can explain evidence but cannot change policy, choose an unverified
  parameter, approve, sign, or submit a transaction.
- Execution is complete only after a successful receipt and an onchain state
  read confirm the approved value.

## License

[MIT](LICENSE)
