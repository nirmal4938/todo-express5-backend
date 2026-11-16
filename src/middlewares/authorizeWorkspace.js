import mongoose from "mongoose";
import { User } from "../models/User.js";
import { Workspace } from "../models/Workspace.js";

export const authorizeWorkspace =
  (allowedRoles, { workspaceParam } = {}) =>
  async (req, res, next) => {
    let workspaceId = workspaceParam
      ? req.params[workspaceParam]
      : req.get("x-workspace-id");

    if (!workspaceId) {
      const user = await User.findById(req.user.id).select("defaultWorkspaceId");
      workspaceId = user?.defaultWorkspaceId;
    }

    if (!workspaceId || !mongoose.isValidObjectId(workspaceId)) {
      return res.status(400).json({
        success: false,
        message: "A valid workspace is required",
      });
    }

    const workspace = await Workspace.findOne({
      _id: workspaceId,
      deletedAt: null,
      "members.userId": req.user.id,
    }).select("members ownerId");

    if (!workspace) {
      return res.status(403).json({
        success: false,
        message: "You are not a member of this workspace",
      });
    }

    const member = workspace.members.find(
      ({ userId }) => userId.toString() === req.user.id,
    );
    if (!member) {
      return res.status(403).json({
        success: false,
        message: "You are not a member of this workspace",
      });
    }
    if (!allowedRoles.includes(member.role)) {
      return res.status(403).json({
        success: false,
        message: "Your workspace role does not allow this action",
      });
    }

    req.workspaceId = workspace._id;
    req.workspaceRole = member.role;
    next();
  };
