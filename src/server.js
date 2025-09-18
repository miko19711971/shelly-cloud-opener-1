// server.js — PARTE 5

// Home di servizio
app.get("/", (req, res) => {
  const rows = Object.entries(TARGETS).map(([key, t]) => {
    const ids = t.ids.join(", ");
    return `<tr>
      <td>${t.name}</td>
      <td><code>${ids}</code></td>
      <td><a href="/token/${key}">Crea link</a></td>
      <td><form method="post" action="/api/open-now/${key}" style="display:inline"><button>Manual Open</button></form></td>
    </tr>`;
  }).join("\n");
  res.type("html").send(`<!doctype html><html><head><meta charset="utf-8"/><style>
    body{font-family:system-ui;margin:24px} table{border-collapse:collapse}
    td,th{border:1px solid #ccc;padding:8px 12px}
  </style><title>Door & Gate Opener</title></head><body>
  <h1>Door & Gate Opener</h1>
  <p>Link firmati temporanei e apertura manuale.</p>
  <table><thead><tr><th>Nome</th><th>Device ID</th><th>Smart Link</th><th>Manual Open</th></tr></thead>
  <tbody>${rows}</tbody></table>
  <p class="muted">Shard fallback: <code>${SHELLY_BASE_URL}</code></p>
  </body></html>`);
});

// Crea token via API (utile per test/manuale)
app.get("/token/:target", (req, res) => {
  const targetKey = req.params.target;
  const target = TARGETS[targetKey];
  if (!target) return res.status(404).json({ ok:false, error:"unknown_target" });

  const windowMin = parseInt(req.query.mins || DEFAULT_WINDOW_MIN, 10);
  const maxOpens  = parseInt(req.query.max  || DEFAULT_MAX_OPENS, 10);

  const { token, payload } = newTokenFor(targetKey, { windowMin, max: maxOpens, used: 0 });
  const url = `${req.protocol}://${req.get("host")}/k/${targetKey}/${token}`;
  return res.json({ ok:true, url, expiresInMin: Math.round((payload.exp - Date.now())/60000) });
});

// Pagina landing protetta dal token
app.get("/k/:target/:token", (req, res) => {
  const { target, token } = req.params;
  const targetDef = TARGETS[target];
  if (!targetDef) return res.status(404).send("Invalid link");
  const parsed = parseToken(token);
  if (!parsed.ok) return res.status(400).send("Invalid link");
  const p = parsed.payload;
  if (p.tgt !== target) return res.status(400).send("Invalid link");
  if (Date.now() > p.exp) return res.status(400).send("Link scaduto");
  res.type("html").send(landingHtml(target, targetDef.name, p, token));
});

// Click su "Apri" (consuma 1 uso, opz. genera next token finché non si raggiunge max)
app.post("/k/:target/:token/open", async (req, res) => {
  const { target, token } = req.params;
  const targetDef = TARGETS[target];
  if (!targetDef) return res.status(404).json({ ok:false, error:"unknown_target" });

  const parsed = parseToken(token);
  if (!parsed.ok) return res.status(400).json({ ok:false, error:parsed.error });

  const p = parsed.payload;
  if (p.tgt !== target) return res.status(400).json({ ok:false, error:"target_mismatch" });
  if (Date.now() > p.exp) return res.status(400).json({ ok:false, error:"expired" });
  if (isSeenJti(p.jti)) return res.status(400).json({ ok:false, error:"replayed" });

  let result;
  if (targetDef.ids.length === 1) result = await openOne(targetDef.ids[0]);
  else result = await openSequence(targetDef.ids, 10000);

  markJti(p.jti);

  const used = (p.used || 0) + 1;
  const remaining = Math.max(0, p.max - used);

  if (used < p.max) {
    const { token: nextTok } = newTokenFor(target, {
      used,
      max: p.max,
      windowMin: Math.ceil((p.exp - Date.now())/60000)
    });
    const nextUrl = `${req.protocol}://${req.get("host")}/k/${target}/${nextTok}`;
    return res.json({ ok: true, opened: result, remaining, nextUrl });
  }
  return res.json({ ok: true, opened: result, remaining: 0 });
});

// ✅ RIATTIVA i bottoni delle guide (/api/open-now/:target) usando i token a scadenza
app.all("/api/open-now/:target", (req, res) => {
  const targetKey = req.params.target;
  const targetDef = TARGETS[targetKey];
  if (!targetDef) return res.status(404).send("Unknown target");
  const { token } = newTokenFor(targetKey, { windowMin: DEFAULT_WINDOW_MIN, max: DEFAULT_MAX_OPENS, used: 0 });
  return res.redirect(302, `/k/${targetKey}/${token}`);
});

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    targets: Object.keys(TARGETS).length,
    node: process.version,
    uptime: process.uptime(),
    baseUrl: SHELLY_BASE_URL,
  });
});

// ========= START =========
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log("Server running on", PORT, "TZ:", TIMEZONE);
});
