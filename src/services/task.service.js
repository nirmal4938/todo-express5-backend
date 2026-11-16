import { Task } from "../models/task.model.js";
import { cancelReminder, scheduleReminder } from "../queues/reminderQueue.js";
import { getCachedResponse, invalidateTaskCache } from "./cache.service.js";

const taskDate = (task) => task.scheduledAt || task.dateTime;

const validateTimezone = (requestedTimezone) => {
  if (typeof requestedTimezone !== "string" || requestedTimezone.length === 0) {
    throw Object.assign(new Error("Invalid timezone"), { statusCode: 400 });
  }

  let timezone =
    requestedTimezone.startsWith(" ") &&
    /^\s(?:\d{2}:\d{2}|\d{1,4})$/.test(requestedTimezone)
      ? `+${requestedTimezone.trim()}`
      : requestedTimezone.trim();

  if (/^[+-]?\d{1,4}$/.test(timezone)) {
    const minutes = Number(timezone);
    if (Math.abs(minutes) > 14 * 60) {
      throw Object.assign(new Error("Invalid timezone offset"), {
        statusCode: 400,
      });
    }
    const sign = minutes < 0 ? "-" : "+";
    const absoluteMinutes = Math.abs(minutes);
    timezone = `${sign}${String(Math.floor(absoluteMinutes / 60)).padStart(2, "0")}:${String(
      absoluteMinutes % 60,
    ).padStart(2, "0")}`;
  }

  const offsetMatch = /^([+-])(\d{2}):(\d{2})$/.exec(timezone);
  if (offsetMatch) {
    const hours = Number(offsetMatch[2]);
    const minutes = Number(offsetMatch[3]);
    if (hours > 14 || minutes > 59 || (hours === 14 && minutes !== 0)) {
      throw Object.assign(new Error("Invalid timezone offset"), { statusCode: 400 });
    }
    return timezone;
  }

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return timezone;
  } catch {
    throw Object.assign(new Error("Invalid timezone"), { statusCode: 400 });
  }
};

const normalizeDates = (payload) => {
  const dateTime = payload.dateTime ?? payload.scheduledAt;
  if (dateTime !== undefined) {
    payload.dateTime = dateTime;
    payload.scheduledAt = dateTime;
  }
  return payload;
};

const normalizeReminderUpdates = (updates) => {
  if (!updates.reminderConfig) return updates;
  const { reminderConfig } = updates;
  delete updates.reminderConfig;
  for (const [key, value] of Object.entries(reminderConfig)) {
    updates[`reminderConfig.${key}`] = value;
  }
  return updates;
};

export const createTask = async (payload, workspaceId, userId) => {
  const task = await Task.create({
    ...normalizeDates({ ...payload }),
    workspaceId,
    createdBy: userId,
  });
  await Promise.all([
    invalidateTaskCache(workspaceId),
    task.status === "Completed"
      ? cancelReminder(task.id)
      : scheduleReminder(task),
  ]);
  return task;
};

export const listTasks = (search, workspaceId, response) => {
  const normalizedSearch = typeof search === "string" ? search.trim() : "";
  const key = normalizedSearch
    ? `workspace:${workspaceId}:tasks:search:${encodeURIComponent(normalizedSearch.toLowerCase())}`
    : `workspace:${workspaceId}:tasks:list:all`;

  return getCachedResponse(
    key,
    async () => {
      const filter = normalizedSearch
        ? { workspaceId, $text: { $search: normalizedSearch } }
        : { workspaceId };
      const tasks = await Task.find(filter).sort({ scheduledAt: 1 });
      return { success: true, count: tasks.length, data: tasks };
    },
    response,
  );
};

const weeklySummaryPipeline = (workspaceId, timezone) => [
  { $match: { workspaceId } },
  {
    $addFields: {
      dateTime: { $ifNull: ["$dateTime", "$scheduledAt"] },
    },
  },
  {
    $addFields: {
      weekStart: {
        $dateTrunc: {
          date: "$dateTime",
          unit: "week",
          startOfWeek: "monday",
          timezone,
        },
      },
    },
  },
  { $sort: { dateTime: 1, _id: 1 } },
  {
    $group: {
      _id: "$weekStart",
      openCount: {
        $sum: { $cond: [{ $eq: ["$status", "In Progress"] }, 1, 0] },
      },
      completedCount: {
        $sum: { $cond: [{ $eq: ["$status", "Completed"] }, 1, 0] },
      },
      tasks: { $push: "$$ROOT" },
    },
  },
  {
    $project: {
      _id: 0,
      weekStart: {
        $dateToString: { format: "%Y-%m-%d", date: "$_id", timezone },
      },
      weekEnd: {
        $dateToString: {
          format: "%Y-%m-%d",
          date: {
            $dateAdd: {
              startDate: "$_id",
              unit: "day",
              amount: 6,
              timezone,
            },
          },
          timezone,
        },
      },
      openCount: 1,
      completedCount: 1,
      openTasksCount: "$openCount",
      completedTasksCount: "$completedCount",
      totalTasksCount: { $size: "$tasks" },
      tasks: 1,
    },
  },
  { $sort: { weekStart: 1 } },
];

export const getWeeklySummary = (requestedTimezone, workspaceId, response) => {
  const timezone = validateTimezone(requestedTimezone || "UTC");
  const key = `workspace:${workspaceId}:tasks:weekly:${encodeURIComponent(timezone)}`;

  return getCachedResponse(
    key,
    async () => ({
      success: true,
      data: await Task.aggregate(weeklySummaryPipeline(workspaceId, timezone)),
    }),
    response,
  );
};

export const getTaskById = (id, workspaceId) =>
  Task.findOne({ _id: id, workspaceId });

export const updateTask = async (id, payload, workspaceId) => {
  const updates = normalizeReminderUpdates(
    normalizeDates({ ...payload }),
  );
  const currentTask = await Task.findOne({ _id: id, workspaceId });
  if (!currentTask) return null;

  const currentDate = taskDate(currentTask)?.getTime();
  const nextDate = updates.scheduledAt
    ? new Date(updates.scheduledAt).getTime()
    : currentDate;
  const dateChanged = nextDate !== currentDate;
  const reminderConfigChanged = Object.keys(updates).some((key) =>
    key.startsWith("reminderConfig."),
  );
  const isReopening =
    currentTask.status === "Completed" && updates.status === "In Progress";

  if (dateChanged || isReopening || reminderConfigChanged) {
    updates.reminderSent = false;
    updates["reminderConfig.reminderSentAt"] = null;
    updates["reminderConfig.deliveryStatus.email"] = "PENDING";
    updates["reminderConfig.deliveryStatus.whatsapp"] = "PENDING";
    updates["reminderConfig.deliveryStatus.alarmSynced"] = false;
    updates["reminderConfig.deliveryStatus.alarmTriggeredAt"] = null;
  }

  const task = await Task.findOneAndUpdate({ _id: id, workspaceId }, updates, {
    new: true,
    runValidators: true,
  });
  if (!task) return null;

  await invalidateTaskCache(workspaceId);
  if (task.status === "Completed") {
    await cancelReminder(id);
  } else if (dateChanged || isReopening || reminderConfigChanged) {
    await cancelReminder(id);
    await scheduleReminder(task);
  }

  return task;
};

export const deleteTask = async (id, workspaceId, userId, workspaceRole) => {
  const task = await Task.findOne({ _id: id, workspaceId });
  if (!task) return null;
  if (workspaceRole === "MEMBER" && task.createdBy.toString() !== userId) {
    return { forbidden: true };
  }

  const ownershipFilter =
    workspaceRole === "MEMBER" ? { createdBy: userId } : {};
  const deletedTask = await Task.findOneAndDelete({
    _id: id,
    workspaceId,
    ...ownershipFilter,
  });
  if (!deletedTask) return null;

  await Promise.all([invalidateTaskCache(workspaceId), cancelReminder(id)]);
  return deletedTask;
};
