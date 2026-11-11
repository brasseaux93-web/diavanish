import "dotenv/config";
import "./production-guard";
import express, { Response, NextFunction } from 'express';
import type { Request } from 'express';
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { securityHeaders, apiNotFound } from "./security-headers";
import { createServer } from "node:http";

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

/*
 * Metadata minimisation. The operator's logs are a subpoena target too, so
 * they hold only the route *pattern* (never ids, invite codes or room codes),
 * the status and the timing. No IPs, no bodies, no query strings.
 */
app.set("trust proxy", false);
app.disable("x-powered-by");
app.use(securityHeaders());
app.use("/api", (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    if (!req.originalUrl.startsWith("/api")) return;
    const pattern = req.route?.path ? `${req.baseUrl}${req.route.path}` : "/api/(unmatched)";
    log(`${req.method} ${pattern} ${res.statusCode} in ${Date.now() - start}ms`);
  });
  next();
});

(async () => {
  await registerRoutes(httpServer, app);

  // Unknown /api/* must never fall through to the SPA HTML.
  app.use("/api", apiNotFound);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    // A refusal (401, 403, 404…) is an answer, not a fault: only faults are logged.
    if (status >= 500) console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json(err.code ? { message, code: err.code, reason: err.reason } : { message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    const devCodes = process.env.DIAVANISH_DEV_CODES || process.env.APERTURE_DEV_CODES;
    if (devCodes === "1") {
      // Dev codes return sign-in codes in the API response. Never allow that in production.
      console.error("Refusing to start: DEV_CODES=1 is not allowed when NODE_ENV=production.");
      process.exit(1);
    }
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      ...(process.platform !== "win32" ? { reusePort: true } : {}),
    },
    () => {
      log(`serving on port ${port}`);
    },
  );
})();
