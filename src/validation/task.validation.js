import { z } from "zod";

const isoDateTime = z.string().datetime({
  offset: true,
  message: "Must be a valid ISO date-time",
});
const status = z.enum(["In Progress", "Completed"]);
const reminderConfig = z
  .object({
    enabled: z.boolean().optional(),
    channels: z
      .array(z.enum(["EMAIL", "WHATSAPP", "MOBILE_ALARM"]))
      .max(3)
      .optional(),
  })
  .optional();
const taskFields = {
  title: z.string().trim().min(1, "Task title is mandatory").max(150),
  description: z.string().trim().max(1000).optional(),
  scheduledAt: isoDateTime.optional(),
  dateTime: isoDateTime.optional(),
  priority: z.enum(["Low", "Medium", "High"]).optional(),
  status: status.optional(),
  reminderConfig,
};

export const createTaskSchema = z
  .object(taskFields)
  .refine((body) => body.scheduledAt || body.dateTime, {
    path: ["dateTime"],
    message: "A valid dateTime or scheduledAt is required",
  });

export const updateTaskSchema = z
  .object(taskFields)
  .partial()
  .refine((body) => Object.keys(body).length > 0, {
    message: "At least one task field must be provided",
  });

export const taskStatusSchema = z.object({
  status,
});
