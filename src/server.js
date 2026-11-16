import "dotenv/config";
import mongoose from "mongoose";
import app from "./app.js";
import { closeRedis } from "./config/redis.js";
import { connectDB } from "./config/db.js";
import { closeReminderQueue } from "./queues/reminderQueue.js";
import { assertAuthConfiguration } from "./config/auth.js";

const PORT = process.env.PORT || 5000;

assertAuthConfiguration();
await connectDB();

const server = app.listen(PORT, () => {
  console.log(`Express 5 server running on http://localhost:${PORT}`);
});

let shuttingDown = false;
const shutdown = (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.info(`Received ${signal}; shutting down gracefully`);

  server.close(async (error) => {
    if (error) {
      console.error(`HTTP server shutdown error: ${error.message}`);
      process.exitCode = 1;
    }

    const results = await Promise.allSettled([
      mongoose.disconnect(),
      closeRedis(),
      closeReminderQueue(),
    ]);
    for (const result of results) {
      if (result.status === "rejected") {
        console.error(`Shutdown cleanup failed: ${result.reason.message}`);
        process.exitCode = 1;
      }
    }
  });
};

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));
