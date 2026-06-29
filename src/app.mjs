import { timingSafeEqual } from "node:crypto";
import http from "node:http";

const jsonHeaders = { "Content-Type": "application/json; charset=utf-8" };

function send(response, status, body) {
  response.writeHead(status, jsonHeaders);
  response.end(JSON.stringify(body));
}

function authorized(actual, expected) {
  if (typeof actual !== "string") return false;
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

async function readJson(request) {
  let raw = "";
  for await (const chunk of request) {
    raw += chunk;
    if (Buffer.byteLength(raw) > 16_384) throw new Error("BODY_TOO_LARGE");
  }
  try {
    return JSON.parse(raw || "{}");
  } catch {
    throw new Error("INVALID_JSON");
  }
}

function maskedAddress(address) {
  return address.length <= 10 ? "***" : `${address.slice(0, 5)}...${address.slice(-5)}`;
}

const coinMappings = new Map([
  ["TRX:TRX", { blockchain: "tron", balanceCoin: 4 }],
  ["TRX:USDT", { blockchain: "tron", balanceCoin: 1 }],
  ["ETH:ETH", { blockchain: "eth", balanceCoin: 6 }],
  ["ETH:USDT", { blockchain: "eth", balanceCoin: 3 }],
  ["ETH:USDC", { blockchain: "eth", balanceCoin: 9 }],
  ["BTC:BTC", { blockchain: "bitcoin", balanceCoin: 7 }],
]);

export function createServer({ internalApiKey, client, logger = console }) {
  return http.createServer(async (request, response) => {
    const started = Date.now();
    const endpoint = new URL(request.url, "http://localhost").pathname;
    let status = 500;
    let address;

    try {
      if (request.method === "GET" && endpoint === "/health") {
        status = 200;
        return send(response, status, { status: "ok" });
      }
      const resultMatch = endpoint.match(/^\/v1\/aml\/check\/([^/]+)$/);
      const isCreate = request.method === "POST" && endpoint === "/v1/aml/check";
      const isResult = request.method === "GET" && resultMatch;
      if (!isCreate && !isResult) {
        status = 404;
        return send(response, status, { error: "NOT_FOUND" });
      }
      if (!authorized(request.headers["x-internal-api-key"], internalApiKey)) {
        status = 401;
        return send(response, status, { error: "UNAUTHORIZED" });
      }

      if (isResult) {
        const jobId = decodeURIComponent(resultMatch[1]);
        if (!/^(?:[1-9][0-9]{0,19}|[A-Za-z0-9]+_[A-Za-z0-9_-]{8,200})$/.test(jobId)) {
          status = 400;
          return send(response, status, {
            error: "VALIDATION_ERROR",
            message: "Invalid job_id",
          });
        }
        const providerStarted = Date.now();
        try {
          const result = await client.getResult(jobId);
          if (!result.done) {
            status = 202;
            return send(response, status, {
              job_id: jobId,
              status: "pending",
              provider_status: result.providerStatus,
              observed_provider_statuses: result.observedStatuses,
            });
          }
          status = 200;
          return send(response, status, result.result);
        } catch (error) {
          status = 502;
          logger.error(JSON.stringify({
            time: new Date().toISOString(), endpoint, status,
            providerDurationMs: Date.now() - providerStarted, error: error.message,
          }));
          return send(response, status, {
            error: "CRYPTO_OFFICE_ERROR",
            message: "AML provider request failed",
          });
        }
      }

      let body;
      try {
        body = await readJson(request);
      } catch {
        status = 400;
        return send(response, status, { error: "VALIDATION_ERROR", message: "Request body must be valid JSON" });
      }
      address = typeof body.address === "string" ? body.address.trim() : "";
      if (!address) {
        status = 400;
        return send(response, status, { error: "VALIDATION_ERROR", message: "Field 'address' is required" });
      }
      const blockchain = String(body.blockchain ?? "").trim().toUpperCase();
      const coin = String(body.coin ?? "").trim().toUpperCase();
      if (!blockchain || !coin) {
        status = 400;
        return send(response, status, {
          error: "VALIDATION_ERROR",
          message: "Fields 'blockchain' and 'coin' are required",
        });
      }
      const mapping = coinMappings.get(`${blockchain}:${coin}`);
      if (!mapping) {
        status = 400;
        return send(response, status, {
          error: "VALIDATION_ERROR",
          message: "Unsupported blockchain and coin combination",
        });
      }
      const paymentCoin = body.payment_coin === undefined
        ? undefined
        : Number(body.payment_coin);
      if (paymentCoin !== undefined && (!Number.isInteger(paymentCoin) || paymentCoin < 1)) {
        status = 400;
        return send(response, status, {
          error: "VALIDATION_ERROR",
          message: "Field 'payment_coin' must be a positive integer",
        });
      }

      const providerStarted = Date.now();
      try {
        const jobId = await client.createCheck({
          address,
          blockchain: mapping.blockchain,
          balanceCoin: mapping.balanceCoin,
          paymentCoin,
        });
        status = 202;
        logger.info(JSON.stringify({
          time: new Date().toISOString(), endpoint, status,
          address: maskedAddress(address), providerDurationMs: Date.now() - providerStarted,
        }));
        return send(response, status, { job_id: jobId, status: "pending" });
      } catch (error) {
        status = 502;
        logger.error(JSON.stringify({
          time: new Date().toISOString(), endpoint, status,
          address: maskedAddress(address), providerDurationMs: Date.now() - providerStarted,
          error: error.message,
        }));
        return send(response, status, {
          error: "CRYPTO_OFFICE_ERROR",
          message: "AML provider request failed",
        });
      }
    } catch (error) {
      status = 500;
      logger.error(JSON.stringify({ time: new Date().toISOString(), endpoint, status, error: error.message }));
      send(response, status, { error: "INTERNAL_ERROR" });
    } finally {
      if (endpoint !== "/v1/aml/check" || status !== 200) {
        logger.info(JSON.stringify({
          time: new Date().toISOString(), endpoint, status, durationMs: Date.now() - started,
        }));
      }
    }
  });
}
