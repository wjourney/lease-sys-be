import { test } from "node:test";
import assert from "node:assert/strict";
import { accountExpired } from "../src/common/auth/account-expiry";

test("account expiry includes the selected Hong Kong calendar day", () => {
  const expiresAt = new Date("2026-09-30T00:00:00.000Z");
  assert.equal(
    accountExpired(expiresAt, new Date("2026-09-30T15:59:59.999Z")),
    false,
  );
  assert.equal(
    accountExpired(expiresAt, new Date("2026-09-30T16:00:00.000Z")),
    true,
  );
});
