import { bindDecision, hashCanonical } from "@paramshield/evidence";
import { snapshotSchema, type MarketSnapshot } from "@paramshield/shared";

// This is a NEW off-chain signature meaning, not a longer-lived v2 review.
// Contract v2 already pins the exact intent, market version and role epoch.
export const AUTHORIZATION_MODE = "exact-state-v1" as const;
export const AUTHORIZATION_SECONDS = 600;
export const SNAPSHOT_SECONDS = 120;
export const SNAPSHOT_BLOCKS = 12;
export const REFRESH_RULE =
  "Refresh Graph/RPC before each action; only identical reviewed state is authorized. Any state or permission change requires a new review.";

/** Only observation metadata may change. Include source/deployment, ALL risk
 * inputs and stateVersion: even an economically equivalent intervening update
 * must invalidate the grant. Never hash a subset such as LT + total debt. */
export function marketStateHash(input: MarketSnapshot) {
  const {
    block: _block,
    fetchedAt: _time,
    ...state
  } = snapshotSchema.parse(input);
  void _block;
  void _time;
  return hashCanonical(state);
}

export function authorizationScope(
  preflight: unknown,
  decision: unknown,
  policyHash: `0x${string}`,
) {
  const b = bindDecision(preflight, decision);
  if (
    b.decision.verdict !== "ALLOW" ||
    !/^0x[0-9a-f]{64}$/.test(policyHash) ||
    BigInt(policyHash) === 0n ||
    b.intent.expiresAt >
      b.preflight.validation.validatedAt + AUTHORIZATION_SECONDS
  )
    throw new Error("Invalid exact-state authorization scope");
  const scope = {
    mode: AUTHORIZATION_MODE,
    changeHash: b.changeHash,
    preflightHash: b.preflightHash,
    decisionHash: b.decisionHash,
    marketStateHash: marketStateHash(b.preflight.snapshot),
    policyHash,
    expiresAt: b.intent.expiresAt,
    snapshotMaxAgeSeconds: SNAPSHOT_SECONDS,
    snapshotMaxBlockLag: SNAPSHOT_BLOCKS,
  };
  return { ...scope, scopeHash: hashCanonical(scope) };
}

export function authorizationTypedData(
  preflight: unknown,
  decision: unknown,
  policyHash: `0x${string}`,
  approvedAt: number,
) {
  const b = bindDecision(preflight, decision);
  const scope = authorizationScope(preflight, decision, policyHash);
  if (
    !Number.isSafeInteger(approvedAt) ||
    approvedAt < b.preflight.validation.validatedAt ||
    approvedAt >= scope.expiresAt
  )
    throw new Error("Invalid authorization review time");
  return {
    domain: {
      name: "ParamShield exact-state authorization",
      version: "1",
      chainId: BigInt(b.intent.chainId),
      verifyingContract: b.intent.executor,
    },
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
      ExactStateAuthorization: [
        { name: "scopeHash", type: "bytes32" },
        { name: "changeHash", type: "bytes32" },
        { name: "market", type: "address" },
        { name: "operator", type: "address" },
        { name: "currentLTBps", type: "uint16" },
        { name: "authorizedLTBps", type: "uint16" },
        { name: "stateVersion", type: "uint256" },
        { name: "authorizationEpoch", type: "uint256" },
        { name: "policyVersion", type: "string" },
        { name: "approvedAt", type: "uint64" },
        { name: "expiresAt", type: "uint64" },
        { name: "refreshRule", type: "string" },
      ],
    },
    primaryType: "ExactStateAuthorization" as const,
    message: {
      scopeHash: scope.scopeHash,
      changeHash: b.changeHash,
      market: b.intent.target,
      operator: b.intent.operator,
      currentLTBps: b.intent.currentValueBps,
      authorizedLTBps: b.intent.proposedValueBps,
      stateVersion: BigInt(b.intent.expectedStateVersion),
      authorizationEpoch: BigInt(b.intent.expectedAuthorizationEpoch),
      policyVersion: b.decision.policyVersion,
      approvedAt: BigInt(approvedAt),
      expiresAt: BigInt(scope.expiresAt),
      refreshRule: REFRESH_RULE,
    },
  } as const;
}
