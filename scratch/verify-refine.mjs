import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const PORT = 5060;
const DB_PATH = path.resolve("scratch/inspect-refine.db");
const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const SHOTS_DIR = path.resolve("scratch/shots-refine");

if (!fs.existsSync(SHOTS_DIR)) {
  fs.mkdirSync(SHOTS_DIR, { recursive: true });
}

// 1. Start Server
console.log("Starting server on port", PORT);
const serverProc = spawn("node", ["dist/index.cjs"], {
  env: {
    ...process.env,
    PORT: String(PORT),
    DATABASE_URL: `file:${DB_PATH}`,
    SESSION_SECRET: "test-session-secret-for-refine-verification-32chars",
    NODE_ENV: "production",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

serverProc.stdout.on("data", (d) => console.log(`[server] ${d}`));
serverProc.stderr.on("data", (d) => console.error(`[server err] ${d}`));

async function waitPort(port) {
  for (let i = 0; i < 40; i++) {
    try {
      await new Promise((resolve, reject) => {
        const req = http.get(`http://127.0.0.1:${port}/api/config`, (res) => {
          if (res.statusCode === 200) resolve();
          else reject(new Error("status " + res.statusCode));
        });
        req.on("error", reject);
      });
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  throw new Error("Server failed to respond on port " + port);
}

async function run() {
  try {
    await waitPort(PORT);
    console.log("Server responded successfully!");

    // Launch Chrome in headless mode with remote debugging
    const cdpPort = 9223;
    const userDataDir = path.resolve("scratch/chrome-cdp-profile");
    const chrome = spawn(CHROME_PATH, [
      "--headless=new",
      `--remote-debugging-port=${cdpPort}`,
      `--user-data-dir=${userDataDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--window-size=1440,900",
    ]);

    // Give Chrome a moment to spin up
    await new Promise((r) => setTimeout(r, 1500));

    // Get CDP WebSocket URL
    const targetsRes = await fetch(`http://127.0.0.1:${cdpPort}/json`);
    const targets = await targetsRes.json();
    console.log("CDP Targets:", targets.length);
    const pageTarget = targets.find((t) => t.type === "page") || targets[0];
    const wsUrl = pageTarget.webSocketDebuggerUrl;

    const wsModule = await import("node:http"); // We can use standard WebSocket in Node 22+
    const ws = new WebSocket(wsUrl);

    let id = 1;
    const pending = new Map();
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const [resolve, reject] = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) reject(msg.error);
        else resolve(msg.result);
      }
    };

    function send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const msgId = id++;
        pending.set(msgId, [resolve, reject]);
        ws.send(JSON.stringify({ id: msgId, method, params }));
      });
    }

    await new Promise((resolve) => {
      if (ws.readyState === WebSocket.OPEN) resolve();
      else ws.onopen = resolve;
    });

    console.log("Connected to Chrome CDP WebSocket");

    await send("Page.enable");
    await send("DOM.enable");
    await send("Runtime.enable");

    // Navigate to homepage
    console.log("Navigating to http://127.0.0.1:" + PORT);
    await send("Page.navigate", { url: `http://127.0.0.1:${PORT}/` });
    await new Promise((r) => setTimeout(r, 1200));

    // Measure bounding boxes of left hero vs right preview
    const evalRes = await send("Runtime.evaluate", {
      expression: `(() => {
        const left = document.querySelector('section.grid > div.min-w-0');
        const right = document.querySelector('section[data-testid="hero-schematic"]');
        const leftRect = left ? left.getBoundingClientRect() : null;
        const rightRect = right ? right.getBoundingClientRect() : null;
        const scrollH = document.documentElement.scrollWidth <= document.documentElement.clientWidth;
        
        // Count text words
        const walk = (el) => {
          let s = "";
          for (const node of el.childNodes) {
            if (node.nodeType === 3) s += " " + node.textContent;
            else if (node.nodeType === 1 && !['SCRIPT','STYLE','NOSCRIPT','BUTTON','NAV'].includes(node.tagName)) {
              if (node.getAttribute('role') === 'status') continue;
              s += " " + walk(node);
            }
          }
          return s;
        };

        const heroLeftWords = left ? walk(left).trim().split(/\\s+/).filter(Boolean).length : 0;
        const trustSec = document.querySelector('section[data-testid="section-privacy-limits"]');
        const trustWords = trustSec ? walk(trustSec).trim().split(/\\s+/).filter(Boolean).length : 0;
        const closingSec = document.querySelectorAll('section')[2];
        const closingWords = closingSec ? walk(closingSec).trim().split(/\\s+/).filter(Boolean).length : 0;

        return {
          leftH: leftRect ? Math.round(leftRect.height) : 0,
          rightH: rightRect ? Math.round(rightRect.height) : 0,
          heightDiff: (rightRect && leftRect) ? Math.round(rightRect.height - leftRect.height) : 0,
          scrollH,
          heroLeftWords,
          trustWords,
          closingWords,
          totalMarketingWords: heroLeftWords + trustWords + closingWords
        };
      })()`,
      returnByValue: true,
    });

    console.log("Layout metrics:", JSON.stringify(evalRes.result.value, null, 2));

    // Capture desktop screenshot
    const shot1 = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(SHOTS_DIR, "desktop-refined.png"), Buffer.from(shot1.data, "base64"));
    console.log("Saved desktop-refined.png");

    // Click "Approve" stage
    await send("Runtime.evaluate", {
      expression: `(() => {
        const btn = document.querySelector('button[data-testid="button-demo-stage-1"]');
        if (btn) btn.click();
      })()`,
    });
    await new Promise((r) => setTimeout(r, 300));

    const shotStage1 = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(SHOTS_DIR, "desktop-stage1.png"), Buffer.from(shotStage1.data, "base64"));
    console.log("Saved desktop-stage1.png");

    // Click "Approve entries" button
    await send("Runtime.evaluate", {
      expression: `(() => {
        const btn = document.querySelector('button[data-testid="button-demo-approve"]');
        if (btn) btn.click();
      })()`,
    });
    await new Promise((r) => setTimeout(r, 300));

    // Mobile viewport
    await send("Emulation.setDeviceMetricsOverride", {
      width: 375,
      height: 812,
      deviceScaleFactor: 2,
      mobile: true,
    });
    await new Promise((r) => setTimeout(r, 400));
    const shotMobile = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(path.join(SHOTS_DIR, "mobile-refined.png"), Buffer.from(shotMobile.data, "base64"));
    console.log("Saved mobile-refined.png");

    ws.close();
    chrome.kill();
  } finally {
    serverProc.kill("SIGTERM");
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
