import sodium from "sodium-native";
import { Buffer } from "node:buffer";

export class ProviderError extends Error {
  constructor(message, cause, status = null) {
    super(message, { cause });
    this.name = "ProviderError";
    this.status = status;
  }
}

function validationSummary(body) {
  const messages = [];

  function visit(value, key = "") {
    if (messages.length >= 8 || value == null) return;
    if (typeof value === "string") {
      if (key === "message" || key === "data" || key === "error") {
        messages.push(value.slice(0, 160));
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) visit(item, key);
      return;
    }
    if (typeof value === "object") {
      for (const [childKey, child] of Object.entries(value)) {
        visit(child, childKey);
      }
    }
  }

  visit(body?.data?.errors ?? body?.errors);
  return messages.length ? `: ${messages.join("; ")}` : "";
}

async function request(url, options, timeoutMs) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();

  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    throw new ProviderError(`Provider returned non-JSON response (HTTP ${response.status})`);
  }
  if (!response.ok) {
    throw new ProviderError(
      `Provider returned HTTP ${response.status}${validationSummary(json)}`,
      undefined,
      response.status,
    );
  }
  return json;
}

function encrypt(secretKey, value) {
  const key = Buffer.alloc(sodium.crypto_generichash_BYTES);
  sodium.crypto_generichash(key, Buffer.from(secretKey));
  const nonce = Buffer.alloc(sodium.crypto_stream_NONCEBYTES);
  sodium.randombytes_buf(nonce);
  const source = Buffer.from(value);
  const encrypted = Buffer.alloc(source.length);
  sodium.crypto_stream_xor(encrypted, source, nonce, key);
  return Buffer.concat([nonce, encrypted]).toString("base64");
}

function findOperation(value, requestHash) {
  if (value == null || typeof value !== "object") return null;
  if (value.request_hash === requestHash) return value;
  for (const child of Object.values(value)) {
    const found = findOperation(child, requestHash);
    if (found) return found;
  }
  return null;
}

function collectStatuses(value, statuses = []) {
  if (statuses.length >= 20 || value == null || typeof value !== "object") {
    return statuses;
  }
  if ("request_hash" in value && "status" in value) {
    const status = Number(value.status);
    if (!Number.isNaN(status)) statuses.push(status);
  }
  for (const child of Object.values(value)) collectStatuses(child, statuses);
  return statuses;
}

async function authorization(config) {
  const phraseBody = await request(
    `${config.apiBaseUrl}/get-phrase`,
    { headers: { Accept: "application/json" } },
    config.timeoutMs,
  );
  const phrase = phraseBody?.data?.phrase;
  if (!phrase) throw new ProviderError("Provider response has no authorization phrase");

  return `External ${config.publicKey}|${encrypt(
    config.secretKey,
    `${phrase}|${Math.floor(Date.now() / 1000)}`,
  )}`;
}

export function createCryptoOfficeClient(config) {
  return {
    async createCheck({ address, blockchain, balanceCoin, paymentCoin, txid }) {
      try {
        const auth = await authorization(config);
        const hashBody = await request(
          `${config.apiBaseUrl}/auth/generate-request-hash`,
          {
            method: "POST",
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
              Authorization: auth,
            },
          },
          config.timeoutMs,
        );
        const requestHash = hashBody?.data?.request_hash ?? hashBody?.request_hash;
        if (!requestHash) throw new ProviderError("Provider response has no request hash");

        const form = new FormData();
        form.set("address", address);
        form.set("blockchain", blockchain);
        form.set("balance_coin", String(balanceCoin));
        form.set("service", config.amlService);
        form.set("request_hash", requestHash);
        form.set("payment_coin", String(paymentCoin ?? config.amlPaymentCoin));
        if (txid) form.set("txid", txid);

        const createResult = await request(
          `${config.apiBaseUrl}${config.amlPath}`,
          {
            method: "POST",
            headers: {
              Accept: "application/json",
              Authorization: auth,
            },
            body: form,
          },
          config.timeoutMs,
        );
        const amlId = createResult?.data?.id;
        if (amlId === undefined || amlId === null) {
          throw new ProviderError("Provider response has no AML check ID");
        }
        return String(amlId);
      } catch (error) {
        if (error instanceof ProviderError) throw error;
        throw new ProviderError(
          error?.name === "TimeoutError" ? "Provider request timed out" : "Provider request failed",
          error,
        );
      }
    },

    async getResult(requestHash) {
      try {
        const resultUrl = new URL(
          `${config.apiBaseUrl}/v1/aml/${encodeURIComponent(requestHash)}/show`,
        );
        const result = await request(
          resultUrl,
          {
            headers: {
              Accept: "application/json",
              Authorization: await authorization(config),
            },
          },
          config.timeoutMs,
        );
        const operation = result?.data ?? findOperation(result, requestHash);
        const providerStatus = Number(operation?.status);
        return {
          done: providerStatus === 50 || providerStatus === 40,
          providerStatus: Number.isNaN(providerStatus) ? null : providerStatus,
          observedStatuses: collectStatuses(result),
          result,
        };
      } catch (error) {
        if (error instanceof ProviderError && error.status === 409) {
          return {
            done: false,
            providerStatus: null,
            observedStatuses: [],
            result: null,
          };
        }
        if (error instanceof ProviderError) throw error;
        throw new ProviderError(
          error?.name === "TimeoutError" ? "Provider request timed out" : "Provider request failed",
          error,
        );
      }
    },
  };
}
