import sodium from "sodium-native";
import { Buffer } from "node:buffer";

const API_BASE_URL =
  process.env.CRYPTO_OFFICE_API_BASE_URL ||
  "https://public.crypto-office.com/api";

const PUBLIC_KEY = process.env.CRYPTO_OFFICE_PUBLIC_KEY?.trim();
const SECRET_KEY = process.env.CRYPTO_OFFICE_SECRET_KEY?.trim();

if (!PUBLIC_KEY || !SECRET_KEY) {
  throw new Error(
    "В .env отсутствуют CRYPTO_OFFICE_PUBLIC_KEY или CRYPTO_OFFICE_SECRET_KEY",
  );
}

function concatBytes(...arrays) {
  return Buffer.concat(arrays.map((item) => Buffer.from(item)));
}

function xsalsa20Xor(message, nonce, key) {
  const ciphertext = Buffer.alloc(message.length);
  sodium.crypto_stream_xor(ciphertext, message, nonce, key);

  return ciphertext;
}

async function getJson(response) {
  const text = await response.text();

  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }

  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status} ${response.statusText}\n${JSON.stringify(body, null, 2)}`,
    );
  }

  return body;
}

async function createAuthorizationToken() {
  const phraseResponse = await fetch(`${API_BASE_URL}/get-phrase`, {
    headers: {
      Accept: "application/json",
    },
  });

  const phraseJson = await getJson(phraseResponse);
  const phrase = phraseJson?.data?.phrase;

  if (!phrase) {
    throw new Error(
      `Crypto Office did not return data.phrase:\n${JSON.stringify(phraseJson, null, 2)}`,
    );
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const sourceText = `${phrase}|${timestamp}`;

  // Exactly follows the public Crypto Office Python example:
  // BLAKE2b(secret_key, 32 bytes) -> XSalsa20 stream XOR -> Base64(nonce + ciphertext)
  const encryptionKey = Buffer.alloc(sodium.crypto_generichash_BYTES);
  sodium.crypto_generichash(encryptionKey, Buffer.from(SECRET_KEY, "utf8"));

  const nonce = Buffer.alloc(sodium.crypto_stream_NONCEBYTES);
  sodium.randombytes_buf(nonce);

  const sourceBytes = Buffer.from(sourceText, "utf8");
  const ciphertext = xsalsa20Xor(sourceBytes, nonce, encryptionKey);

  const encrypted = concatBytes(nonce, ciphertext);

  const encryptedBase64 = encrypted.toString("base64");

  return `${PUBLIC_KEY}|${encryptedBase64}`;
}

async function main() {
  const token = await createAuthorizationToken();

  const authResponse = await fetch(`${API_BASE_URL}/auth/generate-request-hash`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `External ${token}`,
    },
  });

  const authJson = await getJson(authResponse);

  const requestHash =
    authJson?.request_hash ??
    authJson?.data?.request_hash ??
    null;

  console.log("Crypto Office authorization works.");
  console.log("Response:");
  console.log(JSON.stringify(authJson, null, 2));

  if (requestHash) {
    console.log(`\nrequest_hash: ${requestHash}`);
  } else {
    console.log(
      "\nNo request_hash found. Check the response structure above.",
    );
  }
}

main().catch((error) => {
  console.error("\nERROR:");
  console.error(error.message);
  process.exit(1);
});
