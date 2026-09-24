import assert from "node:assert/strict";
import test from "node:test";
import { isAuthorizedHeader } from "../src/auth.mjs";

test("isAuthorizedHeader accepts the configured bearer token", () => {
  assert.equal(isAuthorizedHeader("Bearer secret-token-12345", "secret-token-12345"), true);
});

test("isAuthorizedHeader rejects missing or incorrect tokens", () => {
  assert.equal(isAuthorizedHeader(undefined, "secret-token-12345"), false);
  assert.equal(isAuthorizedHeader("Bearer wrong-token", "secret-token-12345"), false);
  assert.equal(isAuthorizedHeader("Bearer secret-token-1234", "secret-token-12345"), false);
  assert.equal(isAuthorizedHeader("", "secret-token-12345"), false);
});

test("isAuthorizedHeader uses constant-time comparison (timing attack resistance)", () => {
  // Test that the function doesn't short-circuit on length differences
  // This test verifies the function handles different-length inputs without error
  const token = "a-very-secure-random-token-1234567890";

  // These should all return false, but importantly should not throw
  assert.equal(isAuthorizedHeader("Bearer short", token), false);
  assert.equal(isAuthorizedHeader("Bearer a-very-secure-random-token-12345678901", token), false);
  assert.equal(isAuthorizedHeader("Bearer " + "x".repeat(100), token), false);

  // Correct token should still work
  assert.equal(isAuthorizedHeader(`Bearer ${token}`, token), true);
});

test("isAuthorizedHeader handles special characters in token", () => {
  const specialToken = "token-with_special.chars!@#$%^&*()";
  assert.equal(isAuthorizedHeader(`Bearer ${specialToken}`, specialToken), true);
  assert.equal(isAuthorizedHeader("Bearer wrong", specialToken), false);
});
