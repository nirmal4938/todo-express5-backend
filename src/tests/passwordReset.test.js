import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { after, before, describe, test } from "node:test";
import bcrypt from "bcryptjs";

process.env.NODE_ENV = "test";
process.env.JWT_ACCESS_SECRET = "test-access-secret-that-is-at-least-32-bytes";
process.env.JWT_REFRESH_SECRET = "test-refresh-secret-that-is-at-least-32-bytes";
delete process.env.SMTP_HOST;

const { User } = await import("../models/User.js");
const { default: app } = await import("../app.js");

const initialPassword = "OldPassword1";
const newPassword = "NewPassword2";
const user = {
  _id: "507f1f77bcf86cd799439011",
  id: "507f1f77bcf86cd799439011",
  name: "Test User",
  email: "reset-user@example.com",
  passwordHash: "",
  refreshTokens: ["existing-session-one", "existing-session-two"],
  passwordResetTokenHash: null,
  passwordResetExpiresAt: null,
  async save() {},
};
const users = [user];
const originalFindOne = User.findOne;
const originalUpdateOne = User.updateOne;
let server;
let baseUrl;
let resetToken;
const resetLogs = [];
const originalConsoleInfo = console.info;

const findMatchingUser = (query) =>
  users.find((candidate) => {
    if (query.email !== undefined) return candidate.email === query.email;
    if (query.passwordResetTokenHash !== undefined) {
      return (
        candidate.passwordResetTokenHash === query.passwordResetTokenHash &&
        candidate.passwordResetExpiresAt > query.passwordResetExpiresAt.$gt
      );
    }
    return false;
  }) || null;

before(async () => {
  console.info = (...messages) => resetLogs.push(messages.join(" "));
  user.passwordHash = await bcrypt.hash(initialPassword, 12);
  User.findOne = (query) => {
    const matchedUser = findMatchingUser(query);
    return {
      select() {
        return this;
      },
      then(resolve, reject) {
        return Promise.resolve(matchedUser).then(resolve, reject);
      },
    };
  };
  User.updateOne = async (query, update) => {
    const matchedUser = findMatchingUser(query);
    if (!matchedUser) return { modifiedCount: 0 };
    Object.assign(matchedUser, update.$set);
    return { modifiedCount: 1 };
  };

  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}/api/auth`;
});

after(async () => {
  console.info = originalConsoleInfo;
  User.findOne = originalFindOne;
  User.updateOne = originalUpdateOne;
  if (server) {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

const postJson = async (path, body) =>
  fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const get = (path) => fetch(`${baseUrl}${path}`);

describe("password reset API", { concurrency: false }, () => {
test("unknown forgot-password email returns the generic success response", async () => {
  const response = await postJson("/forgot-password", {
    email: "unknown@example.com",
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(payload, {
    success: true,
    message:
      "If an account with that email exists, a password reset link has been sent.",
  });
});

test("known email stores only a hashed token with a 15-minute expiry", async () => {
  const beforeRequest = Date.now();
  const response = await postJson("/forgot-password", { email: user.email });
  const payload = await response.json();
  const afterRequest = Date.now();
  resetToken = new URL(payload.devResetUrl).searchParams.get("token");

  assert.equal(response.status, 200);
  assert.match(resetToken, /^[a-f0-9]{64}$/);
  assert.notEqual(user.passwordResetTokenHash, resetToken);
  assert.equal(
    user.passwordResetTokenHash,
    createHash("sha256").update(resetToken).digest("hex"),
  );
  assert.ok(user.passwordResetExpiresAt instanceof Date);
  assert.ok(
    user.passwordResetExpiresAt.getTime() >=
      beforeRequest + 15 * 60 * 1000 - 1000,
  );
  assert.ok(
    user.passwordResetExpiresAt.getTime() <= afterRequest + 15 * 60 * 1000,
  );
  assert.ok(resetLogs.some((entry) => entry.includes(payload.devResetUrl)));

  const verifyResponse = await get(
    `/reset-password/verify?token=${encodeURIComponent(resetToken)}`,
  );
  assert.deepEqual(await verifyResponse.json(), { success: true, valid: true });
});

test("tampered or expired reset token returns 400", async () => {
  const tamperedResponse = await postJson("/reset-password", {
    token: `${resetToken.slice(0, -1)}0`,
    password: newPassword,
  });
  assert.equal(tamperedResponse.status, 400);

  const validHash = user.passwordResetTokenHash;
  user.passwordResetExpiresAt = new Date(Date.now() - 1000);
  const expiredResponse = await postJson("/reset-password", {
    token: resetToken,
    password: newPassword,
  });
  assert.equal(expiredResponse.status, 400);
  user.passwordResetTokenHash = validHash;
  user.passwordResetExpiresAt = new Date(Date.now() + 15 * 60 * 1000);
});

test("valid reset updates password, clears reset fields, and revokes sessions", async () => {
  const response = await postJson("/reset-password", {
    token: resetToken,
    password: newPassword,
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.success, true);
  assert.equal(await bcrypt.compare(newPassword, user.passwordHash), true);
  assert.equal(user.passwordResetTokenHash, null);
  assert.equal(user.passwordResetExpiresAt, null);
  assert.deepEqual(user.refreshTokens, []);
  assert.match(response.headers.get("set-cookie"), /refreshToken=;/);
});

test("old password login fails and new password login succeeds", async () => {
  const oldPasswordResponse = await postJson("/login", {
    email: user.email,
    password: initialPassword,
  });
  assert.equal(oldPasswordResponse.status, 401);

  const newPasswordResponse = await postJson("/login", {
    email: user.email,
    password: newPassword,
  });
  assert.equal(newPasswordResponse.status, 200);
});

test("forgot and reset endpoints each allow five requests per rate-limit window", async () => {
  for (let requestCount = 0; requestCount < 3; requestCount += 1) {
    const response = await postJson("/forgot-password", {
      email: "unknown@example.com",
    });
    assert.equal(response.status, 200);
  }
  assert.equal(
    (await postJson("/forgot-password", { email: "unknown@example.com" }))
      .status,
    429,
  );

  const invalidReset = {
    token: "a".repeat(64),
    password: newPassword,
  };
  for (let requestCount = 0; requestCount < 2; requestCount += 1) {
    assert.equal((await postJson("/reset-password", invalidReset)).status, 400);
  }
  assert.equal((await postJson("/reset-password", invalidReset)).status, 429);
});
});
