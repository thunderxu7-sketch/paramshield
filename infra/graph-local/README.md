# Local Graph Node development fallback

This stack indexes **real Sepolia events** from the existing v1 manifest. It is
not mock data, but it is still a **local-only index**. It does not complete The
Graph's hosted-provider/submission gate and cannot authorize execution.

## Run from the repository root

Prerequisites: Docker/Compose, Node/pnpm, `curl`, `openssl`, and Python 3.

```bash
pnpm graph:local up
pnpm graph:local deploy
pnpm graph:local health
pnpm spike:graph-local
pnpm spike:cre-local
```

`up` means containers started, **not** indexing caught up. On the first run,
Graph Node can spend several minutes bootstrapping its block/ancestor cache;
this Mac/public-RPC run took approximately twelve minutes. Wait for the status
endpoint's `synced: true`, `health: healthy`, no fatal error, and a recent
block. Do not lower reorg protection or relax the 120-second/12-block
application freshness guard to make the demo pass. RPC failures or stale data
abort the spikes without substituting fixtures.

| Service          | Local address                                          |
| ---------------- | ------------------------------------------------------ |
| GraphQL query    | `http://127.0.0.1:18000/subgraphs/name/paramshield-v1` |
| Indexing status  | `http://127.0.0.1:18030/graphql`                       |
| Deployment admin | `http://127.0.0.1:18020`                               |
| IPFS API         | `http://127.0.0.1:15001`                               |

Graph CLI may print its default port `8000` after deployment. Use the explicitly
mapped **18000** above. Repeated deployment was checked and returned exit code
zero with the same content-addressed deployment. Current manifest CID:
`QmTJBKe1xEtjJzay4JBaZMfsKwzJYocmRN7QzxCmy55SUW`.

## Isolation and operations

- Dedicated Compose project and named volumes; no other database is reused.
- All published ports bind to loopback. Postgres is not exposed to the host.
- Images are digest-pinned. Graph Node v0.45.0 runs as `linux/amd64` under
  emulation on this Apple Silicon host.
- The script creates a random database password in ignored
  `.local/graph-node.env`, mode 0600. Do not print `docker compose config` or
  container environments into public logs.
- Optional RPC configuration belongs in that ignored file as
  `GRAPH_LOCAL_RPC_URL=...`; do not put RPC secrets in committed YAML. Use the
  corresponding Sepolia RPC for the independent verification reader when needed.
- Logs default to `info` and rotate at 10 MB × 3 files per container.
- `pnpm graph:local status` lists containers; `health` queries index status;
  `logs` prints a redacted tail. `pnpm graph:local stop` preserves all data.
- Never use `down -v` as routine troubleshooting. Changing a populated database
  password requires an explicit migration, not just regenerating the env file.

## Provenance and migration

[Live evidence](../../docs/evidence/graph-local-live-v1.json) contains the
block/hash, deployment, all five positions and totals, RPC corroboration, and
`source.kind: graph-local`. Local snapshots remain distinguishable from hosted
`graph` snapshots and are rejected by v2 preflight creation/authorization.

The Studio login path returned HTTP 503 on September 7 while its public page
returned 200; the
[connectivity record](../../docs/evidence/graph-studio-connectivity-2026-09-07.json)
is scoped to this client's egress, not a global-outage claim. Keep Studio as the
submission path: after recovery, create/deploy the hosted subgraph and run the
separate hosted spike. A reachable deploy endpoint without a deploy key does not
prove an authenticated deployment. Goldsky is a conditional alternative, not a
provider/account already configured or an assumed prize qualification.

Sources:
[Graph Node](https://thegraph.com/docs/en/indexing/tooling/graph-node/),
[v0.45.0 release](https://github.com/graphprotocol/graph-node/releases/tag/v0.45.0),
[The Graph prize requirements](https://ethglobal.com/events/ethonline2026/prizes/the-graph).
