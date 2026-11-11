/* Starts the real production bundle (dist/index.cjs) on a free port with a throwaway database. */
import { spawn, execSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import path from "node:path";

export const DIST = path.resolve("dist/index.cjs");
export const hasBuild = () => existsSync(DIST);

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const port = (s.address() as any).port;
      s.close(() => resolve(port));
    });
    s.on("error", reject);
  });
}

export type Prod = { base: string; output: () => string; stop: () => Promise<void> };

export async function startProd(env: Record<string, string> = {}): Promise<Prod> {
  const dir = mkdtempSync(path.join(tmpdir(), "aperture-prod-"));
  const db = path.join(dir, "prod.db");
  const port = await freePort();
  const childEnv: Record<string, string> = {
    PATH: process.env.PATH || "", HOME: process.env.HOME || dir,
    NODE_ENV: "production", PORT: String(port), APERTURE_DB: db, ...env,
  };
  execSync("npx drizzle-kit push --force", { env: childEnv, stdio: "ignore" });
  const child: ChildProcess = spawn(process.execPath, [DIST], { env: childEnv, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  child.stdout!.on("data", (d) => (out += d));
  child.stderr!.on("data", (d) => (out += d));
  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 20_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`server exited early:\n${out}`);
    try {
      const r = await fetch(`${base}/api/public/config`);
      if (r.ok) break;
    } catch { /* not up yet */ }
    if (Date.now() > deadline) { child.kill(); throw new Error(`server did not start:\n${out}`); }
    await new Promise((r) => setTimeout(r, 150));
  }
  return {
    base,
    output: () => out,
    stop: async () => {
      child.kill();
      await new Promise((r) => child.once("exit", r));
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
