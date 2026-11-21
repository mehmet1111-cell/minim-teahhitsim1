"use strict";

const fs = require("fs");
const path = require("path");

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const id = arg("--id");
const cash = arg("--cash");
const level = arg("--level");
const xp = arg("--xp");
let token = process.env.LEAGUE_ADMIN_TOKEN;
if (!token) {
  try {
    token = fs.readFileSync(path.join(__dirname, ".league-admin-token"), "utf8").trim();
  } catch (_) {}
}
const base = process.env.LEAGUE_URL || "http://127.0.0.1:3000";

if (!token) {
  console.error("LEAGUE_ADMIN_TOKEN tanımlı değil.");
  process.exit(1);
}
if (!/^[a-f0-9]{32}$/.test(id || "")) {
  console.error("Kullanım: npm run reward -- --id OYUNCU_ID --cash 1000000 --level 10 --xp 500");
  process.exit(1);
}
if (!cash && !level && !xp) {
  console.error("En az --cash, --level veya --xp gerekli.");
  process.exit(1);
}

fetch(base + "/api/admin/grant", {
  method: "POST",
  headers: {
    "Authorization": "Bearer " + token,
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    id,
    cash: cash === undefined ? 0 : Number(cash),
    level: level === undefined ? null : Number(level),
    xp: xp === undefined ? 0 : Number(xp)
  })
}).then(async (response) => {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "Ödül gönderilemedi.");
  console.log("Ödül kuyruğa gönderildi.");
  console.log(JSON.stringify(body.reward, null, 2));
}).catch((error) => {
  console.error(error.message);
  process.exit(1);
}