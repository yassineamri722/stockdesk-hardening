const { test } = require("node:test");
const assert = require("node:assert");
const net = require("net");
const { createServer, config } = require("../src/server");

function listen(server) {
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
}

test("GET /api/products returns the seeded products", async () => {
  const server = createServer();
  const port = await listen(server);
  const res = await fetch(`http://127.0.0.1:${port}/api/products`);
  assert.strictEqual(res.status, 200);
  const list = await res.json();
  assert.strictEqual(list.length, 5);
  server.close();
});

test("GET /health is 503 when the database is unreachable", async () => {
  config.dbHost = "127.0.0.1";
  config.dbPort = 1; // nothing listens here
  const server = createServer();
  const port = await listen(server);
  const res = await fetch(`http://127.0.0.1:${port}/health`);
  assert.strictEqual(res.status, 503);
  server.close();
});

test("GET /health is 200 when the database accepts connections", async () => {
  const fakeDb = net.createServer((s) => s.end());
  await new Promise((r) => fakeDb.listen(0, "127.0.0.1", r));
  config.dbHost = "127.0.0.1";
  config.dbPort = fakeDb.address().port;
  const server = createServer();
  const port = await listen(server);
  const res = await fetch(`http://127.0.0.1:${port}/health`);
  assert.strictEqual(res.status, 200);
  server.close();
  fakeDb.close();
});

test("POST adjust is refused without the API key", async () => {
  config.apiKey = "test-key";
  const server = createServer();
  const port = await listen(server);
  const res = await fetch(`http://127.0.0.1:${port}/api/products/BOLT-M6/adjust`, { method: "POST", body: JSON.stringify({ delta: 1 }) });
  assert.strictEqual(res.status, 401);
  server.close();
});

test("POST adjust refuses a negative stock", async () => {
  config.apiKey = "test-key";
  const server = createServer();
  const port = await listen(server);
  const res = await fetch(`http://127.0.0.1:${port}/api/products/DRILL-18V/adjust`, {
    method: "POST",
    headers: { "x-api-key": "test-key" },
    body: JSON.stringify({ delta: -999 }),
  });
  assert.strictEqual(res.status, 409);
  server.close();
});
