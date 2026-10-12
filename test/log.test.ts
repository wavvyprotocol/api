import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { redactText } from "../src/log.ts";

describe("log redaction", () => {
  it("removes a quicknode style key that sits in the url path", () => {
    const text = redactText("POST https://monad-mainnet.quiknode.pro/1a2b3c4d5e6f7a8b9c0d/ failed");
    assert.ok(!text.includes("1a2b3c4d5e6f7a8b9c0d"));
    assert.match(text, /\[redacted\]/);
  });

  it("removes rpc path credentials", () => {
    const text = redactText("URL: https://monad-testnet.blockvision.org/v1/3KSBuxdgMC4gU3YEXLrd7OXaUFC failed");
    assert.match(text, /\/v1\/\[redacted\]/);
    assert.ok(!text.includes("3KSBuxdgMC4gU3YEXLrd7OXaUFC"));
  });

  it("removes connection string passwords", () => {
    const text = redactText("postgres://postgres.abcdef:supersecret@aws-0-host:6543/postgres");
    assert.match(text, /:\/\/\[redacted\]@/);
    assert.ok(!text.includes("supersecret"));
  });

  it("removes query credentials and leaves normal text alone", () => {
    assert.match(redactText("https://host/path?apiKey=abc123&x=1"), /apiKey=\[redacted\]/);
    assert.equal(redactText("market 6 SINGLE_NAME value 520000000"), "market 6 SINGLE_NAME value 520000000");
  });
});
