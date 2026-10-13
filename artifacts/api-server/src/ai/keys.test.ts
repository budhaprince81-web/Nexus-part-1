/**
 * Key-pool tests.
 *
 * The pool is the only thing standing between a revoked/rate-limited credential
 * and a dead provider, so its rotation and de-duplication rules are pinned here.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { KeyPool, parseApiKeys, shouldRotateKey } from "./keys.ts";
import { ProviderError } from "./errors.ts";

test("parseApiKeys splits on commas/whitespace and drops duplicates and blanks", () => {
  assert.deepEqual(parseApiKeys(undefined), []);
  assert.deepEqual(parseApiKeys(""), []);
  assert.deepEqual(parseApiKeys("  "), []);
  assert.deepEqual(parseApiKeys("k1"), ["k1"]);
  assert.deepEqual(parseApiKeys("k1,k2"), ["k1", "k2"]);
  assert.deepEqual(parseApiKeys("k1, k2 ; k3\nk4"), ["k1", "k2", "k3", "k4"]);
  assert.deepEqual(parseApiKeys("k1,k1,k2"), ["k1", "k2"]);
});

test("KeyPool reports configured/size", () => {
  assert.equal(new KeyPool([]).configured, false);
  assert.equal(new KeyPool([]).size, 0);
  assert.equal(new KeyPool([" ", ""]).configured, false);
  assert.equal(new KeyPool(["a", "a", "b"]).size, 2);
});

test("rotation returns every key and starts at a fresh offset each call", () => {
  const pool = new KeyPool(["a", "b", "c"]);
  assert.deepEqual(pool.rotation(), ["a", "b", "c"]);
  assert.deepEqual(pool.rotation(), ["b", "c", "a"]);
  assert.deepEqual(pool.rotation(), ["c", "a", "b"]);
  assert.deepEqual(pool.rotation(), ["a", "b", "c"]);
});

test("a single-key pool always returns that key", () => {
  const pool = new KeyPool(["only"]);
  assert.deepEqual(pool.rotation(), ["only"]);
  assert.deepEqual(pool.rotation(), ["only"]);
});

test("shouldRotateKey only fires for credential-shaped failures", () => {
  const make = (kind: ConstructorParameters<typeof ProviderError>[0]["kind"]) =>
    new ProviderError({ provider: "test", kind, message: "x" });

  for (const kind of ["auth", "quota", "rate_limit"] as const) {
    assert.equal(shouldRotateKey(make(kind)), true, kind);
  }
  for (const kind of ["bad_request", "timeout", "unavailable", "malformed", "aborted", "unknown"] as const) {
    assert.equal(shouldRotateKey(make(kind)), false, kind);
  }
  assert.equal(shouldRotateKey(null), false);
  assert.equal(shouldRotateKey(new Error("plain")), false);
});
