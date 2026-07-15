// Phase 9 Part 2 — minimal transactional mailer.
//
// The repo has no general-purpose notification service — only auth.ts's
// magic-link path uses nodemailer. This reuses the SAME env-driven SMTP
// config (EMAIL_SERVER_*), with the same jsonTransport/log fallback auth.ts
// uses when SMTP isn't configured, so scheduled-report emails work in prod
// and degrade to a log line in dev/test. (Reusing the sender in spirit; a
// dedicated notification service is a later-phase concern — DESIGN-GAP.)
import nodemailer from "nodemailer";
import { env } from "@/env";
import { logger } from "@/lib/logger";

function smtpConfigured(): boolean {
  return (
    env.EMAIL_SERVER_HOST.length > 0 &&
    env.EMAIL_SERVER_USER.length > 0 &&
    env.EMAIL_SERVER_PASSWORD.length > 0
  );
}

export async function sendMail(params: {
  to: string[];
  subject: string;
  text: string;
  html?: string;
}): Promise<{ sent: boolean }> {
  if (params.to.length === 0) return { sent: false };

  if (!smtpConfigured()) {
    logger.info(
      { to: params.to, subject: params.subject },
      "mailer: SMTP not configured — email logged, not sent",
    );
    return { sent: false };
  }

  const transport = nodemailer.createTransport({
    host: env.EMAIL_SERVER_HOST,
    port: env.EMAIL_SERVER_PORT,
    auth: { user: env.EMAIL_SERVER_USER, pass: env.EMAIL_SERVER_PASSWORD },
  });

  await transport.sendMail({
    from: env.EMAIL_FROM,
    to: params.to.join(", "),
    subject: params.subject,
    text: params.text,
    ...(params.html ? { html: params.html } : {}),
  });
  return { sent: true };
}
