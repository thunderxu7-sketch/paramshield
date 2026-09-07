import { BigInt, ethereum } from "@graphprotocol/graph-ts";
import { Market, MarketEvent, Position } from "../generated/schema";
import {
  ReferenceLendingMarket,
  PositionUpdated,
  LiquidationThresholdUpdated,
  CollateralPriceUpdated,
  OwnershipTransferred,
} from "../generated/ReferenceLendingMarket/ReferenceLendingMarket";

function marketFor(event: ethereum.Event): Market {
  let market = Market.load(event.address.toHexString());
  if (market === null) {
    market = new Market(event.address.toHexString());
    const contract = ReferenceLendingMarket.bind(event.address);
    // Calls at the event block initialize constructor-only config, not fixtures.
    // A failed call halts indexing; never synthesize a price or LT fallback.
    market.owner = contract.owner();
    market.contractVersion = "v1";
    market.stateVersion = null;
    market.liquidationThresholdBps = contract.liquidationThresholdBps();
    market.collateralPriceUsdE18 = contract.collateralPriceUsdE18();
    const cScale = contract.collateralScale(),
      dScale = contract.debtScale();
    let c = 0,
      d = 0;
    while (
      BigInt.fromI32(10)
        .pow(c as u8)
        .lt(cScale)
    )
      c++;
    while (
      BigInt.fromI32(10)
        .pow(d as u8)
        .lt(dScale)
    )
      d++;
    assert(c <= 18 && d <= 18, "Unsupported token scale");
    market.collateralDecimals = c;
    market.debtDecimals = d;
    // Totals are accumulated from PositionUpdated only. Reading final block
    // totals here and adding seed events would double-count the deployment.
    market.totalCollateral = BigInt.zero();
    market.totalDebt = BigInt.zero();
    market.positionCount = 0;
    market.updatedAtBlock = event.block.number;
    market.save();
  }
  return market;
}
function logEvent(event: ethereum.Event, market: Market, kind: string): void {
  const record = new MarketEvent(
    event.transaction.hash.concatI32(event.logIndex.toI32()),
  );
  record.market = market.id;
  record.kind = kind;
  record.blockNumber = event.block.number;
  record.transactionHash = event.transaction.hash;
  record.save();
}
export function handlePositionUpdated(event: PositionUpdated): void {
  const market = marketFor(event),
    id = market.id + "-" + event.params.account.toHexString();
  let p = Position.load(id);
  if (p === null) {
    p = new Position(id);
    p.market = market.id;
    p.account = event.params.account;
    p.collateralAmount = BigInt.zero();
    p.debtAmount = BigInt.zero();
    market.positionCount += 1;
  }
  market.totalCollateral = market.totalCollateral
    .minus(p.collateralAmount)
    .plus(event.params.collateralAmount);
  market.totalDebt = market.totalDebt
    .minus(p.debtAmount)
    .plus(event.params.debtAmount);
  p.collateralAmount = event.params.collateralAmount;
  p.debtAmount = event.params.debtAmount;
  p.updatedAtBlock = event.block.number;
  p.save();
  market.updatedAtBlock = event.block.number;
  market.save();
  logEvent(event, market, "POSITION");
  // Never persist event healthFactorE18 as current health: later LT/price
  // updates do not emit PositionUpdated for every borrower.
}
export function handleThresholdUpdated(
  event: LiquidationThresholdUpdated,
): void {
  const market = marketFor(event);
  market.liquidationThresholdBps = event.params.newThresholdBps;
  market.updatedAtBlock = event.block.number;
  market.save();
  logEvent(event, market, "LT");
}
export function handlePriceUpdated(event: CollateralPriceUpdated): void {
  const market = marketFor(event);
  market.collateralPriceUsdE18 = event.params.newPriceUsdE18;
  market.updatedAtBlock = event.block.number;
  market.save();
  logEvent(event, market, "PRICE");
}
export function handleOwnershipTransferred(event: OwnershipTransferred): void {
  const market = marketFor(event);
  market.owner = event.params.newOwner;
  market.updatedAtBlock = event.block.number;
  market.save();
  logEvent(event, market, "OWNER");
}
