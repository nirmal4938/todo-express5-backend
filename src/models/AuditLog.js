import mongoose from "mongoose";

export const AUDIT_ACTIONS = [
  "TASK_CREATED",
  "TASK_UPDATED",
  "TASK_STATUS_CHANGED",
  "TASK_DELETED",
  "TASK_RESTORED",
  "TASK_ALARM_SYNCED",
  "WORKSPACE_CREATED",
  "MEMBER_INVITED",
  "MEMBER_ROLE_UPDATED",
  "MEMBER_REMOVED",
  "PASSWORD_RESET_COMPLETED",
];
export const AUDIT_ENTITY_TYPES = ["TASK", "WORKSPACE", "MEMBER", "AUTH"];

const changeSchema = new mongoose.Schema(
  {
    field: { type: String, required: true },
    oldValue: { type: mongoose.Schema.Types.Mixed, default: null },
    newValue: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { _id: false },
);

const auditLogSchema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Workspace",
      required: true,
      index: true,
    },
    actorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    actorSnapshot: {
      name: { type: String, default: "" },
      email: { type: String, default: "" },
      role: { type: String, default: "" },
    },
    action: {
      type: String,
      required: true,
      enum: AUDIT_ACTIONS,
    },
    entityType: {
      type: String,
      required: true,
      enum: AUDIT_ENTITY_TYPES,
    },
    entityId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    entityTitle: { type: String, default: "" },
    changes: { type: [changeSchema], default: [] },
    metadata: {
      ipAddress: { type: String, default: "" },
      userAgent: { type: String, default: "" },
      requestId: { type: String, default: "" },
    },
    createdAt: { type: Date, default: Date.now, immutable: true },
  },
  { versionKey: false },
);

auditLogSchema.index({ workspaceId: 1, createdAt: -1 });
auditLogSchema.index({
  workspaceId: 1,
  entityType: 1,
  entityId: 1,
  createdAt: -1,
});

const configuredRetentionDays = Number.parseInt(
  process.env.AUDIT_LOG_RETENTION_DAYS ?? "90",
  10,
);
if (configuredRetentionDays > 0) {
  auditLogSchema.index(
    { createdAt: 1 },
    { expireAfterSeconds: configuredRetentionDays * 24 * 60 * 60 },
  );
}

const rejectMutation = function rejectAuditLogMutation() {
  throw new Error("Audit logs are immutable and append-only");
};

for (const operation of [
  "deleteOne",
  "deleteMany",
  "findOneAndDelete",
  "findOneAndReplace",
  "replaceOne",
  "updateOne",
  "updateMany",
  "findOneAndUpdate",
]) {
  auditLogSchema.pre(operation, rejectMutation);
}

auditLogSchema.pre("save", function rejectAuditLogResave() {
  if (!this.isNew) rejectMutation();
});

export const AuditLog = mongoose.model("AuditLog", auditLogSchema);
