export const WAD = 1_000_000_000_000_000_000n;

export function wadMul(a: bigint, b: bigint): bigint {
  return (a * b) / WAD;
}

export function signedWadMul(a: bigint, b: bigint): bigint {
  return (a * b) / WAD;
}

export function signed(value: bigint): bigint {
  return value;
}

export function positionPnl(isLong: boolean, size: bigint, entryPrice: bigint, exitPrice: bigint): bigint {
  const difference = exitPrice - entryPrice;
  const value = signedWadMul(size, difference);
  return isLong ? value : -value;
}

export function fundingPayment(size: bigint, growth: bigint, lastGrowth: bigint): bigint {
  return signedWadMul(size, growth - lastGrowth);
}

export function positionEquity(args: {
  isLong: boolean;
  size: bigint;
  entryPrice: bigint;
  markPrice: bigint;
  margin: bigint;
  fundingGrowth: bigint;
  lastFundingGrowth: bigint;
}): { equity: bigint; pnl: bigint; fundingCost: bigint } {
  const pnl = positionPnl(args.isLong, args.size, args.entryPrice, args.markPrice);
  const payment = fundingPayment(args.size, args.fundingGrowth, args.lastFundingGrowth);
  const fundingCost = args.isLong ? payment : -payment;
  return { equity: args.margin + pnl - fundingCost, pnl, fundingCost };
}

export function formatWad(value: bigint, decimals = 6): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / WAD;
  const fraction = abs % WAD;
  const scaledFraction = (fraction * 10n ** BigInt(decimals)) / WAD;
  const fractionText = scaledFraction.toString().padStart(decimals, "0").replace(/0+$/, "");
  const body = fractionText.length > 0 ? `${whole}.${fractionText}` : whole.toString();
  return negative ? `-${body}` : body;
}

export function changeBps(current: bigint, reference: bigint): number {
  if (reference === 0n) {
    return 0;
  }
  const difference = current - reference;
  return Number((difference * 10_000n) / reference);
}