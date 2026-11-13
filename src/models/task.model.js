import mongoose from "mongoose";

const taskSchema = new mongoose.Schema(
  {
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
  },
  {
    timestamps: true,
  },
);

taskSchema.index({ scheduledAt: 1, status: 1 });
taskSchema.index({ title: "text", description: "text" });

export const Task = mongoose.model("Task", taskSchema);
