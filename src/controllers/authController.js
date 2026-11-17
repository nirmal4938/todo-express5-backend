import bcrypt from "bcryptjs";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { REFRESH_COOKIE_NAME } from "../config/auth.js";
import { User } from "../models/User.js";
import { Workspace } from "../models/Workspace.js";
import { Task } from "../models/task.model.js";
import { scheduleReminder } from "../queues/reminderQueue.js";
import { sendPasswordResetEmail } from "../services/notifications/emailProvider.js";
import { recordAuditEventForUserWorkspaces } from "../services/auditService.js";
import {
  hashRefreshToken,
  refreshCookieClearOptions,
  refreshCookieOptions,
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
} from "../utils/authTokens.js";

const DUMMY_PASSWORD_HASH = bcrypt.hash("invalid-password-timing-padding", 12);

const respondWithSession = async (
  user,
  res,
  { refreshToken = signRefreshToken(user), statusCode = 200 } = {},
) => {
  const refreshTokenHash = hashRefreshToken(refreshToken);
  user.refreshTokens.push(refreshTokenHash);
  await user.save();

  res.cookie(REFRESH_COOKIE_NAME, refreshToken, refreshCookieOptions());
  res.status(statusCode).json({
    success: true,
    data: {
      accessToken: signAccessToken(user),
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        defaultWorkspaceId: user.defaultWorkspaceId,
      },
    },
  });
};

const createPersonalWorkspace = async (user) => {
  const suffix = randomUUID().slice(0, 8);
  const baseSlug =
    user.name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || "workspace";

  const workspace = await Workspace.create({
    name: `${user.name}'s Workspace`,
    slug: `${baseSlug}-${suffix}`,
    ownerId: user._id,
    members: [{ userId: user._id, role: "OWNER" }],
  });
  user.defaultWorkspaceId = workspace._id;
  await user.save();
};

export const register = async (req, res) => {
  const passwordHash = await bcrypt.hash(req.body.password, 12);
  const user = new User({
    name: req.body.name,
    email: req.body.email,
    passwordHash,
    refreshTokens: [],
  });

  try {
    await user.save();
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "An account with this email already exists",
      });
    }
    throw error;
  }

  try {
    await createPersonalWorkspace(user);
    await respondWithSession(user, res, { statusCode: 201 });
  } catch (error) {
    await Promise.all([
      Workspace.deleteMany({ ownerId: user._id }),
      User.deleteOne({ _id: user._id }),
    ]);
    throw error;
  }
};

export const login = async (req, res) => {
  const user = await User.findOne({ email: req.body.email }).select(
    "+passwordHash +refreshTokens",
  );
  const passwordHash = user?.passwordHash || (await DUMMY_PASSWORD_HASH);
  const passwordMatches = await bcrypt.compare(req.body.password, passwordHash);

  if (!passwordMatches) {
    return res.status(401).json({
      success: false,
      message: "Invalid email or password",
    });
  }

  await respondWithSession(user, res);
};

const passwordResetResponse = {
  success: true,
  message:
    "If an account with that email exists, a password reset link has been sent.",
};

const hashPasswordResetToken = (token) =>
  createHash("sha256").update(token).digest("hex");

export const forgotPassword = async (req, res) => {
  const user = await User.findOne({ email: req.body.email });
  let devResetUrl;

  if (user) {
    const rawToken = randomBytes(32).toString("hex");
    const resetUrl = `${process.env.TASK_APP_URL || "http://localhost:5173"}/reset-password?token=${rawToken}`;
    user.passwordResetTokenHash = hashPasswordResetToken(rawToken);
    user.passwordResetExpiresAt = new Date(Date.now() + 15 * 60 * 1000);
    await user.save();

    if (!process.env.SMTP_HOST) {
      devResetUrl = resetUrl;
      console.info(`Password reset link for ${user.email}: ${resetUrl}`);
    }

    try {
      await sendPasswordResetEmail({ user, resetUrl });
    } catch (error) {
      console.error(`Password reset email delivery failed: ${error.message}`);
    }
  }

  res.status(200).json({
    ...passwordResetResponse,
    ...(process.env.NODE_ENV !== "production" &&
    !process.env.SMTP_HOST &&
    devResetUrl
      ? { devResetUrl }
      : {}),
  });
};

export const verifyPasswordResetToken = async (req, res) => {
  const passwordResetTokenHash = hashPasswordResetToken(req.query.token);
  const user = await User.findOne({
    passwordResetTokenHash,
    passwordResetExpiresAt: { $gt: new Date() },
  });

  if (!user) {
    return res.status(400).json({
      success: false,
      message: "Reset link is invalid or has expired",
    });
  }

  res.status(200).json({ success: true, valid: true });
};

export const resetPassword = async (req, res) => {
  const passwordResetTokenHash = hashPasswordResetToken(req.body.token);
  const user = await User.findOne({
    passwordResetTokenHash,
    passwordResetExpiresAt: { $gt: new Date() },
  }).select("+passwordHash +refreshTokens");

  if (!user) {
    return res.status(400).json({
      success: false,
      message: "Password reset token is invalid or has expired",
    });
  }

  const passwordHash = await bcrypt.hash(req.body.password, 12);
  const result = await User.updateOne(
    {
      _id: user._id,
      passwordResetTokenHash,
      passwordResetExpiresAt: { $gt: new Date() },
    },
    {
      $set: {
        passwordHash,
        passwordResetTokenHash: null,
        passwordResetExpiresAt: null,
        refreshTokens: [],
      },
    },
  );

  if (result.modifiedCount !== 1) {
    return res.status(400).json({
      success: false,
      message: "Password reset token is invalid or has expired",
    });
  }

  recordAuditEventForUserWorkspaces({
    req,
    actorId: user._id,
    actorSnapshot: {
      name: user.name,
      email: user.email,
    },
    action: "PASSWORD_RESET_COMPLETED",
    entityType: "AUTH",
    entityId: user._id,
    entityTitle: user.email,
  });
  res.clearCookie(REFRESH_COOKIE_NAME, refreshCookieClearOptions());
  res.status(200).json({
    success: true,
    message:
      "Password has been reset successfully. Please log in with your new password.",
  });
};

export const refresh = async (req, res) => {
  console.log("\n--- [REFRESH] Request received ---");

  try {
    // 1. Check cookie
    const refreshToken = req.cookies?.[REFRESH_COOKIE_NAME];
    console.log("[REFRESH 1/6] Cookie present:", Boolean(refreshToken));
    if (!refreshToken) {
      return res.status(401).json({
        success: false,
        message: "Refresh token is required",
      });
    }

    // 2. Verify JWT signature & claims
    let claims;
    try {
      claims = verifyRefreshToken(refreshToken);
      console.log("[REFRESH 2/6] Token verified for user:", claims.sub);
    } catch (jwtErr) {
      console.error("[REFRESH 2/6] JWT verification failed:", jwtErr.message);
      res.clearCookie(REFRESH_COOKIE_NAME, refreshCookieClearOptions());
      return res.status(401).json({
        success: false,
        message: "Invalid or expired refresh token",
      });
    }

    if (claims.type !== "refresh" || !claims.sub) {
      console.warn("[REFRESH 2/6] Invalid token claims:", claims);
      res.clearCookie(REFRESH_COOKIE_NAME, refreshCookieClearOptions());
      return res.status(401).json({
        success: false,
        message: "Invalid refresh token",
      });
    }

    // 3. Find user in DB
    const user = await User.findById(claims.sub).select("+refreshTokens");
    console.log("[REFRESH 3/6] User found:", Boolean(user));
    if (!user) {
      res.clearCookie(REFRESH_COOKIE_NAME, refreshCookieClearOptions());
      return res.status(401).json({
        success: false,
        message: "Invalid refresh token",
      });
    }

    // 4. Check for token reuse
    const usedTokenHash = hashRefreshToken(refreshToken);
    const hasToken = user.refreshTokens.includes(usedTokenHash);
    console.log("[REFRESH 4/6] Token hash matches DB:", hasToken);
    if (!hasToken) {
      console.warn(
        "[REFRESH 4/6] Reuse detected! Revoking all sessions for:",
        user._id,
      );
      await User.updateOne({ _id: user._id }, { $set: { refreshTokens: [] } });
      res.clearCookie(REFRESH_COOKIE_NAME, refreshCookieClearOptions());
      return res.status(401).json({
        success: false,
        message: "Refresh token reuse detected; all sessions were revoked",
      });
    }

    // 5. Rotate refresh token atomically
    const nextRefreshToken = signRefreshToken(user);
    const nextTokenHash = hashRefreshToken(nextRefreshToken);

    console.log("[REFRESH 5/6] Rotating token in MongoDB...");
    const rotation = await User.updateOne(
      { _id: user._id, refreshTokens: usedTokenHash },
      [
        {
          $set: {
            refreshTokens: {
              $concatArrays: [
                {
                  $filter: {
                    input: "$refreshTokens",
                    as: "activeToken",
                    cond: { $ne: ["$$activeToken", usedTokenHash] },
                  },
                },
                [nextTokenHash],
              ],
            },
          },
        },
      ],
      { updatePipeline: true }, // <-- FIX: Required by Mongoose for array updates
    );

    console.log(
      "[REFRESH 5/6] Rotation modifiedCount:",
      rotation.modifiedCount,
    );
    if (rotation.modifiedCount !== 1) {
      console.warn(
        "[REFRESH 5/6] Concurrent rotation race detected! Revoking all sessions.",
      );
      await User.updateOne({ _id: user._id }, { $set: { refreshTokens: [] } });
      res.clearCookie(REFRESH_COOKIE_NAME, refreshCookieClearOptions());
      return res.status(401).json({
        success: false,
        message: "Refresh token reuse detected; all sessions were revoked",
      });
    }

    // 6. Send new tokens
    res.cookie(REFRESH_COOKIE_NAME, nextRefreshToken, refreshCookieOptions());
    console.log("[REFRESH 6/6] Success! New tokens issued for:", user.email);

    return res.status(200).json({
      success: true,
      data: {
        accessToken: signAccessToken(user),
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          defaultWorkspaceId: user.defaultWorkspaceId,
        },
      },
    });
  } catch (error) {
    console.error("========================================");
    console.error("[REFRESH FATAL ERROR]:", error.message);
    console.error(error.stack);
    console.error("========================================");
    return res.status(500).json({
      success: false,
      message: error.message || "Internal server error during token refresh",
    });
  }
};

export const logout = async (req, res) => {
  const refreshToken = req.cookies[REFRESH_COOKIE_NAME];
  if (refreshToken) {
    try {
      const claims = verifyRefreshToken(refreshToken);
      if (claims.type === "refresh" && claims.sub) {
        await User.updateOne(
          { _id: claims.sub },
          { $pull: { refreshTokens: hashRefreshToken(refreshToken) } },
        );
      }
    } catch {
      // Logout still succeeds and clears the cookie for an invalid token.
    }
  }

  res.clearCookie(REFRESH_COOKIE_NAME, refreshCookieClearOptions());
  res.status(200).json({ success: true, message: "Logged out successfully" });
};

export const updateNotificationSettings = async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) {
    return res.status(401).json({
      success: false,
      message: "User no longer exists",
    });
  }

  const nextPhoneNumber =
    req.body.phoneNumber !== undefined
      ? req.body.phoneNumber || null
      : user.phoneNumber;
  const nextWhatsAppPreference =
    req.body.notificationPreferences?.whatsapp ??
    user.notificationPreferences?.whatsapp;
  if (nextWhatsAppPreference && !nextPhoneNumber) {
    return res.status(400).json({
      success: false,
      message: "An E.164 phone number is required to enable WhatsApp reminders",
    });
  }

  if (req.body.phoneNumber !== undefined) {
    user.phoneNumber = req.body.phoneNumber || undefined;
  }
  for (const [key, value] of Object.entries(
    req.body.notificationPreferences || {},
  )) {
    user.set(`notificationPreferences.${key}`, value);
  }
  await user.save();

  const cursor = Task.find({
    createdBy: user._id,
    status: "In Progress",
    "reminderConfig.enabled": { $ne: false },
  }).cursor();
  let batch = [];
  for await (const task of cursor) {
    batch.push(scheduleReminder(task));
    if (batch.length === 50) {
      await Promise.all(batch);
      batch = [];
    }
  }
  await Promise.all(batch);

  res.status(200).json({
    success: true,
    data: {
      phoneNumber: user.phoneNumber || null,
      notificationPreferences: user.notificationPreferences,
    },
  });
};
