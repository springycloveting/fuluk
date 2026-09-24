import { timingSafeEqual } from "node:crypto";

export function isAuthorizedHeader(authorization, expectedToken) {
  const expected = `Bearer ${expectedToken}`;

  if (typeof authorization !== "string") {
    return false;
  }

  // Use constant-time comparison to prevent timing attacks
  // If lengths differ, still perform a dummy comparison to maintain constant time
  if (authorization.length !== expected.length) {
    timingSafeEqual(Buffer.alloc(expected.length), Buffer.from(expected, "utf8"));
    return false;
  }

  try {
    return timingSafeEqual(
      Buffer.from(authorization, "utf8"),
      Buffer.from(expected, "utf8")
    );
  } catch {
    return false;
  }
}
