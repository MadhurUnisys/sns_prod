import "dotenv/config";

const isProduction = process.env.NODE_ENV === "production";
const developmentSecret = "local-development-only-change-before-deploy";

export const PORT = Number(process.env.PORT || 3000);
export const HOST = process.env.HOST || "0.0.0.0";
export const ACCESS_TOKEN_SECRET =
  process.env.ACCESS_TOKEN_SECRET || (isProduction ? "" : developmentSecret);
export const REFRESH_TOKEN_SECRET =
  process.env.REFRESH_TOKEN_SECRET || (isProduction ? "" : `${developmentSecret}-refresh`);
export const ADMIN_SESSION_SECRET =
  process.env.ADMIN_SESSION_SECRET || (isProduction ? "" : `${developmentSecret}-admin-session`);
export const isProductionEnvironment = isProduction;

// Read per order so a deploy can change the rate; each order snapshots the rate it was created with.
export const getPlatformTakeRatePercent = () => {
  const setting = process.env.PLATFORM_TAKE_RATE_PERCENT?.trim();
  const value = setting ? Number(setting) : 12;
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error("PLATFORM_TAKE_RATE_PERCENT must be a number from 0 to 100.");
  }
  return value;
};

export const validateRuntimeConfig = () => {
  getPlatformTakeRatePercent();
  if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }
  if (
    ACCESS_TOKEN_SECRET &&
    REFRESH_TOKEN_SECRET &&
    ACCESS_TOKEN_SECRET === REFRESH_TOKEN_SECRET
  ) {
    throw new Error("Access-token and refresh-token secrets must be different.");
  }
  if (isProduction) {
    const secrets = [
      ACCESS_TOKEN_SECRET,
      REFRESH_TOKEN_SECRET,
      ADMIN_SESSION_SECRET,
    ];
    if (secrets.some((secret) => secret.length < 32)) {
      throw new Error(
        "ACCESS_TOKEN_SECRET, REFRESH_TOKEN_SECRET, and ADMIN_SESSION_SECRET must each contain at least 32 characters in production."
      );
    }
    if (new Set(secrets).size !== secrets.length) {
      throw new Error("Access-token, refresh-token, and AdminJS session secrets must be different.");
    }
  }
};
