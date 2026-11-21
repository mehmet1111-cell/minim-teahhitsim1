"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");

const root = __dirname;
const port = Number(process.env.PORT) || 3000;
const dataFile = process.env.LEAGUE_DATA_FILE
  ? path.resolve(process.env.LEAGUE_DATA_FILE)
  : path.join(root, ".league-data.json");

const players = new Map();
const idleLimit = 30 * 24 * 60 * 60 * 1000;

function loadPlayers() {
  try {
    const saved = JSON.parse(fs.readFileSync(dataFile, "utf8"));
    if (!Array.isArray(saved)) return;
    saved.forEach((p) => {
      if (p && /^[a-f0-9]{32}$/.test(p.id) && /^[a-f0-9]{64}$/.test(p.token)) {
        players.set(p.id, p);
      }
    });
  } catch (_) {}
}

function savePlayers() {
  try {
    fs.writeFileSync(dataFile, JSON.stringify([...players.values()]), "utf8");
  } catch (_) {}
}

function send(res, status, data, extraHeaders) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...(extraHeaders || {})
  });
  res.end(JSON.stringify(data));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 16 * 1024) {
        reject(new Error("İstek çok büyük."));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (_) {
        reject(new Error("Geçersiz JSON."));
      }
    });
  });
}

function cleanPlayers() {
  const now = Date.now();
  let changed = false;
  for (const [id, p] of players) {
    if (!Number.isFinite(p.updatedAt) || now - p.updatedAt > idleLimit) {
      players.delete(id);
      changed = true;
    }
  }
  if (changed) savePlayers();
}

function rankRows() {
  cleanPlayers();
  return [...players.values()]
    .sort((a, b) => b.netWorth - a.netWorth)
    .map(({ id, company, netWorth, level, logo, color, updatedAt }) => ({
      id, company, netWorth, level, logo, color, updatedAt
    }));
}

loadPlayers();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (url.pathname === "/api/score") {
    if (req.method === "POST") {
      try {
        const b = await readJson(req);
        if (!b || !/^[a-f0-9]{32}$/.test(b.id) ||
            !/^[a-f0-9]{64}$/.test(b.token)) {
          return send(res, 400, { error: "Geçersiz lig kimliği." });
        }
        if (typeof b.company !== "string" || b.company.trim().length < 1) {
          return send(res, 400, { error: "Önce şirketine bir ad ver." });
        }

        const company = b.company.trim().slice(0, 24);
        const netWorth = Math.max(0, Math.min(1e15, Number(b.netWorth) || 0));
        const level = Math.max(1, Math.min(1000, Math.floor(Number(b.level) || 1)));
        const logo = Math.max(0, Math.floor(Number(b.logo) || 0));
        const color = /^#[0-9a-f]{6}$/i.test(b.color || "") ? b.color : "#17365d";

        const existing = players.get(b.id);
        if (existing && existing.token !== b.token) {
          return send(res, 403, { error: "Bu lig kaydı başka bir cihaz tarafından doğrulanıyor." });
        }

        players.set(b.id, {
          id: b.id,
          token: b.token,
          company,
          netWorth: Math.round(netWorth),
          level,
          logo,
          color,
          updatedAt: Date.now()
        });
        savePlayers();
        return send(res, 200, { ok: true });
      } catch (error) {
        return send(res, 400, { error: error.message || "Lig kaydı güncellenemedi." });
      }
    }

    if (req.method === "DELETE") {
      try {
        const b = await readJson(req);
        if (!b || !/^[a-f0-9]{32}$/.test(b.id) ||
            !/^[a-f0-9]{64}$/.test(b.token)) {
          return send(res, 400, { error: "Geçersiz lig kimliği." });
        }
        const player = players.get(b.id);
        if (!player || player.token !== b.token) {
          return send(res, 404, { error: "Lig kaydı bulunamadı." });
        }
        players.delete(b.id);
        savePlayers();
        return send(res, 200, { ok: true });
      } catch (error) {
        return send(res, 400, { error: error.message || "Ligden çıkılamadı." });
      }
    }

    res.setHeader("Allow", "POST, DELETE");
    return send(res, 405, { error: "Desteklenmeyen yöntem." });
  }

  if (url.pathname === "/api/leaderboard" && req.method === "GET") {
    const rows = rankRows();
    const top = rows.slice(0, 100);
    const id = url.searchParams.get("id");
    const index = id ? rows.findIndex((row) => row.id === id) : -1;
    const me = index >= 0 ? { ...rows[index], rank: index + 1 } : null;
    return send(res, 200, { top, total: rows.length, me });
  }

  if (url.pathname === "/api/health") {
    return send(res, 200, { ok: true, players: rankRows().length });
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    return send(res, 405, { error: "Yöntem desteklenmiyor." });
  }

  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.resolve(root, "." + requested);
  if (!filePath.startsWith(root + path.sep)) return send(res, 403, { error: "Yasak." });

  fs.readFile(filePath, (error, content) => {
    if (error) return send(res, 404, { error: "Sayfa bulunamadı." });
    const ext = path.extname(filePath);
    const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8" };
    res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream", "Cache-Control": "no-cache" });
    if (req.method === "HEAD") res.end();
    else res.end(content);
  });
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Mini Müteahhit lig sunucusu http://0.0.0.0:${port}`);
});
