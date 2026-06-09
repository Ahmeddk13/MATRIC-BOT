import { readFileSync, writeFileSync, existsSync } from "fs";

const BOT_TOKEN = "8617922374:AAG_CD5GeRHcbLvBKyhgd-Fke8g_Z4I0bDQ";
const ALLOWED_CHAT_ID = "5806630118";
const TG_API = "https://api.telegram.org/bot" + BOT_TOKEN;
const OPENCODE_API = "http://127.0.0.1:4096";
const OFFSET_FILE = "/tmp/tg_offset.txt";
const POLL_INTERVAL = 2000;

let offset = 0;
if (existsSync(OFFSET_FILE)) {
  offset = parseInt(readFileSync(OFFSET_FILE, "utf-8").trim()) || 0;
}

const headers = { "Content-Type": "application/json" };

function tg(method, payload) {
  return fetch(TG_API + "/" + method, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  }).then((r) => r.json());
}

function sendMsg(chatId, text) {
  return tg("sendMessage", {
    chat_id: chatId,
    text: text.substring(0, 4096),
    parse_mode: "Markdown",
  });
}

async function createSession() {
  const r = await fetch(OPENCODE_API + "/session", {
    method: "POST",
    headers,
    body: JSON.stringify({}),
  });
  const data = await r.json();
  return data.id;
}

async function askOpencode(prompt) {
  try {
    const sessionId = await createSession();
    const r = await fetch(OPENCODE_API + "/session/" + sessionId + "/message", {
      method: "POST",
      headers,
      body: JSON.stringify({
        parts: [{ type: "text", text: prompt }],
      }),
    });
    const data = await r.json();
    const textParts = (data.parts || []).filter((p) => p.type === "text");
    return textParts.map((p) => p.text).join("\n").trim() || "(no response)";
  } catch (e) {
    return "(error: " + e.message + ")";
  }
}

async function poll() {
  const data = await tg("getUpdates", {
    offset: offset + 1,
    timeout: 30,
    allowed_updates: ["message"],
  });

  if (!data.ok || !data.result) return;

  for (const upd of data.result) {
    offset = upd.update_id;
    writeFileSync(OFFSET_FILE, String(offset));

    const msg = upd.message;
    if (!msg || !msg.text) continue;
    if (String(msg.chat.id) !== ALLOWED_CHAT_ID) continue;

    const user = msg.from?.first_name || "User";
    const text = msg.text;

    await sendMsg(msg.chat.id, `⏳ Processing...`);
    const result = await askOpencode(text);
    await sendMsg(msg.chat.id, `*${user}:* ${text}\n\n${result}`);
  }
}

console.log("🤖 Telegram-opencode bridge started (chat: " + ALLOWED_CHAT_ID + ")");
setInterval(poll, POLL_INTERVAL);
poll();

process.on("SIGINT", () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
