import { getRedisClient } from "../config/redis.js";

const CACHE_TTL_SECONDS = 300;
const taskCachePattern = (workspaceId) =>
  `workspace:${workspaceId}:tasks:*`;

export const getCachedResponse = async (key, load, response) => {
  let redis;

  try {
    redis = await getRedisClient();
    const cached = await redis.get(key);

    if (cached !== null) {
      response.set("X-Cache", "HIT");
      return JSON.parse(cached);
    }
  } catch (error) {
    console.warn(`[cache] Read failed; using MongoDB: ${error.message}`);
  }

  response.set("X-Cache", "MISS");
  const result = await load();

  if (redis) {
    try {
      await redis.set(key, JSON.stringify(result), "EX", CACHE_TTL_SECONDS);
    } catch (error) {
      console.warn(`[cache] Write failed; using MongoDB: ${error.message}`);
    }
  }

  return result;
};

export const invalidateTaskCache = async (workspaceId) => {
  try {
    const redis = await getRedisClient();
    let cursor = "0";
    const pattern = taskCachePattern(workspaceId);

    do {
      const [nextCursor, keys] = await redis.scan(
        cursor,
        "MATCH",
        pattern,
        "COUNT",
        100,
      );
      cursor = nextCursor;

      if (keys.length > 0) {
        await redis.unlink(...keys);
      }
    } while (cursor !== "0");
  } catch (error) {
    console.warn(`[cache] Invalidation failed: ${error.message}`);
  }
};
