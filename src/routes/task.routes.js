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
import {
  acknowledgeTaskAlarm,
  getTaskAlarmCalendar,
  getUpcomingAlarms,
} from "../controllers/alarmController.js";
import { validateBody } from "../middlewares/validate.middleware.js";
import { authenticate } from "../middlewares/authenticate.js";
import { authorizeWorkspace } from "../middlewares/authorizeWorkspace.js";
import {
  createTaskSchema,
  taskStatusSchema,
  updateTaskSchema,
} from "../validation/task.validation.js";

const router = Router();
const READ_ROLES = ["OWNER", "ADMIN", "MEMBER", "VIEWER"];
const WRITE_ROLES = ["OWNER", "ADMIN", "MEMBER"];
const DETAIL_ROLES = ["OWNER", "ADMIN", "MEMBER"];

router.use(authenticate);

router.get(
  "/weekly-summary",
  authorizeWorkspace(READ_ROLES),
  getWeeklySummary,
);
router.get(
  "/upcoming-alarms",
  authorizeWorkspace(READ_ROLES),
  getUpcomingAlarms,
);
router.get(
  "/:id/alarm.ics",
  authorizeWorkspace(READ_ROLES),
  getTaskAlarmCalendar,
);
router.patch(
  "/:id/alarm-ack",
  authorizeWorkspace(READ_ROLES),
  acknowledgeTaskAlarm,
);

router
  .route("/")
  .get(authorizeWorkspace(READ_ROLES), getTasks)
  .post(
    authorizeWorkspace(WRITE_ROLES),
    validateBody(createTaskSchema),
    createTask,
  );

router
  .route("/:id")
  .get(authorizeWorkspace(DETAIL_ROLES), getTaskById)
  .put(
    authorizeWorkspace(WRITE_ROLES),
    validateBody(updateTaskSchema),
    updateTask,
  )
  .patch(
    authorizeWorkspace(WRITE_ROLES),
    validateBody(updateTaskSchema),
    updateTask,
  )
  .delete(authorizeWorkspace(WRITE_ROLES), deleteTask);

router.patch(
  "/:id/status",
  authorizeWorkspace(WRITE_ROLES),
  validateBody(taskStatusSchema),
  updateTaskStatus,
);

export default router;
