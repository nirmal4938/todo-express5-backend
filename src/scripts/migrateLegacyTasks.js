import "dotenv/config";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import { User } from "../models/User.js";
import { Workspace } from "../models/Workspace.js";
import { Task } from "../models/task.model.js";

const email = process.env.LEGACY_MIGRATION_OWNER_EMAIL?.trim().toLowerCase();
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  throw new Error("Set a valid LEGACY_MIGRATION_OWNER_EMAIL before migrating");
}

try {
  await connectDB();

  let user = await User.findOne({ email });
  if (!user) {
    const name = process.env.LEGACY_MIGRATION_OWNER_NAME?.trim();
    const password = process.env.LEGACY_MIGRATION_OWNER_PASSWORD;
    if (!name || !password) {
      throw new Error(
        "Set LEGACY_MIGRATION_OWNER_NAME and LEGACY_MIGRATION_OWNER_PASSWORD to create the migration owner",
      );
    }
    if (password.length < 12) {
      throw new Error(
        "LEGACY_MIGRATION_OWNER_PASSWORD must be at least 12 characters",
      );
    }

    user = await User.create({
      name,
      email,
      passwordHash: await bcrypt.hash(password, 12),
    });
  }

  let workspace = user.defaultWorkspaceId
    ? await Workspace.findById(user.defaultWorkspaceId)
    : null;
  if (!workspace) {
    workspace = await Workspace.create({
      name: `${user.name}'s Workspace`,
      slug: `legacy-${user.id}-${new mongoose.Types.ObjectId().toString().slice(-8)}`,
      ownerId: user._id,
      members: [{ userId: user._id, role: "OWNER" }],
    });
    user.defaultWorkspaceId = workspace._id;
    await user.save();
  }

  const migration = await Task.updateMany(
    {
      $or: [{ workspaceId: { $exists: false } }, { workspaceId: null }],
    },
    {
      $set: {
        workspaceId: workspace._id,
        createdBy: user._id,
      },
    },
  );

  console.info(
    `Migrated ${migration.modifiedCount} legacy task(s) to workspace ${workspace.id}`,
  );
} catch (error) {
  console.error(`[migration] Failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
