import mongoose from "mongoose";

const notificationPreferencesSchema = new mongoose.Schema(
  {
    email: { type: Boolean, default: true },
    whatsapp: { type: Boolean, default: false },
    mobileAlarm: { type: Boolean, default: true },
    leadTimeMinutes: {
      type: Number,
      min: 1,
      max: 10080,
      default: 15,
    },
  },
  { _id: false },
);

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    passwordHash: {
      type: String,
      required: true,
      select: false,
    },
    refreshTokens: {
      type: [String],
      default: [],
      select: false,
    },
    defaultWorkspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Workspace",
      default: null,
    },
    phoneNumber: {
      type: String,
      trim: true,
      match: [/^\+[1-9]\d{1,14}$/, "Phone number must be in E.164 format"],
      default: undefined,
    },
    notificationPreferences: {
      type: notificationPreferencesSchema,
      default: () => ({}),
    },
  },
  { timestamps: true },
);

export const User = mongoose.model("User", userSchema);
