import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { capabilities, parseEnv } from "../src/env.ts";

describe("environment contract", () => {
  it("treats an empty variable as absent instead of invalid", () => {
    const env = parseEnv({ PUBLIC_APP_URL: "", DATABASE_URL: "", PRIVY_APP_ID: "", PORT: "8787" });
    assert.equal(env.PUBLIC_APP_URL, undefined);
    assert.equal(env.DATABASE_URL, undefined);
    assert.equal(env.PORT, 8787);
    assert.equal(capabilities(env).database, false);
  });

  it("rejects a malformed value with the variable name", () => {
    assert.throws(() => parseEnv({ DATABASE_URL: "not-a-url" }), /DATABASE_URL/);
    assert.throws(() => parseEnv({ WAVVY_AMM_ADDRESS: "0x1234" }), /WAVVY_AMM_ADDRESS/);
  });

  it("defaults the chain and the bind address", () => {
    const env = parseEnv({});
    assert.equal(env.MONAD_CHAIN_ID, 10143);
    assert.equal(env.HOST, "127.0.0.1");
    assert.equal(env.MULTICALL3_ADDRESS, "0xcA11bde05977b3631167028862bE2a173976CA11");
  });
});
