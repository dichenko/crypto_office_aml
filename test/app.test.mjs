import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createServer } from "../src/app.mjs";

let server;
afterEach(() => server?.close());

async function start(client = {
  createCheck: async () => "m_12345678",
  getResult: async () => ({ done: false, providerStatus: 1, observedStatuses: [1] }),
}) {
  server = createServer({ internalApiKey: "secret", client, logger: { info() {}, error() {} } });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${server.address().port}`;
}

test("health is public and does not call provider", async () => {
  const base = await start({
    createCheck: async () => assert.fail("provider called"),
    getResult: async () => assert.fail("provider called"),
  });
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
    body: JSON.stringify({ address: "abc", blockchain: "ETH", coin: "BTC" }),
  });
  assert.equal(response.status, 400);
});

test("creates an asynchronous AML job", async () => {
  const base = await start({ createCheck: async (params) => {
    assert.deepEqual(params, {
      address: "TXL9Qc9ZAaxFFTR6DPqwGCeKpSgGyXxA1z",
      blockchain: "tron",
      balanceCoin: 1,
      paymentCoin: 3,
    });
    return "m_abcdefgh";
  }, getResult: async () => assert.fail("result called") });
  const response = await fetch(`${base}/v1/aml/check`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-internal-api-key": "secret" },
    body: JSON.stringify({
      address: "TXL9Qc9ZAaxFFTR6DPqwGCeKpSgGyXxA1z",
      blockchain: "TRX",
      coin: "USDT",
      payment_coin: 3,
    }),
  });
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { job_id: "m_abcdefgh", status: "pending" });
});

test("maps provider errors to 502", async () => {
  const base = await start({
    createCheck: async () => { throw new Error("sensitive detail"); },
    getResult: async () => assert.fail("result called"),
  });
  const response = await fetch(`${base}/v1/aml/check`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-internal-api-key": "secret" },
    body: JSON.stringify({ address: "address", blockchain: "BTC", coin: "BTC" }),
  });
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), {
    error: "CRYPTO_OFFICE_ERROR",
    message: "AML provider request failed",
  });
});

test("returns pending job status", async () => {
  const base = await start({
    createCheck: async () => assert.fail("create called"),
    getResult: async () => ({ done: false, providerStatus: 1, observedStatuses: [1] }),
  });
  const response = await fetch(`${base}/v1/aml/check/m_abcdefgh`, {
    headers: { "x-internal-api-key": "secret" },
  });
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), {
    job_id: "m_abcdefgh",
    status: "pending",
    provider_status: 1,
    observed_provider_statuses: [1],
  });
});

test("accepts Crypto Office AML job IDs with an a_ prefix", async () => {
  const jobId = "a_e3fe1622415d87d7f3bff077675ff0ff";
  const base = await start({
    createCheck: async () => assert.fail("create called"),
    getResult: async (actualJobId) => {
      assert.equal(actualJobId, jobId);
      return { done: false, providerStatus: 1, observedStatuses: [1] };
    },
  });
  const response = await fetch(`${base}/v1/aml/check/${jobId}`, {
    headers: { "x-internal-api-key": "secret" },
  });
  assert.equal(response.status, 202);
});

test("accepts numeric AML check IDs returned by the current API", async () => {
  const base = await start({
    createCheck: async () => assert.fail("create called"),
    getResult: async (jobId) => {
      assert.equal(jobId, "28335");
      return { done: false, providerStatus: 1, observedStatuses: [1] };
    },
  });
  const response = await fetch(`${base}/v1/aml/check/28335`, {
    headers: { "x-internal-api-key": "secret" },
  });
  assert.equal(response.status, 202);
});

test("returns completed provider JSON unchanged", async () => {
  const raw = { status: true, data: { result: [{ riskScore: 0.42 }] } };
  const base = await start({
    createCheck: async () => assert.fail("create called"),
    getResult: async () => ({ done: true, providerStatus: 50, result: raw }),
  });
  const response = await fetch(`${base}/v1/aml/check/m_abcdefgh`, {
    headers: { "x-internal-api-key": "secret" },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), raw);
});
