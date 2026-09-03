const required = ["DISCORD_TOKEN", "APPLICATION_ID", "GUILD_ID", "KEYHOLDER_ROLE_ID", "KEYMASTER_ROLE_ID", "CAGEDSUB_ROLE_ID", "CAGECHECK_CHANNEL_ID", "LOG_CHANNEL_ID"] as const;
const missing = required.filter((name) => !process.env[name]?.trim());
if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(", ")}`);

function positiveNumber(name: string, fallback: number) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a non-negative number.`);
  return value;
}

export const cfg = {
  KEYHOLDER_ROLE_ID: process.env.KEYHOLDER_ROLE_ID!,
  KEYMASTER_ROLE_ID: process.env.KEYMASTER_ROLE_ID!,
  CAGEDSUB_ROLE_ID: process.env.CAGEDSUB_ROLE_ID!,
  CAGECHECK_CHANNEL_ID: process.env.CAGECHECK_CHANNEL_ID!,
  LOG_CHANNEL_ID: process.env.LOG_CHANNEL_ID!,
  // how many minutes to wait between each request-all creation (helps avoid notification batching)
  REQUEST_ALL_SPREAD_MIN: positiveNumber("REQUEST_ALL_SPREAD_MIN", 2),
  MIN_DURATION_MIN: positiveNumber("MIN_DURATION_MIN", 10),
  MAX_DURATION_MIN: positiveNumber("MAX_DURATION_MIN", 1440),
  PROOF_LIFETIME_HOURS: positiveNumber("PROOF_LIFETIME_HOURS", 24),
  RECORD_RETENTION_DAYS: positiveNumber("RECORD_RETENTION_DAYS", 60),
};

if (cfg.MIN_DURATION_MIN > cfg.MAX_DURATION_MIN) throw new Error("MIN_DURATION_MIN cannot be greater than MAX_DURATION_MIN.");
