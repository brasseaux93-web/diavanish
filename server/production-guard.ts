import { demoStartupMessages } from "./demo-mode";

if (process.env.NODE_ENV === "production" && process.env.APERTURE_DEV_CODES === "1") {
  console.error("APERTURE_DEV_CODES=1 returns sign-in codes to the browser and cannot run in production. Configure Resend or a mail webhook instead.");
  process.exit(1);
}

for (const m of demoStartupMessages()) {
  (m.level === "warn" ? console.warn : console.log)(m.text);
}
