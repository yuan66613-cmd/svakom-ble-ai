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

// 用于存储 Claude 的活动长连接会话
const sseSessions = new Map();

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

// ⭐ 1. 允许 Claude 通过 GET 请求建立标准的 MCP SSE 长连接
app.get("/mcp", (req, res) => {
  if (req.query.secret !== SECRET) return res.status(403).end();

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
  });

  const sessionId = randomUUID();
  sseSessions.set(sessionId, res);

  // 告诉 Claude 随后把控制指令（POST）发送到哪个专用地址
  const messageUrl = `${BASE_URL}/mcp/message?session=${sessionId}&secret=${SECRET}`;
  res.write(`event: endpoint\ndata: ${encodeURI(messageUrl)}\n\n`);

  req.on("close", () => {
    sseSessions.delete(sessionId);
  });
});

// ⭐ 2. 接收 Claude 发送过来的 MCP 工具调用指令
app.post("/mcp/message", (req, res) => {
  if (req.query.secret !== SECRET) return res.status(403).end();
  
  const sessionId = req.query.session;
  const sseRes = sseSessions.get(sessionId);
  const { id, method, params } = req.body;
  
  let responseBody = { jsonrpc: "2.0", id, result: {} };

  if (method === "initialize") {
    responseBody.result = { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "svakom-bridge", version: "1.0.0" } };
  } else if (method === "notifications/initialized") {
    return res.status(200).end();
  } else if (method === "tools/list") {
    responseBody.result = { tools: [
      { name: "toy_status", description: "查询玩具是否在线", inputSchema: { type: "object", properties: {} } },
      { name: "toy_set_speed", description: "设置强度0到1之间", inputSchema: { type: "object", properties: { speed: { type: "number" } }, required: ["speed"] } },
      { name: "toy_set_pattern", description: "设置振动花样1到8", inputSchema: { type: "object", properties: { pattern: { type: "integer" }, level: { type: "number" } }, required: ["pattern", "level"] } },
      { name: "toy_stop", description: "停止玩具", inputSchema: { type: "object", properties: {} } }
    ]};
  } else if (method === "tools/call") {
    const tool = params?.name, input = params?.arguments || {};
    if (tool === "toy_status") {
      responseBody.result = { content: [{ type: "text", text: Date.now() - lastSeen < 5000 ? "✅ 在线" : "❌ 离线" }] };
    } else if (tool === "toy_set_speed") {
      pendingCommand = { speed: input.speed };
      responseBody.result = { content: [{ type: "text", text: `强度 ${Math.round(input.speed * 100)}%` }] };
    } else if (tool === "toy_set_pattern") {
      pendingCommand = { pattern: input.pattern, level: input.level };
      responseBody.result = { content: [{ type: "text", text: `花样${input.pattern}` }] };
    } else if (tool === "toy_stop") {
      pendingCommand = { stop: true };
      responseBody.result = { content: [{ type: "text", text: "已停止" }] };
    }
  }

  // 按照 MCP 规范，接收到 POST 请求后直接响应 200 OK 即可
  res.status(200).end();

  // 真正的处理结果，必须通过之前建立的 SSE 长链接管道送回给 Claude
  if (sseRes) {
    sseRes.write(`event: message\ndata: ${JSON.stringify(responseBody)}\n\n`);
  }
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
