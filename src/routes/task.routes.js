import { Router } from "express";
import {
  createTask,
  deleteTask,
  getTaskById,
  getTasks,
  getWeeklySummary,
  updateTask,
  updateTaskStatus,
} from "../controllers/task.controller.js";

const router = Router();

router.get("/weekly-summary", getWeeklySummary);

router.route("/").get(getTasks).post(createTask);

router.route("/:id").get(getTaskById).patch(updateTask).delete(deleteTask);

router.patch("/:id/status", updateTaskStatus);

export default router;
