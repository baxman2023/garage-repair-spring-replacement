import nodemailer from 'nodemailer';
import { env } from '@copyforge/core';

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/**
 * Send an email through the configured SMTP transport. When no `EMAIL_HOST` is
 * set (local dev / tests / CI), fall back to logging the message to stdout so
 * the magic link is retrievable without a live mail server.
 */
export async function sendMail(mail: Mail): Promise<void> {
  if (!env.EMAIL_HOST) {
    console.log(`[email:dev] to=${mail.to} subject="${mail.subject}"\n${mail.text}`);
    return;
  }
  const transport = nodemailer.createTransport({
    host: env.EMAIL_HOST,
    port: env.EMAIL_PORT,
    secure: env.EMAIL_PORT === 465,
    auth: env.EMAIL_USER ? { user: env.EMAIL_USER, pass: env.EMAIL_PASSWORD } : undefined,
  });
  await transport.sendMail({ from: env.EMAIL_FROM, ...mail });
}
