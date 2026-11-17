import * as taskService from "../services/task.service.js";
import { Task } from "../models/task.model.js";
import {
  computeFieldDiff,
  recordAuditEvent,
} from "../services/auditService.js";

const trackedTaskFields = [
  "title",
  "description",
  "scheduledAt",
  "priority",
  "status",
  "reminderConfig.channels",
];

const createHttpError = (statusCode, message) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

export const createTask = async (req, res) => {
  const task = await taskService.createTask(
    req.body,
    req.workspaceId,
    req.user.id,
  );
  recordAuditEvent({
    req,
    action: "TASK_CREATED",
    entityType: "TASK",
    entityId: task._id,
    entityTitle: task.title,
    changes: computeFieldDiff(
      {},
      task,
      ["title", "description", "scheduledAt", "priority", "status"],
    ),
  });
  res.status(201).json({ success: true, data: task });
};

export const getTasks = async (req, res) => {
  const result = await taskService.listTasks(
    req.query.search,
    req.workspaceId,
    res,
  );
  res.status(200).json(result);
};

export const getWeeklySummary = async (req, res) => {
  const result = await taskService.getWeeklySummary(
    req.query.timezoneOffset ?? req.query.timezone,
    req.workspaceId,
    res,
  );
  res.status(200).json(result);
};

export const getTaskById = async (req, res) => {
  const task = await taskService.getTaskById(req.params.id, req.workspaceId);
  if (!task) throw createHttpError(404, "Task not found");
  res.status(200).json({ success: true, data: task });
};

export const updateTask = async (req, res) => {
  const before = await Task.findOne({
    _id: req.params.id,
    workspaceId: req.workspaceId,
  });
  const task = await taskService.updateTask(
    req.params.id,
    req.body,
    req.workspaceId,
  );
  if (!task) throw createHttpError(404, "Task not found");
  const changes = computeFieldDiff(before, task, trackedTaskFields);
  if (changes.length) {
    recordAuditEvent({
      req,
      action:
        changes.length === 1 && changes[0].field === "status"
          ? "TASK_STATUS_CHANGED"
          : "TASK_UPDATED",
      entityType: "TASK",
      entityId: task._id,
      entityTitle: task.title,
      changes,
    });
  }
  res.status(200).json({ success: true, data: task });
};

export const updateTaskStatus = async (req, res) => {
  const before = await Task.findOne({
    _id: req.params.id,
    workspaceId: req.workspaceId,
  });
  const task = await taskService.updateTask(
    req.params.id,
    { status: req.body.status },
    req.workspaceId,
  );
  if (!task) throw createHttpError(404, "Task not found");
  const changes = computeFieldDiff(before, task, ["status"]);
  if (changes.length) {
    recordAuditEvent({
      req,
      action: "TASK_STATUS_CHANGED",
      entityType: "TASK",
      entityId: task._id,
      entityTitle: task.title,
      changes,
    });
  }
  res.status(200).json({ success: true, data: task });
};

export const deleteTask = async (req, res) => {
  const task = await taskService.deleteTask(
    req.params.id,
    req.workspaceId,
    req.user.id,
    req.workspaceRole,
  );
  if (task?.forbidden) {
    throw createHttpError(403, "Members can delete only their own tasks");
  }
  if (!task) throw createHttpError(404, "Task not found");
  recordAuditEvent({
    req,
    action: "TASK_DELETED",
    entityType: "TASK",
    entityId: task._id,
    entityTitle: task.title,
    changes: computeFieldDiff(task, {}, ["title", "priority"]),
  });
  res.status(200).json({
    success: true,
    message: "Task deleted successfully",
    id: req.params.id,
  });
};
