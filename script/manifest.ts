import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Hashes every file the browser can receive (dist/public) and writes
 * dist/public/build-manifest.json. Anyone can rebuild a tagged release and
 * compare their manifest with the one a server publishes at
 * /build-manifest.json (see `npm run verify`).
 */
export const MANIFEST = "build-manifest.json";

async function walk(dir: string, base = dir): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p, base)));
    else out.push(path.relative(base, p).split(path.sep).join("/"));
  }
  return out;
}

export async function hashTree(dir: string) {
  const files: Record<string, string> = {};
  for (const f of (await walk(dir)).filter((f) => f !== MANIFEST).sort()) {
    files[f] = createHash("sha256").update(await readFile(path.join(dir, f))).digest("hex");
  }
  // One hash over the sorted "sha256  path" lines, the same format as `sha256sum`.
  const lines = Object.entries(files).map(([f, h]) => `${h}  ${f}\n`).join("");
  const root = createHash("sha256").update(lines).digest("hex");
  return { root, files };
}

export async function writeManifest(dir = "dist/public") {
  const pkg = JSON.parse(await readFile("package.json", "utf-8"));
  const { root, files } = await hashTree(dir);
  const manifest = { name: pkg.name, version: pkg.version, algorithm: "sha256", root, files };
  await writeFile(path.join(dir, MANIFEST), JSON.stringify(manifest, null, 2) + "\n");
  console.log(`build manifest: ${Object.keys(files).length} files, root ${root}`);
  return manifest;
}
