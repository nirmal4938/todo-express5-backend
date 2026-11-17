import nodemailer from "nodemailer";
import { generateSingleTaskAlarmIcs } from "./mobileAlarmProvider.js";
import { logNotificationEvent } from "./notificationLogging.js";

let transport;

const getTransport = () => {
  const { SMTP_HOST, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) return null;

  if (!transport) {
    const port = Number(process.env.SMTP_PORT || 587);
    transport = nodemailer.createTransport({
      host: SMTP_HOST,
      port,
      secure: port === 465,
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 20000,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
  }
  return transport;
};

const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (character) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character];
  });

export const sendTaskEmail = async ({ task, user, leadTimeMinutes }) => {
  const mailTransport = getTransport();
  const taskId = task.id || task._id.toString();
  const dueAt = new Date(task.scheduledAt || task.dateTime);
  const dueText = dueAt.toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  });
  const taskUrl = `${process.env.TASK_APP_URL || process.env.FRONTEND_URL || "http://localhost:5173"}/?task=${encodeURIComponent(taskId)}`;

  if (!mailTransport) {
    logNotificationEvent("notification.email.dry_run", {
      taskId,
      recipient: user.email,
      reason: "SMTP_HOST, SMTP_USER, or SMTP_PASS is not configured",
    });
    return "SKIPPED_UNCONFIGURED";
  }

  const calendar = generateSingleTaskAlarmIcs(task, leadTimeMinutes);
  const title = escapeHtml(task.title);
  const priority = escapeHtml(task.priority || "Medium");
  const description = escapeHtml(task.description || "");
  const includesAlarm =
    task.reminderConfig?.channels?.includes("MOBILE_ALARM") &&
    user.notificationPreferences?.mobileAlarm !== false;
  const info = await mailTransport.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: user.email,
    subject: `Reminder: ${task.title} is due soon`,
    text: `${task.title}\nPriority: ${task.priority || "Medium"}\nDue: ${dueText}\nOpen task: ${taskUrl}`,
    html: `<!doctype html><html><body style="margin:0;padding:24px;background:#f1f5f9;font-family:Arial,sans-serif;color:#0f172a"><main style="max-width:560px;margin:auto;padding:28px;border-radius:16px;background:#fff"><p style="font-size:12px;font-weight:bold;letter-spacing:1px;color:#3b66f5">TASK REMINDER</p><h1 style="font-size:24px">${title}</h1><p style="display:inline-block;padding:6px 10px;border-radius:999px;background:#eef2ff;color:#3730a3;font-size:13px;font-weight:bold">${priority} priority</p><p style="font-size:16px">Due ${escapeHtml(dueText)} (UTC)</p>${description ? `<p style="color:#475569">${description}</p>` : ""}<p style="margin-top:24px"><a href="${escapeHtml(taskUrl)}" style="display:inline-block;padding:12px 18px;border-radius:10px;background:#3b66f5;color:#fff;text-decoration:none;font-weight:bold">Open task</a></p>${includesAlarm ? `<p style="font-size:12px;color:#64748b">The attached calendar event includes a ${leadTimeMinutes}-minute reminder.</p>` : ""}</main></body></html>`,
    attachments: includesAlarm
      ? [
          {
            filename: `task-${taskId}.ics`,
            content: calendar,
            contentType: "text/calendar; method=PUBLISH; charset=UTF-8",
          },
        ]
      : [],
  });

  logNotificationEvent("notification.email.sent", {
    taskId,
    recipient: user.email,
    messageId: info.messageId,
  });
  return "SENT";
};

export const sendPasswordResetEmail = async ({ user, resetUrl }) => {
  const mailTransport = getTransport();

  if (!mailTransport) {
    logNotificationEvent("notification.email.dry_run", {
      recipient: user.email,
      reason: "SMTP_HOST, SMTP_USER, or SMTP_PASS is not configured",
      purpose: "password_reset",
    });
    return "SKIPPED_UNCONFIGURED";
  }

  const safeName = escapeHtml(user.name);
  const safeResetUrl = escapeHtml(resetUrl);
  const info = await mailTransport.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: user.email,
    subject: "Reset your password",
    text: `Hello ${user.name},\n\nUse this link to reset your password. It expires in 15 minutes:\n${resetUrl}\n\nIf you did not request a password reset, you can ignore this email.`,
    html: `<!doctype html><html><body style="margin:0;padding:24px;background:#f1f5f9;font-family:Arial,sans-serif;color:#0f172a"><main style="max-width:560px;margin:auto;padding:28px;border-radius:16px;background:#fff"><h1 style="font-size:24px">Reset your password</h1><p>Hello ${safeName},</p><p>We received a request to reset your password. This link expires in 15 minutes.</p><p style="margin-top:24px"><a href="${safeResetUrl}" style="display:inline-block;padding:12px 18px;border-radius:10px;background:#3b66f5;color:#fff;text-decoration:none;font-weight:bold">Reset password</a></p><p style="font-size:13px;color:#64748b">If you did not request a password reset, you can ignore this email.</p></main></body></html>`,
  });

  logNotificationEvent("notification.email.sent", {
    recipient: user.email,
    messageId: info.messageId,
    purpose: "password_reset",
  });
  return "SENT";
};
