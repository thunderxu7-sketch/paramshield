import { fileURLToPath } from "node:url";
import { writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { hashCanonical } from "@paramshield/evidence";
import { simulate } from "@paramshield/risk-engine";
import { v2Context } from "../src/lib/server/v2-context";
import { readGraphV2State } from "../src/lib/server/graph-v2-state";

async function main() {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const context = await v2Context(root);
  const data = await context.snapshot();
  const live = await context.live();
  const indexedControls = await readGraphV2State(context, data.snapshot);
  const evidence = {
    checkedAt: new Date().toISOString(),
    kind: "hosted-graph-v2-rpc-corroboration",
    ...data,
    snapshotHash: hashCanonical(data.snapshot),
    simulation: simulate(data.snapshot, 7000),
    liveControls: live,
    indexedControls,
    rpcCorroborated: true,
    executionPerformed: false,
    sponsorQualificationClaimed: false,
  };
  await writeFile(
    join(root, "docs/evidence/graph-live-v2.json"),
    JSON.stringify(evidence, null, 2) + "\n",
  );
  const path = join(root, "deployments/graph-sepolia-v2.json");
  const record = JSON.parse(await readFile(path, "utf8"));
  await writeFile(
    path,
    JSON.stringify(
      {
        ...record,
        status: "DEPLOYED_RPC_VERIFIED",
        verifiedAt: evidence.checkedAt,
        indexedBlock: data.snapshot.block.number,
        snapshotHash: evidence.snapshotHash,
      },
      null,
      2,
    ) + "\n",
  );
  console.log({
    indexedBlock: data.snapshot.block.number,
    positions: data.snapshot.positionCount,
    stateVersion: data.snapshot.stateVersion,
    epoch: live.authorizationEpoch,
    rpcCorroborated: true,
  });
}
main().catch((error: unknown) => {
  console.error(
    "V2 Graph verification failed; no fallback or signing performed.",
  );
  // No provider URLs, credentials or response bodies are sent to public logs.
  if (
    error instanceof Error &&
    /^(Stale|Graph deployment|Graph contract version|RPC market mismatch|RPC position mismatch|V2 code)/.test(
      error.message,
    )
  )
    console.error(error.message);
  process.exitCode = 1;
});
