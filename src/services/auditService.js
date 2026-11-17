import { isDeepStrictEqual } from "node:util";
import { AuditLog } from "../models/AuditLog.js";
import { User } from "../models/User.js";
import { Workspace } from "../models/Workspace.js";

const sensitiveKeyPattern = /password|passwordhash|refreshtokens|token/i;

const getValueAtPath = (object, path) =>
  path.split(".").reduce((value, key) => value?.[key], object);

const normalizeForComparison = (value) => {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalizeForComparison);
  if (value && typeof value.toObject === "function") {
    return normalizeForComparison(value.toObject());
  }
  if (value && typeof value.toJSON === "function") {
    return normalizeForComparison(value.toJSON());
  }
  if (value && typeof value === "object") {
    if (value._bsontype === "ObjectId") return value.toString();
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        normalizeForComparison(child),
      ]),
    );
  }
  return value;
};

const snapshotValue = (value) => {
  if (value === undefined) return null;
  return normalizeForComparison(value);
};

export const computeFieldDiff = (beforeObj, afterObj, trackedFields) =>
  trackedFields.flatMap((field) => {
    if (field.split(".").some((part) => sensitiveKeyPattern.test(part))) {
      return [];
    }

    const oldValue = getValueAtPath(beforeObj, field);
    const newValue = getValueAtPath(afterObj, field);
    if (
      isDeepStrictEqual(
        normalizeForComparison(oldValue),
        normalizeForComparison(newValue),
      )
    ) {
      return [];
    }

    return [
      {
        field,
        oldValue: snapshotValue(oldValue),
        newValue: snapshotValue(newValue),
      },
    ];
  });

const redactSensitiveValues = (value) => {
  if (Array.isArray(value)) return value.map(redactSensitiveValues);
  if (!value || typeof value !== "object" || value instanceof Date) return value;

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !sensitiveKeyPattern.test(key))
      .map(([key, child]) => [key, redactSensitiveValues(child)]),
  );
};

const getRequestMetadata = (req) => ({
  ipAddress: String(req?.ip || req?.headers?.["x-forwarded-for"] || ""),
  userAgent: String(req?.get?.("user-agent") || req?.headers?.["user-agent"] || ""),
  requestId: String(
    req?.id || req?.get?.("x-request-id") || req?.headers?.["x-request-id"] || "",
  ),
});

const reportAuditFailure = (error, operation) => {
  console.error(
    JSON.stringify({
      level: "error",
      event: "audit_log.failure",
      operation,
      message: error?.message || String(error),
    }),
  );
};

export const recordAuditEvent = (payload) =>
  Promise.resolve()
    .then(async () => {
      const req = payload.req;
      const actorId = payload.actorId || req?.user?.id;
      const role =
        payload.actorRole ||
        payload.actorSnapshot?.role ||
        req?.workspaceRole ||
        "";
      let actorSnapshot = {
        name: payload.actorSnapshot?.name || req?.user?.name || "",
        email: payload.actorSnapshot?.email || req?.user?.email || "",
        role,
      };

      if (!actorSnapshot.name || !actorSnapshot.email) {
        const actor = await User.findById(actorId).select("name email");
        if (actor) {
          actorSnapshot = {
            name: actorSnapshot.name || actor.name || "",
            email: actorSnapshot.email || actor.email || "",
            role,
          };
        }
      }

      await AuditLog.create({
        workspaceId: payload.workspaceId || req?.workspaceId,
        actorId,
        actorSnapshot,
        action: payload.action,
        entityType: payload.entityType,
        entityId: payload.entityId,
        entityTitle: payload.entityTitle || "",
        changes: redactSensitiveValues(payload.changes || []),
        metadata: { ...getRequestMetadata(req), ...payload.metadata },
      });
    })
    .catch((error) => {
      reportAuditFailure(error, "record");
    });

export const recordAuditEventForUserWorkspaces = (payload) =>
  Promise.resolve()
    .then(async () => {
      const workspaces = await Workspace.find({
        "members.userId": payload.actorId,
        deletedAt: null,
      }).select("_id members");

      await Promise.all(
        workspaces.map((workspace) => {
          const membership = workspace.members.find(
            ({ userId }) => userId.toString() === payload.actorId.toString(),
          );
          return recordAuditEvent({
            ...payload,
            workspaceId: workspace._id,
            actorRole: membership?.role || "",
          });
        }),
      );
    })
    .catch((error) => {
      reportAuditFailure(error, "workspace_lookup");
    });
