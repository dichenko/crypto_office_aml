import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createServer } from "../src/app.mjs";

let server;
afterEach(() => server?.close());

async function start(client = { checkAddress: async () => ({ data: { riskScore: 0.1 } }) }) {
  server = createServer({ internalApiKey: "secret", client, logger: { info() {}, error() {} } });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

test("health is public and does not call provider", async () => {
  const base = await start({ checkAddress: async () => assert.fail("provider called") });
  const response = await fetch(`${base}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok" });
});

test("rejects missing API key", async () => {
  const base = await start();
  const response = await fetch(`${base}/v1/aml/check`, { method: "POST" });
  assert.equal(response.status, 401);
});

test("validates address and blockchain", async () => {
  const base = await start();
  const response = await fetch(`${base}/v1/aml/check`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-internal-api-key": "secret" },
    body: JSON.stringify({ address: "abc", blockchain: "ETH" }),
  });
  assert.equal(response.status, 400);
});

test("returns provider JSON without changing its structure", async () => {
  const raw = { status: true, data: { result: [{ riskScore: 0.42 }] } };
  const base = await start({ checkAddress: async (address) => {
    assert.equal(address, "TXL9Qc9ZAaxFFTR6DPqwGCeKpSgGyXxA1z");
    return raw;
  } });
  const response = await fetch(`${base}/v1/aml/check`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-internal-api-key": "secret" },
    body: JSON.stringify({ address: "TXL9Qc9ZAaxFFTR6DPqwGCeKpSgGyXxA1z", blockchain: "TRX" }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), raw);
});

test("maps provider errors to 502", async () => {
  const base = await start({ checkAddress: async () => { throw new Error("sensitive detail"); } });
  const response = await fetch(`${base}/v1/aml/check`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-internal-api-key": "secret" },
    body: JSON.stringify({ address: "address" }),
  });
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), {
    error: "CRYPTO_OFFICE_ERROR",
    message: "AML provider request failed",
  });
});
