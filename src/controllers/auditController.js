import mongoose from "mongoose";
import {
  AUDIT_ACTIONS,
  AUDIT_ENTITY_TYPES,
  AuditLog,
} from "../models/AuditLog.js";

const createHttpError = (statusCode, message) =>
  Object.assign(new Error(message), { statusCode });

const parseDateFilter = (query) => {
  const filter = {};
  if (query.startDate !== undefined) {
    const startDate = new Date(query.startDate);
    if (Number.isNaN(startDate.getTime())) {
      throw createHttpError(400, "Invalid startDate");
    }
    filter.$gte = startDate;
  }
  if (query.endDate !== undefined) {
    const endDate = new Date(query.endDate);
    if (Number.isNaN(endDate.getTime())) {
      throw createHttpError(400, "Invalid endDate");
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(query.endDate)) {
      endDate.setUTCHours(23, 59, 59, 999);
    }
    if (filter.$gte && filter.$gte > endDate) {
      throw createHttpError(400, "startDate must not be after endDate");
    }
    filter.$lte = endDate;
  }
  return filter;
};

const createWorkspaceFilter = (workspaceId, query) => {
  const filter = { workspaceId };
  if (query.action !== undefined) {
    if (!AUDIT_ACTIONS.includes(query.action)) {
      throw createHttpError(400, "Invalid action");
    }
    filter.action = query.action;
  }
  if (query.entityType !== undefined) {
    if (!AUDIT_ENTITY_TYPES.includes(query.entityType)) {
      throw createHttpError(400, "Invalid entityType");
    }
    filter.entityType = query.entityType;
  }
  for (const field of ["actorId", "entityId"]) {
    if (query[field] !== undefined) {
      if (!mongoose.isValidObjectId(query[field])) {
        throw createHttpError(400, `Invalid ${field}`);
      }
      filter[field] = query[field];
    }
  }
  const dateRange = parseDateFilter(query);
  if (Object.keys(dateRange).length) filter.createdAt = dateRange;
  return filter;
};

const parsePagination = (query) => {
  const page = query.page === undefined ? 1 : Number(query.page);
  const limit = query.limit === undefined ? 25 : Number(query.limit);
  if (!Number.isInteger(page) || page < 1) {
    throw createHttpError(400, "page must be a positive integer");
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw createHttpError(400, "limit must be an integer between 1 and 100");
  }
  return { page, limit };
};

export const getAuditLogs = async (req, res) => {
  const { page, limit } = parsePagination(req.query);
  const filter = createWorkspaceFilter(req.workspaceId, req.query);
  const [logs, total] = await Promise.all([
    AuditLog.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    AuditLog.countDocuments(filter),
  ]);
  res.status(200).json({
    logs,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  });
};

const csvCell = (value) => {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
};

const formatChanges = (changes = []) =>
  changes
    .map(({ field, oldValue, newValue }) => {
      const formatValue = (value) =>
        value instanceof Date
          ? value.toISOString()
          : typeof value === "object" && value !== null
            ? JSON.stringify(value)
            : String(value ?? "");
      return `${field}: ${formatValue(oldValue)} -> ${formatValue(newValue)}`;
    })
    .join("; ");

const csvRow = (log) =>
  [
    log.createdAt?.toISOString?.() || log.createdAt || "",
    log.actorSnapshot?.name,
    log.actorSnapshot?.email,
    log.actorSnapshot?.role,
    log.action,
    log.entityType,
    log.entityTitle,
    formatChanges(log.changes),
    log.metadata?.ipAddress,
  ]
    .map(csvCell)
    .join(",");

export const exportAuditLogsCsv = async (req, res) => {
  const filter = createWorkspaceFilter(req.workspaceId, req.query);
  const cursor = AuditLog.find(filter)
    .sort({ createdAt: -1, _id: -1 })
    .cursor();
  const headers = [
    "Timestamp",
    "Actor Name",
    "Actor Email",
    "Role",
    "Action",
    "Entity Type",
    "Entity Title",
    "Changes Summary",
    "IP Address",
  ];

  res.status(200);
  res.set({
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": 'attachment; filename="audit-logs.csv"',
  });
  res.write(`${headers.map(csvCell).join(",")}\r\n`);
  try {
    for await (const log of cursor) {
      if (!res.write(`${csvRow(log)}\r\n`)) {
        await new Promise((resolve) => res.once("drain", resolve));
      }
    }
    res.end();
  } catch (error) {
    if (!res.headersSent) throw error;
    res.destroy(error);
  }
};
