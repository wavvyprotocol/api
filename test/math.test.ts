import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { changeBps, formatWad, positionEquity, positionPnl, WAD } from "../src/math.ts";

describe("fixed point helpers", () => {
  it("keeps a decline negative in basis points", () => {
    assert.equal(changeBps(90n * WAD, 100n * WAD), -1_000, "a 10 percent drop is -1000 bps");
    assert.equal(changeBps(110n * WAD, 100n * WAD), 1_000);
    assert.equal(changeBps(100n * WAD, 100n * WAD), 0);
    assert.equal(changeBps(100n * WAD, 0n), 0, "a zero reference reports no change instead of dividing by zero");
  });

  it("mirrors the contract PnL and equity for both sides", () => {
    const size = WAD;
    const entry = WAD;
    const mark = 1_200_000_000_000_000_000n;
    assert.equal(positionPnl(true, size, entry, mark), 200_000_000_000_000_000n);
    assert.equal(positionPnl(false, size, entry, mark), -200_000_000_000_000_000n);

    const long = positionEquity({
      isLong: true,
      size,
      entryPrice: entry,
      markPrice: mark,
      margin: 2n * WAD,
      fundingGrowth: 0n,
      lastFundingGrowth: 0n,
    });
    assert.equal(long.pnl, 200_000_000_000_000_000n);
    assert.equal(long.equity, 2_200_000_000_000_000_000n);
  });

  it("formats WAD values as decimal strings with the requested precision", () => {
    assert.equal(formatWad(0n), "0");
    assert.equal(formatWad(200_000_000_000_000_000n), "0.2");
    assert.equal(formatWad(2n * WAD), "2");
    assert.equal(formatWad(-200_000_000_000_000_000n), "-0.2");
    assert.equal(formatWad(5n, 6), "0", "dust below the precision rounds to zero, never to a float");
  });
});