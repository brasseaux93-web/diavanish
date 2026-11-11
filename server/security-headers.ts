/*
 * Browser security headers.
 *
 * Production CSP is nonce-free: the Vite build emits one hashed module script
 * and one hashed stylesheet, both same-origin. script-src is therefore 'self'
 * with no 'unsafe-inline' or 'unsafe-eval'.
 *
 * style-src includes 'unsafe-inline' because React style={…} attributes and
 * Radix (popover/select/dropdown positioning) set the style attribute. Tailwind
 * itself does not need it — its output is the hashed stylesheet. A future
 * tightening is style-src-attr 'unsafe-inline' with style-src-elem 'self'
 * (CSP3); we keep the wider form so older browsers still lay out Radix.
 *
 * The proposal brief (/api/public/ledger/:code/brief.html) is a standalone
 * document and sets its own CSP (inline styles, a tiny inline print script,
 * data: fonts). Middleware runs first; the route overwrites the header.
 *
 * Dev loosens script-src ('unsafe-inline' 'unsafe-eval') and connect-src
 * (ws: wss:) so Vite HMR on /vite-hmr keeps working.
 */
import type { Request, Response, NextFunction } from "express";

export type HeaderEnv = Record<string, string | undefined>;

export const PRODUCTION_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

export const DEVELOPMENT_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' ws: wss:",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

/* Brief page: standalone HTML with inline type and a window.print helper.
   Compatible additions: frame-ancestors and object-src (neither affects print). */
export const BRIEF_CSP = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  "font-src data:",
  "img-src data:",
  "script-src 'unsafe-inline'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join("; ");

export const PERMISSIONS_POLICY = [
  "accelerometer=()",
  "autoplay=()",
  "camera=()",
  "display-capture=()",
  "encrypted-media=()",
  "fullscreen=()",
  "geolocation=()",
  "gyroscope=()",
  "hid=()",
  "interest-cohort=()",
  "magnetometer=()",
  "microphone=()",
  "midi=()",
  "payment=()",
  "picture-in-picture=()",
  "publickey-credentials-create=(self)",
  "publickey-credentials-get=(self)",
  "screen-wake-lock=()",
  "serial=()",
  "sync-xhr=()",
  "usb=()",
  "xr-spatial-tracking=()",
].join(", ");

export function hstsValue(env: HeaderEnv = process.env): string | null {
  if (env.APERTURE_HSTS !== "1") return null;
  const parsed = Number(env.APERTURE_HSTS_MAX_AGE);
  const maxAge = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 31536000;
  return `max-age=${maxAge}; includeSubDomains`;
}

export function contentSecurityPolicy(env: HeaderEnv = process.env): string {
  return env.NODE_ENV === "production" ? PRODUCTION_CSP : DEVELOPMENT_CSP;
}

export function securityHeaderMap(env: HeaderEnv = process.env): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Security-Policy": contentSecurityPolicy(env),
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": PERMISSIONS_POLICY,
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "same-origin",
    "X-Frame-Options": "DENY",
  };
  const hsts = hstsValue(env);
  if (hsts) headers["Strict-Transport-Security"] = hsts;
  return headers;
}

export function securityHeaders(env: HeaderEnv = process.env) {
  const staticMap = () => securityHeaderMap(env);
  return (_req: Request, res: Response, next: NextFunction) => {
    for (const [name, value] of Object.entries(staticMap())) {
      res.setHeader(name, value);
    }
    next();
  };
}

/** JSON 404 for anything under /api that no route handled. Must run after registerRoutes. */
export function apiNotFound(_req: Request, res: Response) {
  res.status(404).json({ message: "Not found" });
}
