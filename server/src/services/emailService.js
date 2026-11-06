import nodemailer from "nodemailer";
import { env } from "../config/env.js";

let transportFactory = (options) => nodemailer.createTransport(options);
let warnedUnavailable = false;
export const setEmailTransportFactoryForTests = (factory) => { transportFactory = factory; };
export const resetEmailTransportFactoryForTests = () => { transportFactory = (options) => nodemailer.createTransport(options); };

const configured = () => Boolean(env.smtpHost && env.smtpUser && env.smtpPass && env.emailFrom);
const validRecipient = (value) => typeof value === "string" && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const deliveryFailureReason = (error) => {
  if (error?.code === "EAUTH" || error?.responseCode === 535) return "authentication_failed";
  if (["ETIMEDOUT", "ESOCKET", "ECONNECTION", "ECONNREFUSED", "ECONNRESET"].includes(error?.code)) return "connection_failed";
  if (error?.responseCode === 550 || error?.responseCode === 551 || error?.responseCode === 553) return "recipient_rejected";
  if (Number(error?.responseCode) >= 400) return "provider_rejected";
  return "delivery_failed";
};

export async function sendEmail({ to, subject, text, html }) {
  if (!configured()) {
    if (!warnedUnavailable) { console.warn("[Email] SMTP is not configured."); warnedUnavailable = true; }
    return { delivered: false, reason: "unavailable" };
  }
  if (!validRecipient(to) || typeof subject !== "string" || !subject.trim() ||
    typeof text !== "string" || !text.trim() || (html != null && typeof html !== "string"))
    return { delivered: false, reason: "invalid_message" };
  try {
    const transport = transportFactory({ host: env.smtpHost, port: env.smtpPort, secure: env.smtpSecure,
      auth: { user: env.smtpUser, pass: env.smtpPass } });
    await transport.sendMail({ from: env.emailFrom, to, subject: subject.trim(), text, ...(html && { html }) });
    console.info("[Email] SMTP accepted message.");
    return { delivered: true };
  } catch (error) {
    const reason = deliveryFailureReason(error);
    console.warn(`[Email] Delivery failed reason=${reason}.`);
    return { delivered: false, reason };
  }
}
