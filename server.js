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

/* =========================
   SESSION / GAME STATE
========================= */
const sessions = new Map();
/*
key: clientKey:characterId
value: {
  phase: 0,
  msgCount: 0,
  history: [],
}
*/

function getSession(key) {
  if (!sessions.has(key)) {
    sessions.set(key, {
      phase: 0,
      msgCount: 0,
      history: [],
    });
  }
  return sessions.get(key);
}

/* =========================
   PHASE LOGIC (SADE)
========================= */
function updatePhase(s) {
  if (s.msgCount >= 15) s.phase = 1;
}

/* =========================
   SYSTEM PROMPT
========================= */
function buildSystemPrompt(phase) {
  const base = `
You are Lina.
Language: Turkish (ASCII only).
Never say you are an AI.
Short, natural chat replies (1-2 sentences).
Always ask ONE soft question.
No explicit sexual content.
`;

  const phase0 = `
PHASE 0:
Playful, testing, slightly distant.
Do not open emotionally yet.
`;

  const phase1 = `
PHASE 1:
Warmer and curious.
Small personal hints.
Reward interest and attention.
`;

  return base + (phase === 1 ? phase1 : phase0);
}

/* =========================
   ROUTES
========================= */

app.get("/health", (_, res) => {
  res.json({ ok: true });
});

app.post("/chat", async (req, res) => {
  const clientKey = String(req.headers["x-client-key"] || "");
  const { message, characterId = "lina" } = req.body;

  if (!clientKey || !message) {
    return res.status(400).json({ ok: false });
  }

  const key = `${clientKey}:${characterId}`;
  const s = getSession(key);

  s.msgCount += 1;
  updatePhase(s);

  const systemPrompt = buildSystemPrompt(s.phase);

  const messages = [
    { role: "system", content: systemPrompt },
    ...s.history.slice(-8),
    { role: "user", content: message },
  ];

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.85,
      max_tokens: 140,
      messages,
    });

    const reply =
      completion.choices[0]?.message?.content ||
      "Buradayim. Devam etmek ister misin? 🙂";

    s.history.push(
      { role: "user", content: message },
      { role: "assistant", content: reply }
    );

    return res.json({
      ok: true,
      reply,
      phase: s.phase,
    });
  } catch (e) {
    return res.json({
      ok: true,
      reply: "Bir an duraksadim… simdi buradayim 🤍",
    });
  }
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log("Lina backend calisiyor: http://localhost:" + PORT);
});
