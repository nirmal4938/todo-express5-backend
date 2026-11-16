import { verifyAccessToken } from "../utils/authTokens.js";

export const authenticate = (req, res, next) => {
  const authorization = req.get("authorization");
  const match = /^Bearer ([^\s]+)$/i.exec(authorization || "");
  if (!match) {
    return res.status(401).json({
      success: false,
      message: "Authentication required",
    });
  }

  try {
    const payload = verifyAccessToken(match[1]);
    if (payload.type !== "access" || !payload.sub || !payload.email) {
      throw new Error("Invalid access token claims");
    }

    req.user = { id: payload.sub, email: payload.email };
    next();
  } catch {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired access token",
    });
  }
};
