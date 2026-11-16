import { Router } from "express";
import { getCalendarFeed } from "../controllers/alarmController.js";

const router = Router();

router.get("/feed/:tokenOrUserId.ics", getCalendarFeed);

export default router;
