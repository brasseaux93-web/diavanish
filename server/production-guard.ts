import { demoStartupMessages } from "./demo-mode";
import { mailMode } from "./mailer";

const isProd = process.env.NODE_ENV === "production";

const devCodes = process.env.DIAVANISH_DEV_CODES || process.env.APERTURE_DEV_CODES;
if (isProd && devCodes === "1") {
  console.error("DEV_CODES=1 returns sign-in codes to the browser and cannot run in production. Configure Resend or a mail webhook instead.");
  process.exit(1);
}

if (isProd) {
  const secret = process.env.DIAVANISH_SECRET || process.env.APERTURE_SECRET || "";
  if (!secret || secret.length < 32 || secret === "change-me-to-64-random-characters" || secret.includes("change-me")) {
    console.error("Refusing to start: DIAVANISH_SECRET must be set to at least 32 random characters in production.");
    process.exit(1);
  }

  const adminEmail = process.env.DIAVANISH_ADMIN_EMAIL || process.env.APERTURE_ADMIN_EMAIL || "";
  if (!adminEmail || !adminEmail.includes("@")) {
    console.error("Refusing to start: DIAVANISH_ADMIN_EMAIL must be set to a real administrator address in production.");
    process.exit(1);
  }

  if (mailMode() === "off") {
    console.error("Refusing to start: email delivery is not configured. Set RESEND_API_KEY + DIAVANISH_MAIL_FROM, or DIAVANISH_MAIL_WEBHOOK.");
    process.exit(1);
  }

  const demo = process.env.DIAVANISH_DEMO || process.env.APERTURE_DEMO;
  const demoProd = process.env.DIAVANISH_DEMO_IN_PRODUCTION || process.env.APERTURE_DEMO_IN_PRODUCTION;
  if (demo === "1" && demoProd !== "1") {
    console.warn("DIAVANISH_DEMO=1 is set but DIAVANISH_DEMO_IN_PRODUCTION is not. Demos will be off.");
  }
}

for (const m of demoStartupMessages()) {
  (m.level === "warn" ? console.warn : console.log)(m.text);
}
