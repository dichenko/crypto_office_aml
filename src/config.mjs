function required(name, env) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function loadConfig(env = process.env) {
  const port = Number(env.PORT ?? 8000);
  const timeoutMs = Number(env.CRYPTO_OFFICE_TIMEOUT_MS ?? 120000);
  const amlService = (env.CRYPTO_OFFICE_AML_SERVICE ?? "crystal").trim().toLowerCase();

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000) {
    throw new Error("CRYPTO_OFFICE_TIMEOUT_MS must be an integer >= 1000");
  }
  if (!["bitok", "crystal"].includes(amlService)) {
    throw new Error("CRYPTO_OFFICE_AML_SERVICE must be 'bitok' or 'crystal'");
  }

  return {
    port,
    timeoutMs,
    publicKey: required("CRYPTO_OFFICE_PUBLIC_KEY", env),
    secretKey: required("CRYPTO_OFFICE_SECRET_KEY", env),
    internalApiKey: required("INTERNAL_API_KEY", env),
    apiBaseUrl: (env.CRYPTO_OFFICE_API_BASE_URL ?? "https://public.crypto-office.com/api").replace(/\/+$/, ""),
    amlPath: env.CRYPTO_OFFICE_AML_PATH ?? "/aml/create",
    amlService,
  };
}
