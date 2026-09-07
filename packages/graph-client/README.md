# Complete Graph snapshots

A server-configured HTTPS endpoint supplies metadata and hash-pinned pages of
positions. Every page must match the initial block/deployment/market; duplicate,
incomplete, stale and error-bearing responses fail closed. Cursor pagination is
bounded at 10,000 positions. The independent RPC port corroborates the indexed
amounts and block, never replaces Graph input. See the Subgraph runbook for the
live integration gate; unit-test HTTP responses are explicitly synthetic.
