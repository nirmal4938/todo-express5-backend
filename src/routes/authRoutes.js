import { Router } from "express";
import rateLimit from "express-rate-limit";
import {
  login,
  logout,
  refresh,
  register,
  updateNotificationSettings,
} from "../controllers/authController.js";
import { validateBody } from "../middlewares/validate.middleware.js";
import { loginSchema, registerSchema } from "../validation/auth.validation.js";
import { authenticate } from "../middlewares/authenticate.js";
import { notificationSettingsSchema } from "../validation/auth.validation.js";

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many login attempts. Please try again later.",
  },
});

router.post("/register", validateBody(registerSchema), register);
router.post("/login", loginLimiter, validateBody(loginSchema), login);
router.post("/refresh", refresh);
router.post("/logout", logout);
router.patch(
  "/notifications",
  authenticate,
  validateBody(notificationSettingsSchema),
  updateNotificationSettings,
);

export default router;
