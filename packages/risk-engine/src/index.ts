import {
  UINT256_MAX,
  snapshotSchema,
  thresholdSchema,
  basisPointsSchema,
  type MarketSnapshot,
} from "@paramshield/shared";
export const ALGORITHM_VERSION = "reference-lending-v2" as const;
const WAD = 10n ** 18n;
function mul(a: bigint, b: bigint): bigint {
  const n = a * b;
  if (n > UINT256_MAX)
    throw new Error("Solidity uint256 multiplication overflow");
  return n;
}

export type PositionRisk = {
  account: string;
  healthFactorE18: string | null;
  collateralValueUsdE18: string;
  debtValueUsdE18: string;
  liquidatable: boolean;
  collateralShortfallUsdE18: string;
};
export type Cell = {
  positions: PositionRisk[];
  liquidatableCount: number;
  liquidatableDebtUsdE18: string;
  collateralShortfallUsdE18: string;
  minFiniteHealthFactorE18: string | null;
  medianFiniteHealthFactorE18: string | null;
};
export type Simulation = {
  algorithmVersion: typeof ALGORITHM_VERSION;
  proposedValueBps: number;
  decreaseBps: number;
  stressBps: number;
  stressedPriceUsdE18: string;
  totalDebtUsdE18: string;
  currentNormal: Cell;
  proposedNormal: Cell;
  currentStress: Cell;
  proposedStress: Cell;
  newlyLiquidatableAccounts: string[];
  newlyLiquidatableDebtUsdE18: string;
  additionalStressedDebtUsdE18: string;
};

function cell(s: MarketSnapshot, lt: number, price: bigint): Cell {
  const cScale = 10n ** BigInt(s.collateralDecimals),
    dScale = 10n ** BigInt(s.debtDecimals);
  const positions = s.positions.map((p): PositionRisk => {
    const cv = mul(BigInt(p.collateralAmount), price) / cScale;
    const dv = mul(BigInt(p.debtAmount), WAD) / dScale;
    const hf = dv === 0n ? null : mul(mul(cv, BigInt(lt)) / 10000n, WAD) / dv;
    return {
      account: p.account,
      healthFactorE18: hf?.toString() ?? null,
      collateralValueUsdE18: cv.toString(),
      debtValueUsdE18: dv.toString(),
      liquidatable: hf !== null && hf < WAD,
      collateralShortfallUsdE18: (dv > cv ? dv - cv : 0n).toString(),
    };
  });
  const hfs = positions
    .flatMap((p) =>
      p.healthFactorE18 === null ? [] : [BigInt(p.healthFactorE18)],
    )
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const middle = Math.floor(hfs.length / 2);
  const median =
    hfs.length === 0
      ? null
      : hfs.length % 2 === 1
        ? hfs[middle]!
        : (hfs[middle - 1]! + hfs[middle]!) / 2n;
  return {
    positions,
    liquidatableCount: positions.filter((p) => p.liquidatable).length,
    liquidatableDebtUsdE18: positions
      .reduce(
        (n, p) => n + (p.liquidatable ? BigInt(p.debtValueUsdE18) : 0n),
        0n,
      )
      .toString(),
    collateralShortfallUsdE18: positions
      .reduce((n, p) => n + BigInt(p.collateralShortfallUsdE18), 0n)
      .toString(),
    minFiniteHealthFactorE18: hfs[0]?.toString() ?? null,
    medianFiniteHealthFactorE18: median?.toString() ?? null,
  };
}

export function simulate(
  input: unknown,
  proposedValueBps: number,
  stressBps = 1500,
): Simulation {
  const s = snapshotSchema.parse(input);
  thresholdSchema.parse(proposedValueBps);
  basisPointsSchema.parse(stressBps);
  const price = BigInt(s.collateralPriceUsdE18);
  const stressedPrice = mul(price, BigInt(10000 - stressBps)) / 10000n;
  if (stressedPrice === 0n)
    throw new Error("Zero stress price is unsupported by the reference market");
  const currentNormal = cell(s, s.liquidationThresholdBps, price),
    proposedNormal = cell(s, proposedValueBps, price);
  const currentStress = cell(s, s.liquidationThresholdBps, stressedPrice),
    proposedStress = cell(s, proposedValueBps, stressedPrice);
  const newPositions = proposedNormal.positions.filter(
    (p, i) => p.liquidatable && !currentNormal.positions[i]!.liquidatable,
  );
  const stressDelta =
    BigInt(proposedStress.liquidatableDebtUsdE18) -
    BigInt(currentStress.liquidatableDebtUsdE18);
  return {
    algorithmVersion: ALGORITHM_VERSION,
    proposedValueBps,
    decreaseBps: s.liquidationThresholdBps - proposedValueBps,
    stressBps,
    stressedPriceUsdE18: stressedPrice.toString(),
    totalDebtUsdE18:
      mul(BigInt(s.totalDebt), WAD) / 10n ** BigInt(s.debtDecimals) + "",
    currentNormal,
    proposedNormal,
    currentStress,
    proposedStress,
    newlyLiquidatableAccounts: newPositions.map((p) => p.account),
    newlyLiquidatableDebtUsdE18: newPositions
      .reduce((n, p) => n + BigInt(p.debtValueUsdE18), 0n)
      .toString(),
    additionalStressedDebtUsdE18: (stressDelta > 0n
      ? stressDelta
      : 0n
    ).toString(),
  };
}
