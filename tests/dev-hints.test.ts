import { test } from "node:test";
import assert from "node:assert/strict";
import { bootstrapAdminEmail, bootstrapAdminHintAllowed, BOOTSTRAP_ADMIN_EMAIL } from "../server/dev-hints";

function withEnv(patch: Record<string, string | undefined>, fn: () => void) {
  const keys = ["NODE_ENV", "APERTURE_DEV_CODES", "APERTURE_DEMO", "APERTURE_DEMO_IN_PRODUCTION"] as const;
  const prev: Record<string, string | undefined> = {};
  for (const k of keys) prev[k] = process.env[k];
  try {
    for (const k of keys) {
      if (patch[k] === undefined) delete process.env[k];
      else process.env[k] = patch[k]!;
    }
    // Re-import is not needed: helpers read process.env at call time.
    fn();
  } finally {
    for (const k of keys) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k]!;
    }
  }
}

test("bootstrap hint is allowed outside production", () => {
  withEnv({ NODE_ENV: "development", APERTURE_DEV_CODES: undefined, APERTURE_DEMO: "0" }, () => {
    assert.equal(bootstrapAdminHintAllowed(), true);
    assert.equal(bootstrapAdminEmail(), BOOTSTRAP_ADMIN_EMAIL);
  });
});

test("bootstrap hint is hidden in production with demos off", () => {
  withEnv({ NODE_ENV: "production", APERTURE_DEMO: "0", APERTURE_DEV_CODES: undefined }, () => {
    assert.equal(bootstrapAdminHintAllowed(), false);
    assert.equal(bootstrapAdminEmail(), null);
  });
});

test("bootstrap hint is hidden in production when APERTURE_DEMO is unset (demos default off)", () => {
  withEnv({ NODE_ENV: "production", APERTURE_DEMO: undefined, APERTURE_DEV_CODES: undefined }, () => {
    assert.equal(bootstrapAdminHintAllowed(), false);
    assert.equal(bootstrapAdminEmail(), null);
  });
});

test("bootstrap hint is hidden in production with APERTURE_DEMO=1 alone", () => {
  withEnv({ NODE_ENV: "production", APERTURE_DEMO: "1", APERTURE_DEV_CODES: undefined }, () => {
    assert.equal(bootstrapAdminHintAllowed(), false);
  });
});

test("bootstrap hint stays available when demos are explicitly on in production", () => {
  withEnv({ NODE_ENV: "production", APERTURE_DEMO: "1", APERTURE_DEMO_IN_PRODUCTION: "1", APERTURE_DEV_CODES: undefined }, () => {
    assert.equal(bootstrapAdminHintAllowed(), true);
    assert.equal(bootstrapAdminEmail(), BOOTSTRAP_ADMIN_EMAIL);
  });
});
