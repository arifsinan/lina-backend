import express from "express";
import cors from "cors";
import fetch from "node-fetch";

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json()); // ❗ ÇOK ÖNEMLİ

// Sağlık kontrolü
app.get("/", (req, res) => {
  res.send("Lina backend calisiyor");
});

// 🔥 CHAT ENDPOINT (EKSİK OLAN BUYDU)
app.post("/chat", async (req, res) => {
  try {
    const {
      message,
      characterId,
      systemPrompt,
      context
    } = req.body;

    if (!message || !characterId) {
      return res.status(400).json({ reply: "Mesaj alinmadi." });
    }

    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt || "You are a friendly chat character." },
          ...(context?.recentMessages || []),
          { role: "user", content: message }
        ],
        temperature: 0.9
      })
    });

    const data = await openaiRes.json();

    const reply =
      data?.choices?.[0]?.message?.content ||
      "Bir an duraksadim… tekrar yazar misin? 🤍";

    res.json({ reply });

  } catch (err) {
    console.error("CHAT ERROR:", err);
    res.status(500).json({
      reply: "Bir seyler ters gitti… birazdan tekrar deneyelim mi?"
    });
  }
});

app.listen(PORT, () => {
  console.log(`Lina backend calisiyor: http://localhost:${PORT}`);
});
