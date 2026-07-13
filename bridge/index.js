import express from "express";
import { randomUUID } from "crypto";

const app = express();
app.use(express.json());

const SECRET = process.env.BRIDGE_SECRET || "changeme";
let pendingCommand = null;
let lastSeen = 0;

app.get("/toy-next", (req, res) => {
  if (req.query.secret !== SECRET) return res.status(403).end();
  lastSeen = Date.now();
  const cmd = pendingCommand;
  pendingCommand = null;
  res.json({ cmd: cmd || null });
});

app.get("/mcp", (req, res) => {
  if (req.query.secret !== SECRET) return res.status(403).end();
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();
  const sessionId = randomUUID();
  res.write(`event: endpoint\ndata: /mcp/messages?secret=${SECRET}&session=${sessionId}\n\n`);
  res.write(`event: message\ndata: ${JSON.stringify({jsonrpc:"2.0",method:"notifications/initialized",params:{}})}\n\n`);
  const keepalive = setInterval(() => res.write(`: keepalive\n\n`), 15000);
  req.on("close", () => clearInterval(keepalive));
});

app.post("/mcp/messages", (req, res) => {
  if (req.query.secret !== SECRET) return res.status(403).end();
  const { id, method, params } = req.body;
  if (method === "initialize") return res.json({jsonrpc:"2.0",id,result:{protocolVersion:"2024-11-05",capabilities:{tools:{}},serverInfo:{name:"svakom-bridge",version:"1.0.0"}}});
  if (method === "tools/list") return res.json({jsonrpc:"2.0",id,result:{tools:[
    {name:"toy_status",description:"查询玩具是否在线",inputSchema:{type:"object",properties:{}}},
    {name:"toy_set_speed",description:"设置强度0-1",inputSchema:{type:"object",properties:{speed:{type:"number"}},required:["speed"]}},
    {name:"toy_set_pattern",description:"设置振动花样1-8",inputSchema:{type:"object",properties:{pattern:{type:"integer"},level:{type:"number"}},required:["pattern","level"]}},
    {name:"toy_stop",description:"停止玩具",inputSchema:{type:"object",properties:{}}}
  ]}});
  if (method === "tools/call") {
    const tool = params?.name, input = params?.arguments || {};
    if (tool === "toy_status") return res.json({jsonrpc:"2.0",id,result:{content:[{type:"text",text:Date.now()-lastSeen<5000?"✅ 在线":"❌ 离线"}]}});
    if (tool === "toy_set_speed") { pendingCommand={speed:input.speed}; return res.json({jsonrpc:"2.0",id,result:{content:[{type:"text",text:`强度${Math.round(input.speed*100)}%`}]}}); }
    if (tool === "toy_set_pattern") { pendingCommand={pattern:input.pattern,level:input.level}; return res.json({jsonrpc:"2.0",id,result:{content:[{type:"text",text:`花样${input.pattern}`}]}}); }
    if (tool === "toy_stop") { pendingCommand={stop:true}; return res.json({jsonrpc:"2.0",id,result:{content:[{type:"text",text:"已停止"}]}}); }
  }
  res.json({jsonrpc:"2.0",id,result:{}});
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Bridge running on ${PORT}`));
