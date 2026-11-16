import { z } from "zod";

const email = z.string().trim().email().max(254).transform((value) => value.toLowerCase());
const password = z.string().min(12).max(128);

export const registerSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email,
  password,
});

export const loginSchema = z.object({
  email,
  password: z.string().min(1).max(128),
});

export const notificationSettingsSchema = z
  .object({
    phoneNumber: z
      .union([
        z.string().regex(/^\+[1-9]\d{1,14}$/, "Phone number must be E.164"),
        z.literal(""),
      ])
      .optional(),
    notificationPreferences: z
      .object({
        email: z.boolean().optional(),
        whatsapp: z.boolean().optional(),
        mobileAlarm: z.boolean().optional(),
        leadTimeMinutes: z.number().int().min(1).max(10080).optional(),
      })
      .strict()
      .optional(),
  })
  .refine(
    (body) =>
      body.phoneNumber !== undefined ||
      Object.keys(body.notificationPreferences || {}).length > 0,
    { message: "At least one notification setting must be provided" },
  );
