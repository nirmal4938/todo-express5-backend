import mongoose from "mongoose";

export const WORKSPACE_ROLES = ["OWNER", "ADMIN", "MEMBER", "VIEWER"];

const memberSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    role: {
      type: String,
      enum: WORKSPACE_ROLES,
      required: true,
    },
    joinedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false },
);

const workspaceSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
    members: {
      type: [memberSchema],
      default: [],
    },
  },
  { timestamps: true },
);

workspaceSchema.index({ "members.userId": 1 });

export const Workspace = mongoose.model("Workspace", workspaceSchema);
