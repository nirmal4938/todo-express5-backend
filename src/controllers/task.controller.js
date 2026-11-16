import * as taskService from "../services/task.service.js";

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
  const task = await taskService.updateTask(
    req.params.id,
    req.body,
    req.workspaceId,
  );
  if (!task) throw createHttpError(404, "Task not found");
  res.status(200).json({ success: true, data: task });
};

export const updateTaskStatus = async (req, res) => {
  const task = await taskService.updateTask(
    req.params.id,
    { status: req.body.status },
    req.workspaceId,
  );
  if (!task) throw createHttpError(404, "Task not found");
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
  res.status(200).json({
    success: true,
    message: "Task deleted successfully",
    id: req.params.id,
  });
};
