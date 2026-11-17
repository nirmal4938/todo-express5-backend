import { randomUUID } from "node:crypto";
import { User } from "../models/User.js";
import { Workspace } from "../models/Workspace.js";
import { invalidateTaskCache } from "../services/cache.service.js";
import { recordAuditEvent } from "../services/auditService.js";

const slugify = (name) =>
  name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "workspace";

export const listWorkspaces = async (req, res) => {
  const workspaces = await Workspace.find({
    "members.userId": req.user.id,
    deletedAt: null,
  })
    .select("name slug ownerId members")
    .sort({ createdAt: 1 });
  res.status(200).json({ success: true, data: workspaces });
};

export const createWorkspace = async (req, res) => {
  const user = await User.findById(req.user.id).select("name defaultWorkspaceId");
  if (!user) {
    return res.status(401).json({
      success: false,
      message: "User no longer exists",
    });
  }

  const workspace = await Workspace.create({
    name: req.body.name,
    slug: `${slugify(req.body.name)}-${randomUUID().slice(0, 8)}`,
    ownerId: req.user.id,
    members: [{ userId: req.user.id, role: "OWNER" }],
  });
  if (!user.defaultWorkspaceId) {
    await User.updateOne(
      { _id: user._id, defaultWorkspaceId: null },
      { $set: { defaultWorkspaceId: workspace._id } },
    );
  }

  recordAuditEvent({
    req,
    workspaceId: workspace._id,
    actorRole: "OWNER",
    action: "WORKSPACE_CREATED",
    entityType: "WORKSPACE",
    entityId: workspace._id,
    entityTitle: workspace.name,
    changes: [{ field: "name", oldValue: null, newValue: workspace.name }],
  });
  res.status(201).json({ success: true, data: workspace });
};

export const inviteMember = async (req, res) => {
  const user = await User.findOne({ email: req.body.email }).select("_id email name");
  if (!user) {
    return res.status(404).json({
      success: false,
      message: "No registered user exists with that email",
    });
  }

  const workspace = await Workspace.findOneAndUpdate(
    {
      _id: req.workspaceId,
      members: { $not: { $elemMatch: { userId: user._id } } },
    },
    { $push: { members: { userId: user._id, role: req.body.role } } },
    { new: true },
  );
  if (!workspace) {
    const workspaceExists = await Workspace.exists({ _id: req.workspaceId });
    if (!workspaceExists) {
      return res.status(404).json({
        success: false,
        message: "Workspace not found",
      });
    }
    return res.status(409).json({
      success: false,
      message: "User is already a workspace member",
    });
  }
  recordAuditEvent({
    req,
    action: "MEMBER_INVITED",
    entityType: "MEMBER",
    entityId: user._id,
    entityTitle: user.email,
    changes: [{ field: "role", oldValue: null, newValue: req.body.role }],
  });
  res.status(201).json({ success: true, data: workspace });
};

export const changeMemberRole = async (req, res) => {
  const workspace = await Workspace.findById(req.workspaceId);
  const member = workspace.members.find(
    ({ userId }) => userId.toString() === req.params.userId,
  );
  if (!member) {
    return res.status(404).json({
      success: false,
      message: "Workspace member not found",
    });
  }
  if (member.role === "OWNER") {
    return res.status(400).json({
      success: false,
      message: "The workspace owner role cannot be changed",
    });
  }

  const oldRole = member.role;
  member.role = req.body.role;
  await workspace.save();
  recordAuditEvent({
    req,
    action: "MEMBER_ROLE_UPDATED",
    entityType: "MEMBER",
    entityId: member.userId,
    entityTitle: member.email || member.userId.toString(),
    changes: [{ field: "role", oldValue: oldRole, newValue: member.role }],
  });
  res.status(200).json({ success: true, data: workspace });
};

export const removeMember = async (req, res) => {
  const userId = req.params.userId;
  const workspace = await Workspace.findById(req.workspaceId);
  const member = workspace.members.find(
    ({ userId: memberId }) => memberId.toString() === userId,
  );
  if (!member) {
    return res.status(404).json({
      success: false,
      message: "Workspace member not found",
    });
  }
  if (member.role === "OWNER") {
    return res.status(400).json({
      success: false,
      message: "The workspace owner cannot be removed",
    });
  }

  workspace.members.pull({ userId });
  await workspace.save();
  recordAuditEvent({
    req,
    action: "MEMBER_REMOVED",
    entityType: "MEMBER",
    entityId: member.userId,
    entityTitle: member.email || member.userId.toString(),
    changes: [{ field: "role", oldValue: member.role, newValue: null }],
  });

  const user = await User.findById(userId).select("defaultWorkspaceId");
  if (user?.defaultWorkspaceId?.equals(workspace._id)) {
    const nextWorkspace = await Workspace.findOne({
      "members.userId": userId,
      _id: { $ne: workspace._id },
    }).select("_id");
    user.defaultWorkspaceId = nextWorkspace?._id ?? null;
    await user.save();
  }

  res.status(200).json({
    success: true,
    message: "Workspace member removed",
  });
};

export const deleteWorkspace = async (req, res) => {
  const workspace = await Workspace.findOneAndUpdate(
    {
      _id: req.workspaceId,
      ownerId: req.user.id,
      deletedAt: null,
    },
    { $set: { deletedAt: new Date() } },
    { new: true },
  );
  if (!workspace) {
    return res.status(404).json({
      success: false,
      message: "Workspace not found",
    });
  }

  await Promise.all(
    workspace.members.map(async ({ userId }) => {
      const user = await User.findById(userId).select("defaultWorkspaceId");
      if (!user?.defaultWorkspaceId?.equals(workspace._id)) return;

      const nextWorkspace = await Workspace.findOne({
        _id: { $ne: workspace._id },
        deletedAt: null,
        "members.userId": userId,
      }).select("_id");
      user.defaultWorkspaceId = nextWorkspace?._id ?? null;
      await user.save();
    }),
  );
  await invalidateTaskCache(workspace._id);
  res.status(200).json({
    success: true,
    message: "Workspace deleted",
    id: workspace.id,
  });
};
