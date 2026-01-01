import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// =======================
// AYARLAR
// =======================
const DAILY_LIMIT = 30;
const TZ = "Europe/Istanbul";
const PORT = process.env.PORT || 3000;

// key: clientKey:characterId
const usage = new Map();
const history = new Map();
const hookState = new Map();

// =======================
// ZAMAN / LIMIT
// =======================
function dayKeyTR() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function keyOf(clientKey, characterId) {
  return `${clientKey}:${characterId}`;
}

function remainingFor(key) {
  const dk = dayKeyTR();
  const st = usage.get(key);
  if (!st || st.dayKey !== dk) {
    usage.set(key, { dayKey: dk, used: 0 });
    return DAILY_LIMIT;
  }
  return Math.max(0, DAILY_LIMIT - st.used);
}

function consume(key) {
  const dk = dayKeyTR();
  const st = usage.get(key) || { dayKey: dk, used: 0 };
  st.used += 1;
  usage.set(key, st);
  return Math.max(0, DAILY_LIMIT - st.used);
}

// =======================
// HOOK SISTEMI
// =======================
function nextDue(hour = 21, minute = 0) {
  const now = new Date();
  const d = new Date(now);
  d.setHours(hour, minute, 0, 0);
  if (d <= now) d.setDate(d.getDate() + 1);
  return d.getTime();
}

function setHook(key) {
  hookState.set(key, { dueAt: nextDue() });
}
function hookLocked(key) {
  const s = hookState.get(key);
  return s && Date.now() < s.dueAt;
}
function hookDue(key) {
  const s = hookState.get(key);
  return s && Date.now() >= s.dueAt;
}
function hookTime(key) {
  return hookState.get(key)?.dueAt || 0;
}
function clearHook(key) {
  hookState.delete(key);
}

// =======================
// ASCII TR
// =======================
function toAsciiTR(s) {
  return String(s || "")
    .replaceAll("ş", "s").replaceAll("Ş", "S")
    .replaceAll("ğ", "g").replaceAll("Ğ", "G")
    .replaceAll("ü", "u").replaceAll("Ü", "U")
    .replaceAll("ö", "o").replaceAll("Ö", "O")
    .replaceAll("ç", "c").replaceAll("Ç", "C")
    .replaceAll("ı", "i").replaceAll("İ", "I");
}

// =======================
// KARAKTERLER
// =======================
const CHARACTER_SYSTEM = {
  naz: "Sen Nazsin. Oyunbaz, flortoz, kurnaz. Turkce ASCII konus.",
  lina: "Sen Lina'sin. Net, havali, hafif meydan okur. Turkce ASCII konus.",
  elif: "Sen Elif'sin. Duygusal, icten. Turkce ASCII konus.",
  asya: "Sen Asya'sin. Dominant, kontrollu. Turkce ASCII konus.",
  derya: "Sen Derya'sin. Gizemli, siirsel. Turkce ASCII konus.",
  selin: "Sen Selin'sin. Sakin, guven veren. Turkce ASCII konus.",
  mira: "Sen Mira'sin. Enerjik, maceraci. Turkce ASCII konus.",
};

// =======================
// ENDPOINTS
// =======================
app.get("/health", (_, res) => res.json({ ok: true }));

app.get("/limits", (req, res) => {
  const clientKey = String(req.query.clientKey || "");
  const characterId = String(req.query.characterId || "lina");
  if (!clientKey) {
    return res.json({ remaining: DAILY_LIMIT, lockUntilMs: 0 });
  }
  const key = keyOf(clientKey, characterId);
  return res.json({
    remaining: remainingFor(key),
    lockUntilMs: hookLocked(key) ? hookTime(key) : 0,
  });
});

app.post("/chat", async (req, res) => {
  const clientKey = String(req.headers["x-client-key"] || "");
  const { message, characterId = "lina" } = req.body;

  if (!clientKey || !message) {
    return res.json({ reply: "Bir seyler eksik 🤍" });
  }

  const key = keyOf(clientKey, characterId);

  if (hookLocked(key)) {
    return res.json({
      silent: true,
      remaining: remainingFor(key),
      lockUntilMs: hookTime(key),
    });
  }

  if (hookDue(key)) {
    clearHook(key);
    consume(key);
    return res.json({
      reply: "Geldin… bekliyordum 🤍",
      remaining: remainingFor(key),
      lockUntilMs: 0,
    });
  }

  if (remainingFor(key) <= 0) {
    return res.json({
      reply: "Bugunluk bu kadar… yarin devam edelim mi? 🙂",
      remaining: 0,
    });
  }

  const prev = history.get(key) || [];
  const system = CHARACTER_SYSTEM[characterId] || CHARACTER_SYSTEM.lina;

  const result = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.85,
    messages: [
      { role: "system", content: system },
      ...prev.slice(-10),
      { role: "user", content: message },
    ],
  });

  let reply = toAsciiTR(result.choices[0].message.content);

  if (Math.random() < 0.12) {
    setHook(key);
    reply += "\n\nAksam 21:00 gibi gel… bir sey anlatacagim 🤍";
  }

  history.set(key, [...prev, { role: "user", content: message }, { role: "assistant", content: reply }]);
  const remaining = consume(key);

  res.json({ reply, remaining, lockUntilMs: hookLocked(key) ? hookTime(key) : 0 });
});

app.listen(PORT, () =>
  console.log(`Lina backend calisiyor : http://localhost:${PORT}`)
);
