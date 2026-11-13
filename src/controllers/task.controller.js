import { Task } from "../models/task.model.js";

// Helper to create HTTP errors cleanly
const createHttpError = (statusCode, message) => {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
};

// 1. Create Task
export const createTask = async (req, res) => {
  const { title, description, scheduledAt, priority, status } = req.body;

  const task = await Task.create({
    title,
    description,
    scheduledAt,
    priority,
    status,
  });

  res.status(201).json({
    success: true,
    data: task,
  });
};

// 2. Get All Tasks & Search by Keyword (?search=keyword)
export const getTasks = async (req, res) => {
  const { search } = req.query;
  const filter = {};

  if (search && search.trim()) {
    const regex = new RegExp(search.trim(), "i");
    filter.$or = [{ title: regex }, { description: regex }];
  }

  const tasks = await Task.find(filter).sort({ scheduledAt: 1 });

  res.status(200).json({
    success: true,
    count: tasks.length,
    data: tasks,
  });
};

// 3. Home Screen Weekly Summary Cards (Monday to Sunday)
export const getWeeklySummary = async (req, res) => {
  const timezone = req.query.timezone || "UTC";

  const summary = await Task.aggregate([
    {
      $addFields: {
        weekStart: {
          $dateTrunc: {
            date: "$scheduledAt",
            unit: "week",
            startOfWeek: "Monday",
            timezone,
          },
        },
      },
    },
    {
      $sort: { scheduledAt: 1 },
    },
    {
      $group: {
        _id: "$weekStart",
        openTasksCount: {
          $sum: {
            $cond: [{ $eq: ["$status", "In Progress"] }, 1, 0],
          },
        },
        completedTasksCount: {
          $sum: {
            $cond: [{ $eq: ["$status", "Completed"] }, 1, 0],
          },
        },
        totalTasksCount: { $sum: 1 },
        tasks: { $push: "$$ROOT" },
      },
    },
    {
      $project: {
        _id: 0,
        weekStart: "$_id",
        weekEnd: {
          $dateAdd: {
            startDate: "$_id",
            unit: "day",
            amount: 6,
          },
        },
        openTasksCount: 1,
        completedTasksCount: 1,
        totalTasksCount: 1,
        tasks: 1,
      },
    },
    {
      $sort: { weekStart: 1 },
    },
  ]);

  res.status(200).json({
    success: true,
    data: summary,
  });
};

// 4. Get Single Task
export const getTaskById = async (req, res) => {
  const task = await Task.findById(req.params.id);

  if (!task) {
    throw createHttpError(404, "Task not found");
  }

  res.status(200).json({
    success: true,
    data: task,
  });
};

// 5. Edit Task (Any attribute: title, description, scheduledAt, priority, status)
export const updateTask = async (req, res) => {
  const allowedUpdates = [
    "title",
    "description",
    "scheduledAt",
    "priority",
    "status",
  ];
  const updates = {};

  for (const key of allowedUpdates) {
    if (req.body[key] !== undefined) {
      updates[key] = req.body[key];
    }
  }

  const task = await Task.findByIdAndUpdate(req.params.id, updates, {
    new: true,
    runValidators: true,
  });

  if (!task) {
    throw createHttpError(404, "Task not found");
  }

  res.status(200).json({
    success: true,
    data: task,
  });
};

// 6. Update Task Status (Completed / In Progress)
export const updateTaskStatus = async (req, res) => {
  const { status } = req.body;

  if (!["In Progress", "Completed"].includes(status)) {
    throw createHttpError(
      400,
      'Status must be either "In Progress" or "Completed"',
    );
  }

  const task = await Task.findByIdAndUpdate(
    req.params.id,
    { status },
    { new: true, runValidators: true },
  );

  if (!task) {
    throw createHttpError(404, "Task not found");
  }

  res.status(200).json({
    success: true,
    data: task,
  });
};

// 7. Delete Task
export const deleteTask = async (req, res) => {
  const task = await Task.findByIdAndDelete(req.params.id);

  if (!task) {
    throw createHttpError(404, "Task not found");
  }

  res.status(200).json({
    success: true,
    message: "Task deleted successfully",
    id: req.params.id,
  });
};
