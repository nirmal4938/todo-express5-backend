import { logNotificationEvent } from "./notificationLogging.js";

const formatDueTime = (task) =>
  new Date(task.scheduledAt || task.dateTime).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  });

const sendMetaMessage = async ({ task, user, token, phoneId }) => {
  const templateName = process.env.WHATSAPP_TEMPLATE_NAME || "task_due_reminder";
  const languageCode = process.env.WHATSAPP_TEMPLATE_LANGUAGE || "en";
  const response = await fetch(
    `https://graph.facebook.com/${process.env.WHATSAPP_API_VERSION || "v21.0"}/${encodeURIComponent(phoneId)}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(10000),
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: user.phoneNumber,
        type: "template",
        template: {
          name: templateName,
          language: { code: languageCode },
          components: [
            {
              type: "body",
              parameters: [
                { type: "text", text: task.title },
                { type: "text", text: task.priority || "Medium" },
                { type: "text", text: formatDueTime(task) },
              ],
            },
          ],
        },
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`Meta WhatsApp API returned ${response.status}`);
  }
  return response.json();
};

const sendTwilioMessage = async ({ task, user }) => {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, WHATSAPP_FROM_NUMBER } =
    process.env;
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !WHATSAPP_FROM_NUMBER) {
    return null;
  }

  const content = new URLSearchParams({
    To: `whatsapp:${user.phoneNumber}`,
    From: WHATSAPP_FROM_NUMBER.startsWith("whatsapp:")
      ? WHATSAPP_FROM_NUMBER
      : `whatsapp:${WHATSAPP_FROM_NUMBER}`,
  });
  if (process.env.WHATSAPP_TEMPLATE_SID) {
    content.set("ContentSid", process.env.WHATSAPP_TEMPLATE_SID);
    content.set(
      "ContentVariables",
      JSON.stringify({
        1: task.title,
        2: task.priority || "Medium",
        3: formatDueTime(task),
      }),
    );
  } else {
    content.set(
      "Body",
      `Reminder: "${task.title}" (${task.priority || "Medium"}) is due ${formatDueTime(task)} UTC.`,
    );
  }

  const credentials = Buffer.from(
    `${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`,
  ).toString("base64");
  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(TWILIO_ACCOUNT_SID)}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      signal: AbortSignal.timeout(10000),
      body: content,
    },
  );

  if (!response.ok) {
    throw new Error(`Twilio WhatsApp API returned ${response.status}`);
  }
  return response.json();
};

export const sendTaskWhatsApp = async ({ task, user }) => {
  const provider = (process.env.WHATSAPP_PROVIDER || "meta").toLowerCase();
  let result;

  if (provider === "meta") {
    const { WHATSAPP_API_TOKEN, WHATSAPP_PHONE_ID } = process.env;
    if (WHATSAPP_API_TOKEN && WHATSAPP_PHONE_ID) {
      result = await sendMetaMessage({
        task,
        user,
        token: WHATSAPP_API_TOKEN,
        phoneId: WHATSAPP_PHONE_ID,
      });
    }
  } else if (provider === "twilio") {
    result = await sendTwilioMessage({ task, user });
  } else {
    throw new Error(`Unsupported WHATSAPP_PROVIDER: ${provider}`);
  }

  if (!result) {
    logNotificationEvent("notification.whatsapp.dry_run", {
      taskId: task.id || task._id.toString(),
      recipient: user.phoneNumber || null,
      provider,
      reason: "Provider credentials are not configured",
    });
    return "SKIPPED_UNCONFIGURED";
  }

  logNotificationEvent("notification.whatsapp.sent", {
    taskId: task.id || task._id.toString(),
    recipient: user.phoneNumber,
    provider,
  });
  return "SENT";
};
