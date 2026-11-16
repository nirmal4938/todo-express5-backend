import mongoose from "mongoose";
import { Task } from "../models/task.model.js";
import { User } from "../models/User.js";
import { Workspace } from "../models/Workspace.js";
import { invalidateTaskCache } from "../services/cache.service.js";
import {
  generateSingleTaskAlarmIcs,
  generateWorkspaceCalendarFeedIcs,
} from "../services/notifications/mobileAlarmProvider.js";

const sendCalendar = (res, content, filename, disposition = "attachment") =>
  res
    .status(200)
    .set({
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `${disposition}; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    })
    .send(content);

const leadTimeFor = (user) =>
  Math.max(
    1,
    Math.floor(Number(user?.notificationPreferences?.leadTimeMinutes) || 15),
  );

const taskDateFilter = (start, end) => ({
  $or: [
    { scheduledAt: { $gte: start, $lte: end } },
    {
      scheduledAt: { $exists: false },
      dateTime: { $gte: start, $lte: end },
    },
  ],
});

export const getTaskAlarmCalendar = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({
      success: false,
      message: "Invalid task ID",
    });
  }

  const task = await Task.findOne({
    _id: req.params.id,
    workspaceId: req.workspaceId,
  });
  if (!task) {
    return res.status(404).json({
      success: false,
      message: "Task not found",
    });
  }

  const user = await User.findById(req.user.id).select(
    "notificationPreferences",
  );
  const content = generateSingleTaskAlarmIcs(task, leadTimeFor(user));
  await Task.updateOne(
    { _id: task._id, workspaceId: req.workspaceId },
    { $set: { "reminderConfig.deliveryStatus.alarmSynced": true } },
  );
  await invalidateTaskCache(task.workspaceId);

  return sendCalendar(res, content, `task-alarm-${task.id}.ics`);
};

export const getCalendarFeed = async (req, res) => {
  const userId = req.params.tokenOrUserId;
  if (!mongoose.isValidObjectId(userId)) {
    return res.status(404).json({
      success: false,
      message: "Calendar feed not found",
    });
  }

  const [user, workspaces] = await Promise.all([
    User.findById(userId).select("notificationPreferences"),
    Workspace.find({
      "members.userId": userId,
      deletedAt: null,
    }).select("_id name"),
  ]);
  if (!user || user.notificationPreferences?.mobileAlarm === false) {
    return res.status(404).json({
      success: false,
      message: "Calendar feed not found",
    });
  }

  const tasks = await Task.find({
    workspaceId: { $in: workspaces.map(({ _id }) => _id) },
    status: "In Progress",
    "reminderConfig.enabled": { $ne: false },
    "reminderConfig.channels": "MOBILE_ALARM",
  }).sort({ scheduledAt: 1, dateTime: 1 });

  const workspaceName =
    workspaces.length === 1
      ? workspaces[0].name
      : "Todo Workspace Calendar";
  const content = generateWorkspaceCalendarFeedIcs(
    tasks,
    workspaceName,
    leadTimeFor(user),
  );

  if (tasks.length > 0) {
    await Task.updateMany(
      { _id: { $in: tasks.map(({ _id }) => _id) } },
      { $set: { "reminderConfig.deliveryStatus.alarmSynced": true } },
    );
    await Promise.all(
      [...new Set(tasks.map((task) => task.workspaceId.toString()))].map(
        invalidateTaskCache,
      ),
    );
  }

  return sendCalendar(
    res,
    content,
    `todo-calendar-${userId}.ics`,
    "inline",
  );
};

export const getUpcomingAlarms = async (req, res) => {
  const now = new Date();
  const user = await User.findById(req.user.id).select(
    "notificationPreferences",
  );
  const leadTimeMinutes = leadTimeFor(user);
  const start = new Date(now.getTime() - 5 * 60 * 1000);
  const end = new Date(now.getTime() + leadTimeMinutes * 60 * 1000);
  const tasks =
    user?.notificationPreferences?.mobileAlarm === false
      ? []
      : await Task.find({
          workspaceId: req.workspaceId,
          status: "In Progress",
          "reminderConfig.enabled": { $ne: false },
          "reminderConfig.channels": "MOBILE_ALARM",
          ...taskDateFilter(start, end),
        })
          .select(
            "title description priority dateTime scheduledAt reminderConfig.channels",
          )
          .sort({ scheduledAt: 1, dateTime: 1 });

  const alarms = tasks.map((task) => ({
    id: task.id,
    title: task.title,
    description: task.description,
    priority: task.priority,
    dateTime: task.scheduledAt || task.dateTime,
    scheduledAt: task.scheduledAt || task.dateTime,
    channels: task.reminderConfig?.channels || [],
  }));
  const serverTime = now.toISOString();

  return res.status(200).json({
    success: true,
    alarms,
    serverTime,
    data: alarms,
  });
};

export const acknowledgeTaskAlarm = async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) {
    return res.status(400).json({
      success: false,
      message: "Invalid task ID",
    });
  }

  const task = await Task.findOneAndUpdate(
    { _id: req.params.id, workspaceId: req.workspaceId },
    { $set: { "reminderConfig.deliveryStatus.alarmSynced": true } },
    { new: true },
  );
  if (!task) {
    return res.status(404).json({
      success: false,
      message: "Task not found",
    });
  }

  await invalidateTaskCache(task.workspaceId);
  return res.status(200).json({
    success: true,
    data: {
      id: task.id,
      alarmSynced: task.reminderConfig?.deliveryStatus?.alarmSynced === true,
    },
  });
};
