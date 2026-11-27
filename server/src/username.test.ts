// Run: npx tsx --test src/username.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalUsername, isCanonicalUsername } from "./username";

test("canonical input: case and a leading @ are normalised", () => {
  assert.equal(canonicalUsername("ada"), "ada");
  assert.equal(canonicalUsername("  @Ada "), "ada");
  assert.equal(canonicalUsername("ADA"), "ada");
  assert.equal(canonicalUsername("demo.bakery_1"), "demo.bakery_1");
});

test("anything else is refused, never stripped into a real name", () => {
  for (const bad of ["аda" /* Cyrillic а */, "ad-a", "a da", "ada!", "ádá", "ad​a" /* zero-width space */, "ab", "x".repeat(25), "", "@"]) {
    assert.equal(canonicalUsername(bad), null, JSON.stringify(bad));
  }
  assert.equal(canonicalUsername(42 as unknown), null);
});

test("names read from the chain are shown only if already canonical", () => {
  assert.equal(isCanonicalUsername("ada"), true);
  for (const lookalike of ["Ada", "ADA", "аda", "ada ", " ada"]) assert.equal(isCanonicalUsername(lookalike), false, JSON.stringify(lookalike));
});
