import { Queue } from "bullmq";
import Redis from "ioredis";
import { Task } from "../models/task.model.js";
import { User } from "../models/User.js";
import { logNotificationEvent } from "../services/notifications/notificationLogging.js";

const QUEUE_NAME = "task-reminders";
const JOB_ATTEMPTS = 3;
const JOB_BACKOFF_MS = 5000;
const REMINDER_LEAD_TIME_MINUTES = 15;
let queue;
let queueConnection;

const withTimeout = (operation, description) =>
  new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`${description} timed out`)),
      1500,
    );
    timeout.unref();
    operation.then(
      (result) => {
        clearTimeout(timeout);
        resolve(result);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });

const getQueue = () => {
  if (!process.env.REDIS_URL) return null;

  if (!queue) {
    queueConnection = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: null,
      retryStrategy: (attempt) => Math.min(attempt * 250, 5000),
      connectTimeout: 1000,
    });
    queueConnection.on("error", (error) => {
      console.warn(
        `[reminders] Redis connection unavailable: ${error.message}`,
      );
    });
    queue = new Queue(QUEUE_NAME, { connection: queueConnection });
    queue.on("error", (error) => {
      console.warn(`[reminders] Queue error: ${error.message}`);
    });
  }

  return queue;
};

const reminderIdFor = (taskId) => `task-reminder-${taskId}`;

export const cancelReminder = async (taskId) => {
  const taskQueue = getQueue();
  const jobId = reminderIdFor(taskId);

  if (taskQueue) {
    try {
      const job = await withTimeout(
        taskQueue.getJob(jobId),
        "Looking up reminder",
      );
      if (job) {
        await withTimeout(job.remove(), "Cancelling reminder");
        logNotificationEvent("reminder.job.cancelled", {
          taskId: taskId.toString(),
          jobId,
        });
      }
    } catch (error) {
      logNotificationEvent("reminder.job.cancel_failed", {
        taskId: taskId.toString(),
        jobId,
        message: error.message,
      });
    }
  }

  await Task.updateOne(
    { _id: taskId },
    { $set: { "reminderConfig.reminderJobId": null } },
  );
};

export const scheduleReminder = async (task) => {
  const taskId = task._id.toString();
  const taskQueue = getQueue();
  if (!taskQueue) {
    logNotificationEvent("reminder.job.not_scheduled", {
      taskId,
      reason: "REDIS_URL is not configured",
    });
    return null;
  }

  await cancelReminder(taskId);
  if (
    task.status === "Completed" ||
    task.reminderConfig?.enabled === false ||
    task.reminderSent === true ||
    task.reminderConfig?.reminderSentAt
  ) {
    return null;
  }

  const user = await User.findById(task.createdBy).select(
    "phoneNumber notificationPreferences",
  );
  if (!user) {
    logNotificationEvent("reminder.job.not_scheduled", {
      taskId,
      reason: "Task owner no longer exists",
    });
    return null;
  }

  const channels = task.reminderConfig?.channels || ["EMAIL", "MOBILE_ALARM"];
  const preferences = user.notificationPreferences || {};
  const enabled =
    channels.includes("EMAIL") && preferences.email !== false ||
    channels.includes("WHATSAPP") &&
      preferences.whatsapp === true &&
      Boolean(user.phoneNumber) ||
    channels.includes("MOBILE_ALARM") && preferences.mobileAlarm !== false;
  if (!enabled) return null;

  const dateTime = task.scheduledAt || task.dateTime;
  if (!dateTime || Number.isNaN(new Date(dateTime).getTime())) return null;

  const leadTimeMinutes = Math.max(
    1,
    Math.floor(
      Number(
        preferences.leadTimeMinutes ?? REMINDER_LEAD_TIME_MINUTES,
      ) || REMINDER_LEAD_TIME_MINUTES,
    ),
  );
  const delay =
    new Date(dateTime).getTime() -
    Date.now() -
    leadTimeMinutes * 60 * 1000;
  if (delay <= 0) {
    logNotificationEvent("reminder.job.not_scheduled", {
      taskId,
      reason: "Reminder lead time has already passed",
      leadTimeMinutes,
    });
    return null;
  }

  const jobId = reminderIdFor(taskId);
  try {
    await withTimeout(
      taskQueue.add(
        "send-reminder",
        {
          taskId,
          scheduledDateTime: new Date(dateTime).toISOString(),
          leadTimeMinutes,
        },
        {
          jobId,
          delay,
          attempts: JOB_ATTEMPTS,
          backoff: { type: "exponential", delay: JOB_BACKOFF_MS },
          removeOnComplete: true,
          removeOnFail: 1000,
        },
      ),
      "Scheduling reminder",
    );
    await Task.updateOne(
      { _id: task._id },
      { $set: { "reminderConfig.reminderJobId": jobId } },
    );
    logNotificationEvent("reminder.job.enqueued", {
      taskId,
      jobId,
      delay,
      leadTimeMinutes,
      channels,
    });
    return jobId;
  } catch (error) {
    logNotificationEvent("reminder.job.enqueue_failed", {
      taskId,
      jobId,
      message: error.message,
    });
    return null;
  }
};

export const closeReminderQueue = async () => {
  try {
    if (queue) {
      await queue.close();
    }
  } finally {
    queue = undefined;
    if (queueConnection) {
      if (queueConnection.status === "ready") {
        await queueConnection.quit();
      } else {
        queueConnection.disconnect();
      }
      queueConnection = undefined;
    }
  }
};
