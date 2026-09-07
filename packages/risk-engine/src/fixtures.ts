import type { MarketSnapshot } from "@paramshield/shared";
import type { PrivatePolicy } from "./policy";
// Public test fixture mirrored from DemoSeed.sol. Never use as a live-data fallback.
export const DEMO_POLICY: PrivatePolicy = {
  version: "incremental-exposure-v2",
  maxDecreaseBps: 300,
  maxNewNormalLiquidatable: 0,
  maxStressExposureBps: 200,
  stressExposureMode: "incremental",
  stressBps: 1500,
};
export function demoSnapshot(): MarketSnapshot {
  const rows = [
    [10, 12000],
    [10, 15000],
    [10, 13500],
    [5, 7800],
    [20, 20000],
  ] as const;
  return {
    schemaVersion: "paramshield.snapshot.v1",
    chainId: 11155111,
    market: "0xfabda359d272974f6561e907a4bb740b11a9fc26",
    contractVersion: "v1",
    stateVersion: null,
    block: {
      number: 11645965,
      hash: `0x${"1".repeat(64)}`,
      timestamp: 1788681624,
    },
    source: {
      kind: "fixture",
      deployment: "canonical-seed",
      queryId: "market-snapshot-v1",
    },
    fetchedAt: 1788681624,
    liquidationThresholdBps: 8000,
    collateralPriceUsdE18: (2000n * 10n ** 18n).toString(),
    collateralDecimals: 18,
    debtDecimals: 6,
    totalCollateral: (55n * 10n ** 18n).toString(),
    totalDebt: (68300n * 10n ** 6n).toString(),
    positionCount: 5,
    positions: rows.map(([c, d], i) => ({
      account: `0x${(0x1001 + i).toString(16).padStart(40, "0")}`,
      collateralAmount: (BigInt(c) * 10n ** 18n).toString(),
      debtAmount: (BigInt(d) * 10n ** 6n).toString(),
    })),
  };
}
