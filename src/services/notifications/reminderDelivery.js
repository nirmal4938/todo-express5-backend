import { Task } from "../../models/task.model.js";
import { User } from "../../models/User.js";
import { Workspace } from "../../models/Workspace.js";
import { sendTaskEmail } from "./emailProvider.js";
import { logNotificationEvent } from "./notificationLogging.js";
import { sendTaskWhatsApp } from "./whatsappProvider.js";
import { invalidateTaskCache } from "../cache.service.js";

const isSameScheduledDate = (task, scheduledDateTime) => {
  const dateTime = task.scheduledAt || task.dateTime;
  return dateTime && new Date(dateTime).toISOString() === scheduledDateTime;
};

const channelFor = (task, user, channel) => {
  if (!task.reminderConfig?.enabled) return false;
  if (!(task.reminderConfig.channels || []).includes(channel)) return false;

  const preferences = user.notificationPreferences || {};
  if (channel === "EMAIL") return preferences.email !== false;
  if (channel === "WHATSAPP") {
    return preferences.whatsapp === true && Boolean(user.phoneNumber);
  }
  return channel === "MOBILE_ALARM" && preferences.mobileAlarm !== false;
};

const previousStatus = (task, channel) =>
  task.reminderConfig?.deliveryStatus?.[channel.toLowerCase()];

const shouldRetryChannel = (task, channel) =>
  ![
    "SENT",
    "SKIPPED",
    "SKIPPED_UNCONFIGURED",
    "NOT_REQUESTED",
  ].includes(previousStatus(task, channel));

export const deliverTaskReminder = async (job) => {
  const { taskId, scheduledDateTime, leadTimeMinutes } = job.data;
  const task = await Task.findById(taskId);

  if (
    !task ||
    task.status !== "In Progress" ||
    !isSameScheduledDate(task, scheduledDateTime) ||
    task.reminderConfig?.enabled === false ||
    task.reminderSent === true ||
    task.reminderConfig?.reminderSentAt
  ) {
    logNotificationEvent("reminder.job.skipped", {
      taskId,
      jobId: job.id,
      reason: !task
        ? "Task no longer exists"
        : task.status !== "In Progress"
          ? "Task is no longer in progress"
          : task.reminderSent || task.reminderConfig?.reminderSentAt
            ? "Task reminder was already delivered"
            : "Task reminder is disabled or its due date changed",
    });
    return;
  }

  const workspace = await Workspace.exists({
    _id: task.workspaceId,
    deletedAt: null,
    "members.userId": task.createdBy,
  });
  if (!workspace) {
    logNotificationEvent("reminder.job.skipped", {
      taskId,
      jobId: job.id,
      reason: "Workspace is no longer active",
    });
    return;
  }

  const user = await User.findById(task.createdBy).select(
    "name email phoneNumber notificationPreferences",
  );
  if (!user) {
    logNotificationEvent("reminder.job.skipped", {
      taskId,
      jobId: job.id,
      reason: "Task owner no longer exists",
    });
    return;
  }

  const requestedChannels = [
    {
      channel: "EMAIL",
      statusPath: "email",
      enabled: channelFor(task, user, "EMAIL"),
      send: () => sendTaskEmail({ task, user, leadTimeMinutes }),
    },
    {
      channel: "WHATSAPP",
      statusPath: "whatsapp",
      enabled: channelFor(task, user, "WHATSAPP"),
      send: () => sendTaskWhatsApp({ task, user }),
    },
    {
      channel: "MOBILE_ALARM",
      statusPath: "alarmSynced",
      enabled: channelFor(task, user, "MOBILE_ALARM"),
      send: async () => "READY",
    },
  ];

  const results = await Promise.allSettled(
    requestedChannels.map(async ({ channel, statusPath, enabled, send }) => {
      if (!enabled) {
        return { statusPath, status: "NOT_REQUESTED", channel };
      }

      if (channel === "MOBILE_ALARM") {
        return {
          statusPath,
          status: "READY",
          channel,
        };
      }

      if (!shouldRetryChannel(task, channel)) {
        return {
          statusPath,
          status: previousStatus(task, channel),
          channel,
        };
      }

      try {
        return { statusPath, status: await send(), channel };
      } catch (error) {
        error.channel = channel;
        throw error;
      }
    }),
  );

  const deliveryStatus = {};
  let hasFailures = false;
  for (const [index, result] of results.entries()) {
    const channel = requestedChannels[index].channel;
    const statusPath = requestedChannels[index].statusPath;
    if (result.status === "fulfilled") {
      deliveryStatus[statusPath] = result.value.status;
      if (channel !== "MOBILE_ALARM") {
        logNotificationEvent("notification.channel.completed", {
          taskId,
          jobId: job.id,
          channel,
          status: result.value.status,
        });
      }
    } else {
      hasFailures = true;
      deliveryStatus[statusPath] = "FAILED";
      logNotificationEvent("notification.channel.failed", {
        taskId,
        jobId: job.id,
        channel,
        message: result.reason.message,
      });
    }
  }

  const allConfiguredChannels = [
    "EMAIL",
    "WHATSAPP",
    "MOBILE_ALARM",
  ].every((channel) => {
    if (!channelFor(task, user, channel)) return true;
    if (channel === "MOBILE_ALARM") {
      return deliveryStatus.alarmSynced === "READY";
    }
    return ["SENT", "SKIPPED", "SKIPPED_UNCONFIGURED"].includes(
      deliveryStatus[channel.toLowerCase()],
    );
  });
  const alarmWasRequested = channelFor(task, user, "MOBILE_ALARM");
  const shouldLogAlarmTrigger =
    alarmWasRequested &&
    !task.reminderConfig?.deliveryStatus?.alarmTriggeredAt;
  const alarmTriggeredAt =
    task.reminderConfig?.deliveryStatus?.alarmTriggeredAt || new Date();

  await Task.updateOne(
    { _id: task._id },
    {
      $set: {
        "reminderConfig.deliveryStatus.email":
          deliveryStatus.email ??
          previousStatus(task, "EMAIL") ??
          "NOT_REQUESTED",
        "reminderConfig.deliveryStatus.whatsapp":
          deliveryStatus.whatsapp ??
          previousStatus(task, "WHATSAPP") ??
          "NOT_REQUESTED",
        ...(alarmWasRequested
          ? {
              "reminderConfig.deliveryStatus.alarmSynced": true,
              "reminderConfig.deliveryStatus.alarmTriggeredAt":
                alarmTriggeredAt,
            }
          : {}),
        ...(allConfiguredChannels && !hasFailures
          ? {
              "reminderConfig.reminderSentAt": new Date(),
              reminderSent: true,
            }
          : {}),
      },
    },
  );
  await invalidateTaskCache(task.workspaceId);

  if (shouldLogAlarmTrigger) {
    logNotificationEvent("mobile_alarm.triggered", {
      taskId,
      jobId: job.id,
      scheduledDateTime,
      leadTimeMinutes,
      status: "READY",
    });
  }

  if (hasFailures) {
    throw new Error("One or more task reminder channels failed");
  }
};
