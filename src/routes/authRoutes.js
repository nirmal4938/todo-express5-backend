import { Router } from "express";
import rateLimit from "express-rate-limit";
import {
  login,
  logout,
  refresh,
  register,
  forgotPassword,
  resetPassword,
  verifyPasswordResetToken,
  updateNotificationSettings,
} from "../controllers/authController.js";
import {
  validateBody,
  validateQuery,
} from "../middlewares/validate.middleware.js";
import {
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  verifyResetTokenSchema,
} from "../validation/auth.validation.js";
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

const createPasswordResetLimiter = () =>
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: {
      success: false,
      message: "Too many password reset attempts. Please try again later.",
    },
  });

const forgotPasswordLimiter = createPasswordResetLimiter();
const resetPasswordLimiter = createPasswordResetLimiter();

router.post("/register", validateBody(registerSchema), register);
router.post("/login", loginLimiter, validateBody(loginSchema), login);
router.post(
  "/forgot-password",
  forgotPasswordLimiter,
  validateBody(forgotPasswordSchema),
  forgotPassword,
);
router.get(
  "/reset-password/verify",
  validateQuery(verifyResetTokenSchema),
  verifyPasswordResetToken,
);
router.post(
  "/reset-password",
  resetPasswordLimiter,
  validateBody(resetPasswordSchema),
  resetPassword,
);
router.post("/refresh", refresh);
router.post("/logout", logout);
router.patch(
  "/notifications",
  authenticate,
  validateBody(notificationSettingsSchema),
  updateNotificationSettings,
);

export default router;
