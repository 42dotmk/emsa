function required(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
}

function optional(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

export const env = {
  PORT: parseInt(optional("PORT", "3000"), 10),
  ENV: optional("ENV", "development"),
  APP_TIME_ZONE: optional("APP_TIME_ZONE", "Europe/Skopje"),
  DB_HOST: optional("DB_HOST", "localhost"),
  DB_PORT: parseInt(optional("DB_PORT", "5432"), 10),
  DB_USER: optional("DB_USER", "postgres"),
  DB_NAME: required("DB_NAME"),
  DB_SCHEMA: required("DB_SCHEMA"),
  DB_PASS: required("DB_PASS"),
  JWT_SECRET: required("JWT_SECRET"),
  JWT_EXPIRES_IN: optional("JWT_EXPIRES_IN", "7d"),
  GOOGLE_CLIENT_ID: required("GOOGLE_CLIENT_ID"),
  GOOGLE_CLIENT_SECRET: required("GOOGLE_CLIENT_SECRET"),
  GOOGLE_REDIRECT_URI: required("GOOGLE_REDIRECT_URI"),
  R2_ACCESS_KEY_ID: required("R2_ACCESS_KEY_ID"),
  R2_SECRET_ACCESS_KEY: required("R2_SECRET_ACCESS_KEY"),
  R2_ACCOUNT_ID: required("R2_ACCOUNT_ID"),
  R2_BUCKET: required("R2_BUCKET"),
  R2_PUBLIC_URL: required("R2_PUBLIC_URL"),
  RESEND_API_KEY: required("RESEND_API_KEY"),
  FROM_EMAIL: required("FROM_EMAIL"),
  APP_URL: required("APP_URL"),
} as const;
