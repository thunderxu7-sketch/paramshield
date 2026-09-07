#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
ENV_FILE="$ROOT/.local/graph-node.env"
if [[ ! -f "$ENV_FILE" ]]; then
  mkdir -p "$ROOT/.local"
  (umask 077; printf 'GRAPH_LOCAL_DB_PASSWORD=%s\n' "$(openssl rand -hex 32)" > "$ENV_FILE")
fi
compose() {
  docker compose --env-file "$ENV_FILE" -f "$ROOT/infra/graph-local/compose.yaml" "$@"
}
case "${1:-status}" in
  up) compose up -d --wait --wait-timeout 120 ;;
  stop) compose stop ;;
  status) compose ps ;;
  health)
    curl --fail --silent --show-error --max-time 15 \
      -H 'Content-Type: application/json' \
      --data '{"query":"{ indexingStatusForCurrentVersion(subgraphName: \"paramshield-v1\") { synced health fatalError { message } chains { network latestBlock { number hash } chainHeadBlock { number } } } }"}' \
      http://127.0.0.1:18030/graphql
    printf '\n'
    ;;
  logs)
    compose logs --tail 60 graph-node 2>&1 | python3 -c 'import sys,pathlib; text=sys.stdin.read(); values=[line.split("=",1)[1] for line in pathlib.Path(sys.argv[1]).read_text().splitlines() if "=" in line];
for value in values:
 if value: text=text.replace(value,"<redacted>")
print(text)' "$ENV_FILE"
    ;;
  deploy)
    pnpm --dir subgraph build
    if ! result=$(pnpm --dir subgraph exec graph create paramshield-v1 --node http://127.0.0.1:18020 2>&1); then
      if ! grep -qi 'already exists' <<< "$result"; then
        printf '%s\n' "$result" >&2
        exit 1
      fi
    fi
    pnpm --dir subgraph exec graph deploy paramshield-v1 --version-label 0.1.0-local --node http://127.0.0.1:18020 --ipfs http://127.0.0.1:15001
    ;;
  *) echo 'Usage: bash scripts/graph-local.sh {up|deploy|status|health|logs|stop}' >&2; exit 1 ;;
esac
