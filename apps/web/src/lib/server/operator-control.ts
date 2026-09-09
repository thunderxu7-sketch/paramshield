import { PrivyClient } from "@privy-io/node";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  exactIntentPolicy,
  executionPolicyFingerprint,
} from "./execution-policy";
import { DurableStore } from "./durable-store";
import {
  DurableSigningService,
  privySigner,
  type SigningPlan,
} from "./transaction-signing";

type Policy = Parameters<ReturnType<PrivyClient["policies"]>["create"]>[0];
type Resources = {
  walletId: string;
  policyId: string;
  address: string;
  assignedExecutor: string;
  assignedChainId: number;
};

/** All mutations stay confined to the previously assigned dedicated operator.
 * Restores DENY after every signing attempt, before the caller can broadcast. */
export class OperatorControl {
  constructor(
    readonly client: PrivyClient,
    readonly resource: Resources,
    readonly lock: Policy,
    readonly store: DurableStore,
  ) {}
  static async load(root: string) {
    const resource = JSON.parse(
      await readFile(
        join(root, ".local/privy-operator-candidate/resources.json"),
        "utf8",
      ),
    ) as Resources;
    const lock = JSON.parse(
      await readFile(
        join(root, "deployments/v2/operator-lock-policy.json"),
        "utf8",
      ),
    ) as Policy;
    const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID,
      appSecret = process.env.PRIVY_APP_SECRET;
    if (!appId || !appSecret || resource.assignedChainId !== 11155111)
      throw new Error("Assigned operator configuration required");
    return new OperatorControl(
      new PrivyClient({ appId, appSecret, maxRetries: 0, timeout: 15_000 }),
      resource,
      lock,
      new DurableStore(join(root, ".local/console/operator")),
    );
  }
  async assertPolicy(expected = this.lock) {
    const [wallet, policy] = await Promise.all([
      this.client.wallets().get(this.resource.walletId),
      this.client.policies().get(this.resource.policyId),
    ]);
    if (
      wallet.address.toLowerCase() !== this.resource.address.toLowerCase() ||
      wallet.policy_ids?.length !== 1 ||
      wallet.policy_ids[0] !== this.resource.policyId ||
      (wallet.additional_signers?.length ?? 0) !== 0 ||
      executionPolicyFingerprint(policy) !==
        executionPolicyFingerprint(expected)
    )
      throw new Error("Operator wallet binding or exact policy changed");
    return {
      address: wallet.address,
      locked:
        executionPolicyFingerprint(expected) ===
        executionPolicyFingerprint(this.lock),
      fingerprint: executionPolicyFingerprint(policy),
    };
  }
  async sign(
    jobId: string,
    plan: SigningPlan,
    method: "propose" | "execute",
    signs: DurableSigningService,
    revalidate: () => Promise<void>,
  ) {
    if (
      plan.from.toLowerCase() !== this.resource.address.toLowerCase() ||
      plan.to.toLowerCase() !== this.resource.assignedExecutor.toLowerCase()
    )
      throw new Error("Foreign operator deployment");
    return this.store.exclusive("policy", async () => {
      if (await this.store.read("interrupted"))
        throw new Error("Prior policy operation needs manual recovery");
      await this.assertPolicy();
      await revalidate();
      const policy = exactIntentPolicy(plan.to, plan.data, method);
      await this.store.write("interrupted", {
        jobId,
        method,
        intendedPolicyFingerprint: executionPolicyFingerprint(policy),
        state: "INSTALLING",
      });
      let restored = false;
      try {
        await this.client
          .policies()
          .update(this.resource.policyId, { rules: policy.rules });
        await this.assertPolicy(policy);
        await revalidate();
        return await signs.sign(
          jobId,
          plan,
          privySigner(
            this.client,
            this.resource.walletId,
            this.resource.policyId,
            method,
          ),
          revalidate,
        );
      } finally {
        // Never overwrite an unexpected external policy mutation.
        const observed = await this.client
          .policies()
          .get(this.resource.policyId);
        const fingerprint = executionPolicyFingerprint(observed);
        if (fingerprint === executionPolicyFingerprint(policy))
          await this.client
            .policies()
            .update(this.resource.policyId, { rules: this.lock.rules });
        else if (fingerprint !== executionPolicyFingerprint(this.lock))
          throw new Error("Unexpected policy mutation; no broadcast permitted");
        await this.assertPolicy();
        restored = true;
        await this.store.write("interrupted", null);
        await this.store.write(`signed-${jobId}`, {
          checkedAt: new Date().toISOString(),
          method,
          policyFingerprint: executionPolicyFingerprint(policy),
          restoredDeny: restored,
        });
      }
    });
  }
}
