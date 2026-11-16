export const ACCESS_TOKEN_TTL = process.env.JWT_ACCESS_EXPIRES_IN || "15m";
export const REFRESH_TOKEN_TTL = process.env.JWT_REFRESH_EXPIRES_IN || "7d";
export const ACCESS_TOKEN_SECRET = process.env.JWT_ACCESS_SECRET;
export const REFRESH_TOKEN_SECRET = process.env.JWT_REFRESH_SECRET;
export const REFRESH_COOKIE_NAME = "refreshToken";

export const tokenLifetimeMilliseconds = (duration) => {
  const match = /^(\d+)(s|m|h|d|w)$/i.exec(duration);
  if (!match) {
    throw new Error(`Unsupported JWT lifetime: ${duration}`);
  }

  const unitsInMilliseconds = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000,
  };
  return Number(match[1]) * unitsInMilliseconds[match[2].toLowerCase()];
};

export const assertAuthConfiguration = () => {
  if (!ACCESS_TOKEN_SECRET || !REFRESH_TOKEN_SECRET) {
    throw new Error(
      "JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be configured",
    );
  }
  if (ACCESS_TOKEN_SECRET === REFRESH_TOKEN_SECRET) {
    throw new Error("Access and refresh token secrets must be different");
  }
  if (
    Buffer.byteLength(ACCESS_TOKEN_SECRET) < 32 ||
    Buffer.byteLength(REFRESH_TOKEN_SECRET) < 32
  ) {
    throw new Error("JWT secrets must each contain at least 32 bytes");
  }
  tokenLifetimeMilliseconds(ACCESS_TOKEN_TTL);
  tokenLifetimeMilliseconds(REFRESH_TOKEN_TTL);
};
