import { Router } from "express";
import {
  changeMemberRole,
  createWorkspace,
  deleteWorkspace,
  inviteMember,
  listWorkspaces,
  removeMember,
} from "../controllers/workspaceController.js";
import { authenticate } from "../middlewares/authenticate.js";
import { authorizeWorkspace } from "../middlewares/authorizeWorkspace.js";
import { validateBody } from "../middlewares/validate.middleware.js";
import {
  createWorkspaceSchema,
  inviteMemberSchema,
  updateMemberRoleSchema,
} from "../validation/workspace.validation.js";

const router = Router();

router.use(authenticate);
router.get("/", listWorkspaces);
router.post("/", validateBody(createWorkspaceSchema), createWorkspace);
router.delete(
  "/:id",
  authorizeWorkspace(["OWNER"], { workspaceParam: "id" }),
  deleteWorkspace,
);
router.post(
  "/:id/members",
  authorizeWorkspace(["OWNER", "ADMIN"], { workspaceParam: "id" }),
  validateBody(inviteMemberSchema),
  inviteMember,
);
router.patch(
  "/:id/members/:userId",
  authorizeWorkspace(["OWNER"], { workspaceParam: "id" }),
  validateBody(updateMemberRoleSchema),
  changeMemberRole,
);
router.delete(
  "/:id/members/:userId",
  authorizeWorkspace(["OWNER", "ADMIN"], { workspaceParam: "id" }),
  removeMember,
);

export default router;
