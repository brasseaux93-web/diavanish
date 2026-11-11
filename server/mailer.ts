/*
 * One-time sign-in codes are delivered out of band — never in the API
 * response — unless the operator explicitly turns on development mode.
 *
 *   RESEND_API_KEY + APERTURE_MAIL_FROM   → sent through Resend
 *   APERTURE_MAIL_WEBHOOK (+ _SECRET)     → POSTed to your own relay
 *                                           (self-hosted SMTP bridge, etc.)
 *   APERTURE_DEV_CODES=1                  → code returned to the browser,
 *                                           with a visible warning. Never
 *                                           enable this in production.
 *
 * With none of these set, sign-in fails closed.
 */

/** Override the whole From header with APERTURE_MAIL_FROM. */
export const DEFAULT_MAIL_FROM = "Diavanish <no-reply@diavanish.org>";

export type MailMode = "resend" | "webhook" | "dev" | "off";

export function mailMode(): MailMode {
  const mailFrom = process.env.DIAVANISH_MAIL_FROM || process.env.APERTURE_MAIL_FROM;
  const webhook = process.env.DIAVANISH_MAIL_WEBHOOK || process.env.APERTURE_MAIL_WEBHOOK;
  const devCodes = process.env.DIAVANISH_DEV_CODES || process.env.APERTURE_DEV_CODES;

  if (process.env.RESEND_API_KEY && mailFrom) return "resend";
  if (webhook) return "webhook";
  if (devCodes === "1") return "dev";
  return "off";
}

function body(code: string) {
  return [
    `Your Diavanish sign-in code is ${code}.`,
    "",
    "It works once and expires in 15 minutes.",
    "If you did not ask for it, ignore this message — nobody can sign in without the code.",
  ].join("\n");
}

export async function sendCode(to: string, code: string): Promise<void> {
  const mode = mailMode();
  const subject = "Your Diavanish sign-in code";
  const mailFrom = process.env.DIAVANISH_MAIL_FROM || process.env.APERTURE_MAIL_FROM || DEFAULT_MAIL_FROM;
  const webhook = process.env.DIAVANISH_MAIL_WEBHOOK || process.env.APERTURE_MAIL_WEBHOOK;
  const webhookSecret = process.env.DIAVANISH_MAIL_WEBHOOK_SECRET || process.env.APERTURE_MAIL_WEBHOOK_SECRET;

  if (mode === "resend") {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: mailFrom, to: [to], subject, text: body(code) }),
    });
    if (!r.ok) throw new Error(`Mail provider refused the message (${r.status})`);
    return;
  }
  if (mode === "webhook") {
    const r = await fetch(webhook!, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(webhookSecret ? { Authorization: `Bearer ${webhookSecret}` } : {}),
      },
      body: JSON.stringify({ to, subject, text: body(code) }),
    });
    if (!r.ok) throw new Error(`Mail relay refused the message (${r.status})`);
    return;
  }
  if (mode === "off") throw new Error("Email delivery is not configured on this server");
  // dev: caller returns the code to the browser
}
