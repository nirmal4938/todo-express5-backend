import { createHash, randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import {
  ACCESS_TOKEN_SECRET,
  ACCESS_TOKEN_TTL,
  REFRESH_TOKEN_SECRET,
  REFRESH_TOKEN_TTL,
  tokenLifetimeMilliseconds,
} from "../config/auth.js";

export const hashRefreshToken = (token) =>
  createHash("sha256").update(token).digest("hex");

export const signAccessToken = (user) =>
  jwt.sign({ email: user.email, type: "access" }, ACCESS_TOKEN_SECRET, {
    subject: user.id,
    expiresIn: ACCESS_TOKEN_TTL,
  });

export const signRefreshToken = (user) =>
  jwt.sign({ type: "refresh" }, REFRESH_TOKEN_SECRET, {
    subject: user.id,
    expiresIn: REFRESH_TOKEN_TTL,
    jwtid: randomUUID(),
  });

export const verifyAccessToken = (token) =>
  jwt.verify(token, ACCESS_TOKEN_SECRET, { algorithms: ["HS256"] });

export const verifyRefreshToken = (token) =>
  jwt.verify(token, REFRESH_TOKEN_SECRET, { algorithms: ["HS256"] });

export const refreshCookieOptions = () => ({
  httpOnly: true,
  secure: true,
  sameSite: "None",
  path: "/api/auth",
  maxAge: tokenLifetimeMilliseconds(REFRESH_TOKEN_TTL),
});
