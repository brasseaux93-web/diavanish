import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

/**
 * Compare a running Diavanish server with a local build.
 *   npm run build && npm run verify -- https://diavanish.org
 * Exits non-zero if any file the server sends differs from what you built.
 */
async function main() {
  const base = (process.argv[2] || "").replace(/\/+$/, "");
  if (!/^https?:\/\//.test(base)) {
    console.error("Usage: npm run verify -- https://your-host");
    process.exit(2);
  }
  const local = JSON.parse(await readFile("dist/public/build-manifest.json", "utf-8"));
  let bad = 0;

  const remoteRes = await fetch(`${base}/build-manifest.json`);
  if (remoteRes.ok) {
    const remote = await remoteRes.json();
    const same = remote.root === local.root;
    console.log(`${same ? "match " : "DIFFER"}  published manifest root ${remote.root}`);
    if (!same) bad++;
  } else {
    console.log(`note    server has no /build-manifest.json (${remoteRes.status})`);
  }

  // Don't trust the server's manifest alone: fetch and hash each file it serves.
  for (const [file, want] of Object.entries(local.files as Record<string, string>)) {
    const r = await fetch(`${base}/${file}`);
    if (!r.ok) { console.log(`MISSING ${file} (${r.status})`); bad++; continue; }
    const got = createHash("sha256").update(Buffer.from(await r.arrayBuffer())).digest("hex");
    if (got !== want) { console.log(`DIFFER  ${file}`); bad++; }
  }
  console.log(bad ? `${bad} problem(s): this server is not serving your build.` : `OK: all ${Object.keys(local.files).length} files match your build (root ${local.root}).`);
  process.exit(bad ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(2); });
