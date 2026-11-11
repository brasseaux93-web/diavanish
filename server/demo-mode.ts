/*
 * One-click demos are OFF unless an operator turns them on.
 *
 *   APERTURE_DEMO=1                    turns demos on (local development, screenshots, trials)
 *   APERTURE_DEMO_IN_PRODUCTION=1      also required when NODE_ENV=production
 *
 * Anything else, including an unset variable or APERTURE_DEMO=true, leaves demos
 * off. Demo sessions are confined to demo data server-side (see routes.ts).
 */

type Env = Record<string, string | undefined>;

export const DEMO_EMAIL_DOMAIN = "@diavanish.org";
export const DEMO_ADMIN_EMAIL = "demo.admin@diavanish.org";
export const DEMO_FAC_EMAIL = "demo.facilitator@diavanish.org";

/** True only when the operator explicitly asked for demos (and, in production, asked twice). */
export function demoEnabled(env: Env = process.env): boolean {
  const demo = env.DIAVANISH_DEMO || env.APERTURE_DEMO;
  const demoProd = env.DIAVANISH_DEMO_IN_PRODUCTION || env.APERTURE_DEMO_IN_PRODUCTION;
  if (demo !== "1") return false;
  if (env.NODE_ENV === "production" && demoProd !== "1") return false;
  return true;
}

/** Demo accounts are recognised by their reserved addresses, never by a client claim. */
export function isDemoEmail(email: string | null | undefined): boolean {
  const e = String(email || "").toLowerCase();
  return e.startsWith("demo.") && e.endsWith(DEMO_EMAIL_DOMAIN);
}

/** Demo rooms carry a series key under the reserved "demo:" prefix. */
export function isDemoRoom(room: { seriesKey: string | null } | undefined | null): boolean {
  return !!room?.seriesKey?.startsWith("demo:");
}

/** Startup messages: a loud warning when demos run in production, a note when a request was ignored. */
export function demoStartupMessages(env: Env = process.env): { level: "warn" | "info"; text: string }[] {
  const out: { level: "warn" | "info"; text: string }[] = [];
  const prod = env.NODE_ENV === "production";
  if (demoEnabled(env) && prod) {
    const bar = "!".repeat(72);
    out.push({
      level: "warn",
      text: [
        bar,
        "WARNING: ONE-CLICK DEMOS ARE ON IN PRODUCTION (APERTURE_DEMO_IN_PRODUCTION=1).",
        "Anyone who can reach this server can open demo sessions. Demo rooms are NOT",
        "end-to-end encrypted: the server holds their keys. Demo sessions are confined",
        "to demo data, but do not run this on a server that hosts real rooms.",
        "Unset APERTURE_DEMO and APERTURE_DEMO_IN_PRODUCTION to turn demos off.",
        bar,
      ].join("\n"),
    });
  } else if (prod && env.APERTURE_DEMO === "1") {
    out.push({
      level: "warn",
      text: "APERTURE_DEMO=1 is ignored in production. Demos stay off unless APERTURE_DEMO_IN_PRODUCTION=1 is also set.",
    });
  }
  return out;
}
