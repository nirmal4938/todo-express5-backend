import { z } from "zod";

const memberRole = z.enum(["ADMIN", "MEMBER", "VIEWER"]);

export const createWorkspaceSchema = z.object({
  name: z.string().trim().min(1).max(120),
});

export const inviteMemberSchema = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  role: memberRole,
});

export const updateMemberRoleSchema = z.object({
  role: memberRole,
});
