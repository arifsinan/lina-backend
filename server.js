import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

process.on("uncaughtException", (err) => console.error("UNCAUGHT:", err));
process.on("unhandledRejection", (r) => console.error("UNHANDLED:", r));

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.get("/health", (_, res) => res.json({ ok: true }));

function normalizeMessages(body) {
  // Yeni App formatı: { messages: [...], meta: {...} }
  if (Array.isArray(body?.messages) && body.messages.length) {
    const cleaned = body.messages
      .filter(
        (m) =>
          m &&
          (m.role === "system" || m.role === "user" || m.role === "assistant") &&
          typeof m.content === "string" &&
          m.content.trim().length
      )
      .slice(-20);
    if (cleaned.length) return cleaned;
  }

  // Eski format: { message, characterId }
  const msg = typeof body?.message === "string" ? body.message.trim() : "";
  const characterId =
    body?.characterId || body?.meta?.id || body?.meta?.characterId || "unknown";

  if (!msg) return null;

  return [
    { role: "system", content: `Sen ${characterId} karakterisin.` },
    { role: "user", content: msg },
  ];
}

async function chatHandler(req, res) {
  try {
    console.log("CHAT HIT:", req.path);
    console.log("OPENAI KEY VAR MI:", !!process.env.OPENAI_API_KEY);

    const messages = normalizeMessages(req.body);
    if (!messages) return res.status(400).json({ error: "MESSAGE_EMPTY" });

    const result = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
      temperature: 0.7,
      max_tokens: 800,
    });

    const reply = result?.choices?.[0]?.message?.content?.trim() || "";
    return res.json({ ok: true, reply });
  } catch (e) {
    console.error("CHAT ERROR:", e);
    return res.status(500).json({ error: "CHAT_INTERNAL_ERROR", message: String(e) });
  }
}

app.post("/chat", chatHandler);
app.post("/api/chat", chatHandler);

// ✅ Render PORT fix
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`SERVER UP on ${PORT}`);
});
