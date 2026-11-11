/*
 * Runs against the production bundle (npm run build first; CI runs this after
 * the build step). The demo admin hole must stay closed by default.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { hasBuild, startProd } from "./harness";

const skip = hasBuild() ? false : "run npm run build first";

const startAdminDemo = (base: string) => fetch(`${base}/api/demo/start`, {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ role: "admin" }),
});

test("production build without the flag rejects POST /api/demo/start {role:admin}", { skip }, async () => {
  const p = await startProd();
  try {
    const r = await startAdminDemo(p.base);
    assert.equal(r.status, 404);
    assert.equal((await r.json()).token, undefined);
    assert.deepEqual(await (await fetch(`${p.base}/api/public/config`)).json(), { demo: false });
  } finally { await p.stop(); }
});

test("production build with APERTURE_DEMO=1 alone still has no demo", { skip }, async () => {
  const p = await startProd({ APERTURE_DEMO: "1" });
  try {
    assert.equal((await startAdminDemo(p.base)).status, 404);
    assert.match(p.output(), /ignored in production/);
  } finally { await p.stop(); }
});

test("production build with both flags runs the demo, confined, and warns loudly", { skip }, async () => {
  const p = await startProd({ APERTURE_DEMO: "1", APERTURE_DEMO_IN_PRODUCTION: "1" });
  try {
    assert.match(p.output(), /DEMOS ARE ON IN PRODUCTION/);
    const r = await startAdminDemo(p.base);
    assert.equal(r.status, 200);
    const { token } = await r.json();
    const purge = await fetch(`${p.base}/api/admin/purge`, { method: "POST", headers: { "x-aperture-session": token } });
    assert.equal(purge.status, 403);
  } finally { await p.stop(); }
});
