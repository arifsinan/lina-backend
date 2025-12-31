import express from "express";
import cors from "cors";
import OpenAI from "openai";

const app = express();
app.use(cors());
app.use(express.json());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/chat", async (req, res) => {
  try {
    const { message, character = "lina" } = req.body;

    if (!message) {
      return res.status(400).json({ reply: "Mesaj bos olamaz." });
    }

    const systemPrompt = `
Sen kurgusal bir flort karakterisin.
Dogal, insan gibi, sicak ve akici konusursun.
Kisa cevaplar verirsin (1–3 cumle).
Ima + merak + yavaslik var.
Asla acik sacik konusma.
Asla kullaniciyi reddetme veya kilitleme.
Her mesaji sanki gercek bir sohbetteyimis gibi cevapla.
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.9,
      max_tokens: 150,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: message },
      ],
    });

    const reply =
      completion.choices[0]?.message?.content ||
      "Bir an durdum… sen devam etmek ister misin? 🙂";

    res.json({ reply });
  } catch (err) {
    console.error("OPENAI ERROR:", err);
    res.json({
      reply: "Bir anlik dalginlik oldu… tekrar yazar misin? 🤍",
    });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Backend calisiyor: ${PORT}`);
});
