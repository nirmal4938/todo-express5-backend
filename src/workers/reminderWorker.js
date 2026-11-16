import "dotenv/config";
import { Worker } from "bullmq";
import Redis from "ioredis";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import { logNotificationEvent } from "../services/notifications/notificationLogging.js";
import { deliverTaskReminder } from "../services/notifications/reminderDelivery.js";

const QUEUE_NAME = "task-reminders";

if (!process.env.REDIS_URL) {
  throw new Error("REDIS_URL is required to run the reminder worker");
}

await connectDB();

const connection = new Redis(process.env.REDIS_URL, {
  maxRetriesPerRequest: null,
  retryStrategy: (attempt) => Math.min(attempt * 250, 5000),
});
connection.on("error", (error) => {
  console.error(`[reminder-worker] Redis error: ${error.message}`);
});

const worker = new Worker(
  QUEUE_NAME,
  deliverTaskReminder,
  {
    connection,
    concurrency: 5,
  },
);

worker.on("completed", (job) => {
  logNotificationEvent("reminder.job.completed", {
    taskId: job.data.taskId,
    jobId: job.id,
  });
});
worker.on("failed", (job, error) => {
  logNotificationEvent("reminder.job.failed", {
    taskId: job?.data.taskId,
    jobId: job?.id,
    attemptsMade: job?.attemptsMade,
    message: error.message,
  });
});
worker.on("error", (error) => {
  console.error(`[reminder-worker] Worker error: ${error.message}`);
});

let shuttingDown = false;
const shutdown = async (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.info(`[reminder-worker] Received ${signal}; shutting down`);

  try {
    await worker.close();
  } catch (error) {
    console.error(`[reminder-worker] Worker shutdown failed: ${error.message}`);
    process.exitCode = 1;
  }

  try {
    if (connection.status === "ready") {
      await connection.quit();
    } else {
      connection.disconnect();
    }
  } catch (error) {
    console.error(`[reminder-worker] Redis shutdown failed: ${error.message}`);
    process.exitCode = 1;
  }

  try {
    await mongoose.disconnect();
  } catch (error) {
    console.error(`[reminder-worker] MongoDB shutdown failed: ${error.message}`);
    process.exitCode = 1;
  }
};

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
