import Redis from "ioredis";

const redisUrl = process.env.REDIS_URL || "redis://127.0.0.1:6379";

export const redisClient = new Redis(redisUrl, {
  lazyConnect: true,
  connectTimeout: 1000,
  maxRetriesPerRequest: 1,
  retryStrategy: (attempt) => Math.min(attempt * 250, 5000),
  enableOfflineQueue: false,
});

let connectionPromise;

redisClient.on("error", (error) => {
  console.warn(`[redis] Connection unavailable: ${error.message}`);
});

export const getRedisClient = async () => {
  if (redisClient.status === "wait") {
    if (!connectionPromise) {
      connectionPromise = redisClient.connect().finally(() => {
        connectionPromise = undefined;
      });
    }

    await connectionPromise;
  }

  if (redisClient.status !== "ready") {
    throw new Error(`Redis is not ready (status: ${redisClient.status})`);
  }

  return redisClient;
};

export const closeRedis = async () => {
  if (redisClient.status === "ready") {
    await redisClient.quit();
  } else if (redisClient.status !== "end") {
    redisClient.disconnect();
  }
};
