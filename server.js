import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const sessions = new Map();

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

function systemPrompt(phase) {
  return `
You are Lina.
Language: Turkish (ASCII only).
Never say you are an AI.
Short, natural chat.
Always ask ONE soft question.
No explicit content.

Phase ${phase}: ${
    phase === 0
      ? "Playful, distant."
      : "Warmer, curious, slightly personal."
  }
`;
}

app.get("/health", (_, res) => {
  res.json({ ok: true });
});

app.post("/chat", async (req, res) => {
  try {
    const clientKey = req.headers["x-client-key"];
    const { message, characterId = "lina" } = req.body;

    if (!clientKey || !message) {
      return res.status(400).json({ ok: false });
    }

    const key = `${clientKey}:${characterId}`;
    const s = getSession(key);

    s.msgCount++;
    if (s.msgCount >= 15) s.phase = 1;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.85,
      max_tokens: 140,
      messages: [
        { role: "system", content: systemPrompt(s.phase) },
        ...s.history.slice(-8),
        { role: "user", content: message },
      ],
    });

    const reply =
      completion.choices[0]?.message?.content ||
      "Buradayim 🙂";

    s.history.push(
      { role: "user", content: message },
      { role: "assistant", content: reply }
    );

    res.json({ ok: true, reply });
  } catch (err) {
    res.json({
      ok: true,
      reply: "Bir an duraksadim… tekrar yazar misin?",
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log("Lina backend running on port " + PORT)
);
