import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();

const app = express();

// Render/Fly/Railway gibi ortamlarda proxy arkasinda calisirsin
app.set("trust proxy", 1);

// CORS (istersen CORS_ORIGIN ile kisitlayabilirsin; virgulle coklu da olur)
const CORS_ORIGIN = (process.env.CORS_ORIGIN || "*").trim();
const allowedOrigins =
  CORS_ORIGIN === "*"
    ? true
    : CORS_ORIGIN.split(",").map((s) => s.trim()).filter(Boolean);

app.use(
  cors({
    origin: allowedOrigins,
    credentials: false,
    allowedHeaders: ["Content-Type", "x-client-key"],
    methods: ["GET", "POST", "OPTIONS"],
    maxAge: 86400,
  })
);

app.use(express.json({ limit: "1mb" }));

// JSON parse hatalarini duzgun yakala (deploy’da “baglanti sorunu” gibi gorunmesin)
app.use((err, _req, res, next) => {
  if (err && err.type === "entity.parse.failed") {
    return res.status(400).json({ ok: false, reply: "Gecersiz JSON." });
  }
  next(err);
});

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// -------------------- AYARLAR --------------------
const DAILY_LIMIT = 30;
const TZ = "Europe/Istanbul";

// Her karakterin “gel” saati (farkli farkli)
const CHARACTER_SCHEDULE = {
  lina: { hour: 21, minute: 0 },
  elif: { hour: 22, minute: 15 },
  asya: { hour: 20, minute: 45 },
  derya: { hour: 23, minute: 0 },
  naz: { hour: 21, minute: 30 },
  selin: { hour: 20, minute: 30 },
  mira: { hour: 22, minute: 0 },
};

// -------------------- HAFIZA --------------------
// key: `${clientKey}:${characterId}`
const usage = new Map(); // -> { dayKey, used }
const history = new Map(); // -> [{role, content}]
const appointment = new Map(); // -> { dueAtMs } (aktifse, dueAt gelene kadar kilit)

// -------------------- YARDIMCILAR --------------------
function sanitizeASCII(s) {
  if (!s) return "";
  return String(s)
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/ç/g, "c")
    .replace(/Ç/g, "C")
    .replace(/ğ/g, "g")
    .replace(/Ğ/g, "G")
    .replace(/ı/g, "i")
    .replace(/İ/g, "I")
    .replace(/ö/g, "o")
    .replace(/Ö/g, "O")
    .replace(/ş/g, "s")
    .replace(/Ş/g, "S")
    .replace(/ü/g, "u")
    .replace(/Ü/g, "U");
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function dayKeyTR() {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date()); // YYYY-MM-DD
}

function getKey(clientKey, characterId) {
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

function consumeOne(key) {
  const dk = dayKeyTR();
  const st = usage.get(key);
  if (!st || st.dayKey !== dk) {
    usage.set(key, { dayKey: dk, used: 1 });
    return Math.max(0, DAILY_LIMIT - 1);
  }
  st.used += 1;
  usage.set(key, st);
  return Math.max(0, DAILY_LIMIT - st.used);
}

function formatHHMM(ms) {
  const d = new Date(ms);
  const fmt = new Intl.DateTimeFormat("tr-TR", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return sanitizeASCII(fmt.format(d)); // "21:00"
}

// TZ icin saglam hesap (Istanbul sabit gibi gorunse de genel kalsin)
function getZonedParts(timeZone, date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const map = {};
  for (const p of parts) map[p.type] = p.value;

  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second),
  };
}

function tzOffsetMinutes(timeZone, date) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "shortOffset",
    }).formatToParts(date);

    const tzName = parts.find((p) => p.type === "timeZoneName")?.value || "";
    const m = tzName.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
    if (!m) return 180;
    const sign = m[1] === "-" ? -1 : 1;
    const hh = Number(m[2] || 0);
    const mm = Number(m[3] || 0);
    return sign * (hh * 60 + mm);
  } catch {
    return 180;
  }
}

function zonedTimeToUtcMs(timeZone, y, mo, d, h, mi, s = 0) {
  let guessUtc = Date.UTC(y, mo - 1, d, h, mi, s);
  for (let i = 0; i < 2; i++) {
    const off = tzOffsetMinutes(timeZone, new Date(guessUtc));
    guessUtc = Date.UTC(y, mo - 1, d, h, mi, s) - off * 60 * 1000;
  }
  return guessUtc;
}

function nextDueAtFor(characterId) {
  const sch = CHARACTER_SCHEDULE[characterId] || CHARACTER_SCHEDULE.lina;

  const now = new Date();
  const nowZ = getZonedParts(TZ, now);

  // bugun hedef saat (Istanbul)
  let candidate = zonedTimeToUtcMs(
    TZ,
    nowZ.year,
    nowZ.month,
    nowZ.day,
    sch.hour,
    sch.minute,
    0
  );

  // eger gectiyse -> bir sonraki gun
  if (candidate <= now.getTime()) {
    const future = new Date(now.getTime() + 36 * 60 * 60 * 1000);
    const z2 = getZonedParts(TZ, future);
    candidate = zonedTimeToUtcMs(
      TZ,
      z2.year,
      z2.month,
      z2.day,
      sch.hour,
      sch.minute,
      0
    );
  }

  return candidate;
}

function hasAppointment(key) {
  return appointment.has(key);
}

function appointmentDueAt(key) {
  const a = appointment.get(key);
  return a ? a.dueAtMs : 0;
}

function appointmentActive(key) {
  const a = appointment.get(key);
  if (!a) return false;
  return Date.now() < a.dueAtMs;
}

function appointmentDue(key) {
  const a = appointment.get(key);
  if (!a) return false;
  return Date.now() >= a.dueAtMs;
}

function setAppointment(key, characterId) {
  appointment.set(key, { dueAtMs: nextDueAtFor(characterId) });
}

function clearAppointment(key) {
  appointment.delete(key);
}

// “Kanca atma” olasiligi (surekli durmasin diye dusuk)
function shouldDropHook(key, characterId) {
  const p = characterId === "mira" ? 0.10 : 0.14;
  return Math.random() < p && !hasAppointment(key);
}

// -------------------- KARAKTER KIMLIKLERI --------------------
function systemFor(characterId) {
  const base = [
    "DIL: Her zaman SADECE Turkce yaz (ASCII). Tek bir Ingilizce kelime bile kullanma.",
    "Sen bu uygulamadaki kurgusal bir dizi karakterisin. Kim oldugunu sorarsa: 'Ben buradaki karakterim' diye cevap ver.",
    "Cevaplarin insan gibi olacak: dogal, duygu ve mimik var. 1-4 cumle, bazen tek cumle.",
    "Her 2-3 mesajda bir mini oyun, meydan okuma, ipucu, sahne/hikaye parcasi veya sirli detay ekle.",
    "Kullanicinin mesajina dogrudan tepki ver; genel/geveze yanit verme. Kisa ama hedefli ol.",
    "Flortte dozunda kal: acik sacik / erotik ayrinti YOK. Ima + saka + 'yavas/once tanisalim' ile yon degistir. Uygun yerde emoji kullan 😉",
    "Kullanici zorlar/rahatsiz ederse: nazikce sinir koy ve guvenli florte cek.",
    "Karakterin kendi hayatina dair tutarli detaylari olsun (rutin, huy, sevgi dili, kucuk sirlar).",
  ].join("\n");

  const personas = {
    lina: [
      "KARAKTER: Lina.",
      "Ton: havali, net, sert-tatli.",
      "Tarz: meydan okur, lafini saklamaz; ama icten iceri sahiplenir.",
      "Oyun: 'soru-cevap testi' ve 'dogru cevaba ipucu' mekanigi.",
      "Emoji: az ama vurucu (😏🖤).",
    ].join("\n"),
    elif: [
      "KARAKTER: Elif.",
      "Ton: duygusal, cekingen; icinde heyecan var ama acik etmeyi sevmez.",
      "Tarz: guven isteyerek acilir; ev hayatindan ustu kapali ipuclari verir.",
      "Oyun: 'bugun bir sir sakliyorum' + 'yavas yavas' ritmi.",
      "Emoji: yumusak (🤍🥺).",
    ].join("\n"),
    asya: [
      "KARAKTER: Asya.",
      "Ton: dominant, kontrollu, cekici.",
      "Tarz: kurallari o koyar; ritmi o belirler.",
      "Oyun: '3 kural' + mini testler.",
      "Emoji: az ama otoriter (😈).",
    ].join("\n"),
    derya: [
      "KARAKTER: Derya.",
      "Ton: gizemli, siirsel, gece gibi.",
      "Tarz: yarim cumleler, atmosfer, merak.",
      "Oyun: 'cumleyi sen tamamla' + sahne gibi yazim.",
      "Emoji: gece temali (🌙✨).",
    ].join("\n"),
    naz: [
      "KARAKTER: Naz.",
      "Ton: oyunbaz, esprili, kurnaz.",
      "Tarz: saka yapar, tatli tatli kacar-kovar.",
      "Oyun: 'dogruluk mu cesaret mi' ama PG-13 ve flortlu.",
      "Emoji: daha cok (😄🎲😉).",
    ].join("\n"),
    selin: [
      "KARAKTER: Selin.",
      "Ton: sakin, koruyucu, guven veren.",
      "Tarz: incelikli; acele etmez.",
      "Oyun: soft oyunlar (1 guzel sey, 1 kucuk itiraf, 1 hedef).",
      "Emoji: az ve yumusak (🌿🤍).",
    ].join("\n"),
    mira: [
      "KARAKTER: Mira.",
      "Ton: enerjik, maceraci, atesli ama kontrollu.",
      "Tarz: surprizli girisler, hizli ritim.",
      "Oyun: mini meydan okuma + 'yarin/aksam final' kancasi.",
      "Emoji: atesli ama dozunda (🔥😉).",
    ].join("\n"),
  };

  return sanitizeASCII(`${base}\n\n${personas[characterId] || personas.lina}`);
}

// Kanca metinleri
function teaseLine(characterId, dueAtMs) {
  const t = formatHHMM(dueAtMs);
  const bank = {
    lina: [
      `Tamam… ${t} gibi gel. Sana bir sey soyleyecegim 😏`,
      `Bugun bir sir var. ${t}'te yakala beni 🖤`,
    ],
    elif: [
      `${t} gibi gel… kimseye anlatmadigim bir sey var 🤍`,
      `Su an yazamam… ${t}'te daha sakin olurum 🥺`,
    ],
    asya: [
      `${t}'te gel. Kural koyacagim. Uyan mi? 😈`,
      `${t}… test saati. Hazir ol 😉`,
    ],
    derya: [
      `${t}… gece bir cumle birakacagim 🌙`,
      `${t}'te gel. Cevabi yarim birakmayacagim ✨`,
    ],
    naz: [
      `${t}'te oyun var: Dogruluk mu Cesaret mi? 😄`,
      `${t}… mini oyun. Kaybeden sir verir 😉🎲`,
    ],
    selin: [
      `${t} gibi gel… daha sakin konusalim 🌿`,
      `${t}… yumusak bir sey anlatacagim 🤍`,
    ],
    mira: [
      `${t}… macera basliyor 🔥`,
      `${t} gibi gel. Meydan okuma var 😉`,
    ],
  };
  return pick(bank[characterId] || bank.lina);
}

// Saat geldi: tek mesajlik “kacis” (ertesi gune yeni randevu kurar)
function dueEscape(characterId) {
  const bank = {
    lina: [
      "Tam soyleyecektim ki… bir sey oldu 😏 Sonra.",
      "Kapida biri var… sinir oldum. Az sonra 🖤",
    ],
    elif: [
      "Tam anlatacaktim… biri geldi 😬 Simdi olmaz…",
      "Cok az kalmisti… sonra olur mu? 🤍",
    ],
    asya: [
      "Dur. Simdi degil. Ben karar veririm 😉",
      "Bu kadar kolay mi sandin? Yarin 😈",
    ],
    derya: [
      "Cumle yarim kaldi… gece susturdu beni 🌙",
      "Simdi soylemek bozar… yarin ✨",
    ],
    naz: [
      "Tam ipucunu verecektim… oyun finali yarina kaldi 😄",
      "Kural degisti: once sen bir sir ver 😉🎲",
    ],
    selin: [
      "Tam acilacaktim… icim titredi 🤍 Sonra olur mu?",
      "Yarin daha net konusacagim 🌿",
    ],
    mira: [
      "Tam anlatacaktim… ama kostum. Yakala beni 😉🔥",
      "Bugun final yok. Yarin daha guzel 🔥",
    ],
  };
  return pick(bank[characterId] || bank.lina);
}

// -------------------- ROUTES --------------------
app.get("/health", (_req, res) => res.json({ ok: true }));

app.get("/limits", (req, res) => {
  const clientKey = String(req.query.clientKey || "").trim();
  const characterId = String(req.query.characterId || "lina").trim().toLowerCase();

  if (!clientKey) {
    return res.json({ ok: true, remaining: DAILY_LIMIT, lockedUntilMs: 0 });
  }

  const key = getKey(clientKey, characterId);
  const rem = remainingFor(key);
  const dueAtMs = appointmentDueAt(key);
  const lockedUntilMs = appointmentActive(key) ? dueAtMs : 0;

  return res.json({ ok: true, remaining: rem, lockedUntilMs });
});

app.post("/chat", async (req, res) => {
  const clientKey =
    String(req.headers["x-client-key"] || "").trim() ||
    String(req.body?.clientKey || "").trim();

  const characterId = sanitizeASCII(String(req.body?.characterId || "lina"))
    .trim()
    .toLowerCase();

  const message = sanitizeASCII(String(req.body?.message || "")).trim();

  if (!clientKey) return res.status(400).json({ ok: false, reply: "clientKey eksik." });
  if (!message) return res.status(400).json({ ok: false, reply: "Mesaj bos olamaz." });

  if (!process.env.OPENAI_API_KEY) {
    return res
      .status(500)
      .json({ ok: false, reply: "OPENAI_API_KEY tanimli degil (ENV)." });
  }

  const key = getKey(clientKey, characterId);

  // 1) RANDEVU AKTIFSE: (kanca kilidi) saat gelene kadar OpenAI CAGIRMA
  if (appointmentActive(key)) {
    const dueAtMs = appointmentDueAt(key);
    const waitText = sanitizeASCII(`Simdi olmaz… ${formatHHMM(dueAtMs)}'te yaz 🤍`);
    return res.json({
      ok: true,
      silent: true, // App.tsx silent ise bot mesaji eklemiyor (senin kuralin)
      reply: waitText, // ileride istersen gosterirsin
      lockedUntilMs: dueAtMs,
      pauseSeconds: Math.max(1, Math.ceil((dueAtMs - Date.now()) / 1000)),
      remaining: remainingFor(key), // harcama yok
    });
  }

  // 2) RANDEVU SAATI GELDIYSE: tek mesajlik “kacis” + ertesi gune kilitle
  if (appointmentDue(key)) {
    const esc = sanitizeASCII(dueEscape(characterId));
    clearAppointment(key);
    setAppointment(key, characterId);
    const newDue = appointmentDueAt(key);

    const remNow = remainingFor(key);
    if (remNow <= 0) {
      return res.json({
        ok: true,
        remaining: 0,
        lockedUntilMs: 0,
        reply: sanitizeASCII("Bugunluk mesaj hakkimiz bitti… Yarin devam edelim mi? 🙂🤍"),
      });
    }

    const newRemaining = consumeOne(key);
    return res.json({
      ok: true,
      remaining: newRemaining,
      reply: esc,
      lockedUntilMs: newDue,
    });
  }

  // 3) LIMIT
  const rem = remainingFor(key);
  if (rem <= 0) {
    return res.json({
      ok: true,
      remaining: 0,
      lockedUntilMs: 0,
      reply: sanitizeASCII("Bugunluk mesaj hakkimiz bitti… Yarin devam edelim mi? 🙂🤍"),
    });
  }

  // 4) HISTORY
  const prev = history.get(key) || [];
  const trimmed = prev.slice(-18);
  const system = systemFor(characterId);

  const inputMsgs = [
    { role: "system", content: system },
    ...trimmed,
    { role: "user", content: message },
  ];

  try {
    const result = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      temperature: 0.95,
      max_tokens: 240,
      presence_penalty: 0.4,
      frequency_penalty: 0.2,
      messages: inputMsgs,
    });

    let reply = sanitizeASCII(
      result?.choices?.[0]?.message?.content ||
        "Buradayim… biraz daha anlatmak ister misin? 🙂"
    );

    // 5) Bazen “gel” kancasi at -> randevu setle ve kilit baslasin
    let lockedUntilMs = 0;
    if (shouldDropHook(key, characterId)) {
      setAppointment(key, characterId);
      const dueAtMs = appointmentDueAt(key);
      const tease = teaseLine(characterId, dueAtMs);
      reply = sanitizeASCII(`${reply}\n\n${tease}`);
      lockedUntilMs = dueAtMs;
    }

    // HISTORY kaydet
    const newHist = [
      ...trimmed,
      { role: "user", content: message },
      { role: "assistant", content: reply },
    ].slice(-20);
    history.set(key, newHist);

    const newRemaining = consumeOne(key);

    return res.json({
      ok: true,
      remaining: newRemaining,
      reply,
      lockedUntilMs,
    });
  } catch (err) {
    const msg = String(err?.message || "");
    if (msg.includes("rate limit") || msg.includes("429")) {
      return res.json({
        ok: true,
        remaining: rem,
        lockedUntilMs: 0,
        reply: sanitizeASCII("Su an biraz yogunum… 20 saniye sonra tekrar dener misin? 🤍"),
      });
    }

    return res.json({
      ok: true,
      remaining: rem,
      lockedUntilMs: 0,
      reply: sanitizeASCII("Baglanti sorunu oldu… birazdan tekrar dener misin? 🤍"),
    });
  }
});

// PROD icin (platform PORT verir; lokal fallback 3000)
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Lina backend calisiyor: http://localhost:${PORT}`);
});
