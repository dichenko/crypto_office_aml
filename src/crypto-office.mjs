import sodium from "sodium-native";
import { Buffer } from "node:buffer";

export class ProviderError extends Error {
  constructor(message, cause) {
    super(message, { cause });
    this.name = "ProviderError";
  }
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
    throw new ProviderError(`Provider returned HTTP ${response.status}`);
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
    async checkAddress(address) {
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

        return await request(
          `${config.apiBaseUrl}${config.amlPath}`,
          {
            method: "POST",
            headers: {
              Accept: "application/json",
              "Content-Type": "application/json",
              Authorization: auth,
            },
            body: JSON.stringify({
              address,
              blockchain: "tron",
              balance_coin: 1,
              service: config.amlService,
              txid: null,
              request_hash: requestHash,
            }),
          },
          config.timeoutMs,
        );
      } catch (error) {
        if (error instanceof ProviderError) throw error;
        throw new ProviderError(
          error?.name === "TimeoutError" ? "Provider request timed out" : "Provider request failed",
          error,
        );
      }
    },
  };
}
