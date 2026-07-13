import express from "express";

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

app.post("/toy-next", (req, res) => {
  if (req.headers["x-secret"] !== SECRET) return res.status(403).end();
  pendingCommand = req.body;
  res.json({ ok: true });
});

app.get("/status", (req, res) => {
  const online = Date.now() - lastSeen < 5000;
  res.json({ online, lastSeen });
});

app.post("/mcp", (req, res) => {
  if (req.query.secret !== SECRET) return res.status(403).end();
  const { tool, input } = req.body;
  if (tool === "toy_status") return res.json({ online: Date.now() - lastSeen < 5000 });
  if (tool === "toy_set_speed") { pendingCommand = { speed: input.speed }; return res.json({ ok: true }); }
  if (tool === "toy_set_pattern") { pendingCommand = { pattern: input.pattern, level: input.level }; return res.json({ ok: true }); }
  if (tool === "toy_stop") { pendingCommand = { stop: true }; return res.json({ ok: true }); }
  res.status(400).json({ error: "unknown tool" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Bridge running on ${PORT}`));
