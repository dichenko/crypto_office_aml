import { createServer } from "./app.mjs";
import { loadConfig } from "./config.mjs";
import { createCryptoOfficeClient } from "./crypto-office.mjs";

const config = loadConfig();
const server = createServer({
  internalApiKey: config.internalApiKey,
  client: createCryptoOfficeClient(config),
});

server.listen(config.port, "0.0.0.0", () => {
  console.info(JSON.stringify({
    time: new Date().toISOString(),
    event: "server_started",
    host: "0.0.0.0",
    port: config.port,
  }));
});

function shutdown(signal) {
  console.info(JSON.stringify({ time: new Date().toISOString(), event: "shutdown", signal }));
  server.close((error) => process.exit(error ? 1 : 0));
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
