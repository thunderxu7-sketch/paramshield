# Complete Graph snapshots

A server-configured HTTPS endpoint supplies metadata and hash-pinned pages of
positions. Every page must match the initial block/deployment/market; duplicate,
incomplete, stale and error-bearing responses fail closed. Cursor pagination is
bounded at 10,000 positions. The independent RPC port corroborates the indexed
amounts and block, never replaces Graph input. See the Subgraph runbook for the
live integration gate; unit-test HTTP responses are explicitly synthetic.

## Explicit local development source

`fetchLocalGraphSnapshot` is a separate entry point restricted to exactly
`http://127.0.0.1:18000/subgraphs/name/paramshield-v1`. It rejects credentials,
other ports/hosts/paths and query strings; it is not a generic HTTP bypass. The
existing hosted reader still requires HTTPS. Both readers enforce the same
pagination/count/hash/freshness checks and independent RPC corroboration.

Local results carry `source.kind: graph-local`. Freshness alone is not an
execution permission: `assertFreshSnapshot` and v2 evidence creation still
require hosted `graph` provenance. The
[local runbook](../../infra/graph-local/README.md) and
[actual indexed evidence](../../docs/evidence/graph-local-live-v1.json) cover
the development fallback. Sponsor qualification and future v2 reindexing remain
independent gates.
