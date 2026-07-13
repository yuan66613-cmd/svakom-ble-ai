import express from "express";
import { randomUUID } from "crypto";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const SECRET = process.env.BRIDGE_SECRET || "changeme";
const BASE_URL = process.env.RAILWAY_PUBLIC_DOMAIN 
  ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` 
  : "http://localhost:3000";

let pendingCommand = null;
let lastSeen = 0;

app.get("/.well-known/oauth-authorization-server", (req, res) => {
  res.json({
    issuer: BASE_URL,
    authorization_endpoint: `${BASE_URL}/oauth/authorize`,
    token_endpoint: `${BASE_URL}/oauth/token`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
  });
});

app.get("/oauth/authorize", (req, res) => {
  const { redirect_uri, state } = req.query;
  const code = randomUUID();
  const url = new URL(redirect_uri);
  url.searchParams.set("code", code);
  if (state) url.searchParams.set("state", state);
  res.redirect(url.toString());
});

app.post("/oauth/token", (req, res) => {
  res.json({ access_token: SECRET, token_type: "bearer", expires_in: 86400 });
});

app.post("/mcp", (req, res) => {
  const auth = req.headers.authorization || "";
  if (!auth.includes(SECRET) && req.query.secret !== SECRET) return res.status(403).json({ error: "forbidden" });
  const { id, method, params } = req.body;
  if (method === "initialize") return res.json({ jsonrpc: "2.0", id, result: { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "svakom-bridge", version: "1.0.0" } } });
  if (method === "notifications/initialized") return res.status(200).end();
  if (method === "tools/list") return res.json({ jsonrpc: "2.0", id, result: { tools: [
    { name: "toy_status", description: "查询玩具是否在线", inputSchema: { type: "object", properties: {} } },
    { name: "toy_set_speed", description: "设置强度0到1之间", inputSchema: { type: "object", properties: { speed: { type: "number" } }, required: ["speed"] } },
    { name: "toy_set_pattern", description: "设置振动花样1到8", inputSchema: { type: "object", properties: { pattern: { type: "integer" }, level: { type: "number" } }, required: ["pattern", "level"] } },
    { name: "toy_stop", description: "停止玩具", inputSchema: { type: "object", properties: {} } }
  ]}});
  if (method === "tools/call") {
    const tool = params?.name, input = params?.arguments || {};
    if (tool === "toy_status") return res.json({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: Date.now() - lastSeen < 5000 ? "✅ 在线" : "❌ 离线" }] } });
    if (tool === "toy_set_speed") { pendingCommand = { speed: input.speed }; return res.json({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: `强度 ${Math.round(input.speed * 100)}%` }] } }); }
    if (tool === "toy_set_pattern") { pendingCommand = { pattern: input.pattern, level: input.level }; return res.json({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: `花样${input.pattern}` }] } }); }
    if (tool === "toy_stop") { pendingCommand = { stop: true }; return res.json({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: "已停止" }] } }); }
  }
  res.json({ jsonrpc: "2.0", id, result: {} });
});

app.get("/toy-next", (req, res) => {
  if (req.query.secret !== SECRET) return res.status(403).end();
  lastSeen = Date.now();
  const cmd = pendingCommand;
  pendingCommand = null;
  res.json({ cmd: cmd || null });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Bridge running on port ${PORT}`));
