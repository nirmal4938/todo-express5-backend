import mongoose from "mongoose";

const reminderConfigSchema = new mongoose.Schema(
  {
    enabled: { type: Boolean, default: true },
    channels: {
      type: [String],
      enum: ["EMAIL", "WHATSAPP", "MOBILE_ALARM"],
      default: ["EMAIL", "WHATSAPP", "MOBILE_ALARM"],
    },
    reminderJobId: { type: String, default: null },
    reminderSentAt: { type: Date, default: null },
    deliveryStatus: {
      email: { type: String, default: "PENDING" },
      whatsapp: { type: String, default: "PENDING" },
      alarmSynced: { type: Boolean, default: false },
      alarmTriggeredAt: { type: Date, default: null },
    },
  },
  { _id: false },
);

const taskSchema = new mongoose.Schema(
  {
    workspaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Workspace",
      required: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    title: {
      type: String,
      required: [true, "Task title is mandatory"],
      trim: true,
      maxlength: [150, "Title cannot exceed 150 characters"],
    },
    description: {
      type: String,
      trim: true,
      default: "",
      maxlength: [1000, "Description cannot exceed 1000 characters"],
    },
    scheduledAt: {
      type: Date,
      required: [true, "Date & Time is mandatory"],
    },
    dateTime: {
      type: Date,
    },
    priority: {
      type: String,
      enum: {
        values: ["Low", "Medium", "High"],
        message: "Priority must be Low, Medium, or High",
      },
      default: "Medium",
    },
    status: {
      type: String,
      enum: {
        values: ["In Progress", "Completed"],
        message: "Status must be In Progress or Completed",
      },
      default: "In Progress",
    },
    reminderSent: {
      type: Boolean,
      default: false,
    },
    reminderConfig: {
      type: reminderConfigSchema,
      default: () => ({}),
    },
  },
  {
    timestamps: true,
  },
);

taskSchema.index({ workspaceId: 1, scheduledAt: 1, status: 1 });
taskSchema.index({ workspaceId: 1, dateTime: 1, status: 1 });
taskSchema.index({
  workspaceId: 1,
  title: "text",
  description: "text",
});

taskSchema.pre("validate", function synchronizeTaskDates() {
  if (this.dateTime && !this.scheduledAt) {
    this.scheduledAt = this.dateTime;
  } else if (this.scheduledAt && !this.dateTime) {
    this.dateTime = this.scheduledAt;
  }
});

export const Task = mongoose.model("Task", taskSchema);
