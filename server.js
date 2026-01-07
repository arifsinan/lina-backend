import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();

/* ============================
   🔥 GLOBAL CRASH LOGS
============================ */
process.on("uncaughtException", (err) => {
  console.error("🔥 UNCAUGHT EXCEPTION:", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("🔥 UNHANDLED REJECTION:", reason);
});

/* ============================
   APP INIT
============================ */
const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

console.log("🟢 SERVER BOOT");
console.log("🔑 OPENAI KEY VAR MI:", !!process.env.OPENAI_API_KEY);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/* ============================
   TEST ENDPOINT
============================ */
app.get("/health", (_, res) => {
  console.log("➡️ /health HIT");
  res.json({ ok: true });
});

/* ============================
   CHAT HANDLER (App ile UYUMLU)
   - /chat  ve /api/chat ikisi de çalışır
   - App: { messages, meta }
   - Eski: { message, characterId, clientKey }
============================ */
function normalizeMessages(body) {
  // Yeni format: { messages: [{role, content}...], meta: {...} }
  if (Array.isArray(body?.messages) && body.messages.length) {
    const msgs = body.messages
      .filter(
        (m) =>
          m &&
          (m.role === "system" || m.role === "user" || m.role === "assistant") &&
          typeof m.content === "string" &&
          m.content.trim().length
      )
      .slice(-20); // çok uzamasın
    if (msgs.length) return msgs;
  }

  // Eski format: { message, characterId }
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  const characterId =
    body?.characterId ||
    body?.meta?.id ||
    body?.meta?.characterId ||
    "unknown";

  if (!message) return null;

  return [
    { role: "system", content: `Sen ${characterId} karakterisin.` },
    { role: "user", content: message },
  ];
}

async function chatHandler(req, res) {
  console.log("➡️➡️➡️ CHAT HIT:", req.path);
  console.log("📩 RAW BODY:", req.body);

  try {
    const msgs = normalizeMessages(req.body);
    if (!msgs) throw new Error("MESSAGE_EMPTY");

    console.log("🤖 OpenAI CALL BAŞLIYOR");

    const result = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: msgs,
      temperature: 0.7,
      max_tokens: 220,
    });

    const reply = result?.choices?.[0]?.message?.content || "BOS CEVAP";
    console.log("✅ CHAT RESPONSE TEXT:", reply);

    return res.json({ ok: true, reply });
  } catch (err) {
    console.error("❌ CHAT ERROR CAUGHT:", err);
    console.error("❌ STACK:", err?.stack);

    return res.status(500).json({
      error: "CHAT_INTERNAL_ERROR",
      message: String(err),
    });
  }
}

app.post("/chat", chatHandler);
app.post("/api/chat", chatHandler);

/* ============================
   START
============================ */
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`🚀 BACKEND RUNNING: http://localhost:${PORT}`);
});
