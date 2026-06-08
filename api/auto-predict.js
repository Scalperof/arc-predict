const Anthropic = require('@anthropic-ai/sdk');
const { ethers } = require('ethers');

const CONTRACT_ADDRESS = "0x564e247bB1faB36fa6b75DEfbB2DDbAa1B6cec45";
const ABI = [
  "function createPrediction(string question, uint256 deadline) external",
  "function predictionCount() view returns (uint256)"
];
const RPC_URL = "https://rpc.testnet.arc.network";

const RSS_SOURCES = {
  siyasi: [
    "https://feeds.bbci.co.uk/news/world/rss.xml",
    "https://www.hurriyet.com.tr/rss/anasayfa"
  ],
  futbol: [
    "https://www.theguardian.com/football/rss",
    "https://www.bbc.co.uk/sport/football/rss.xml"
  ],
  kripto: [
    "https://cointelegraph.com/rss",
    "https://www.aljazeera.com/xml/rss/all.xml"
  ]
};

function parseTitlesFromRSS(xml) {
  const titles = [];
  const itemRegex = /<item[\s\S]*?<\/item>/gi;
  const titleRegex = /<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i;
  for (const item of xml.match(itemRegex) || []) {
    const match = item.match(titleRegex);
    if (match) {
      const title = match[1]
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>').replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'").trim();
      if (title) titles.push(title);
    }
  }
  return titles.slice(0, 5);
}

async function fetchRSS(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ArcPredict/1.0)' },
      signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parseTitlesFromRSS(await res.text());
  } catch (err) {
    console.warn(`[WARN] ${url}: ${err.message}`);
    return [];
  }
}

async function fetchAllNews() {
  const [bbc, hurriyet, goal, bbcSport, cointelegraph, aljazeera] = await Promise.all([
    fetchRSS(RSS_SOURCES.siyasi[0]),
    fetchRSS(RSS_SOURCES.siyasi[1]),
    fetchRSS(RSS_SOURCES.futbol[0]),
    fetchRSS(RSS_SOURCES.futbol[1]),
    fetchRSS(RSS_SOURCES.kripto[0]),
    fetchRSS(RSS_SOURCES.kripto[1])
  ]);
  return {
    siyasi: [...bbc, ...hurriyet].slice(0, 10),
    futbol: [...goal, ...bbcSport].slice(0, 10),
    kripto: [...cointelegraph, ...aljazeera].slice(0, 10)
  };
}

async function generateQuestions(news) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const prompt = `Asagidaki haberlere dayanarak tam olarak 6 adet Evet/Hayir tahmin sorusu uret:
- 2 siyasi tahmin sorusu
- 2 futbol tahmini sorusu
- 2 kripto tahmini sorusu

Kurallar:
- Her soru 48 saat icinde netlesebilir olmali
- Spesifik, olculebilir ve kisa olmali
- YALNIZCA 6 soruyu yaz, her biri yeni satirda, "1." "2." seklinde numarayla baslamali
- Baska hicbir aciklama veya metin ekleme

SIYASI HABERLER:
${news.siyasi.map(t => `- ${t}`).join('\n') || '- (veri alinamadi)'}

FUTBOL HABERLERI:
${news.futbol.map(t => `- ${t}`).join('\n') || '- (veri alinamadi)'}

KRIPTO HABERLERI:
${news.kripto.map(t => `- ${t}`).join('\n') || '- (veri alinamadi)'}`;

  const response = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 512,
    messages: [{ role: "user", content: prompt }]
  });

  const text = response.content.find(b => b.type === 'text')?.text?.trim() || '';
  return text
    .split('\n')
    .map(l => l.replace(/^\d+\.\s*/, '').trim())
    .filter(l => l.length > 10)
    .slice(0, 6);
}

async function addPrediction(question, contract) {
  const deadline = Math.floor(Date.now() / 1000) + 48 * 60 * 60;
  const tx = await contract.createPrediction(question, deadline);
  await tx.wait();
  return tx.hash;
}

module.exports = async function handler(req, res) {
  // Sadece Vercel Cron veya yetkili isteklere izin ver
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers['authorization'];
    if (auth !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY eksik' });
  if (!process.env.PRIVATE_KEY) return res.status(500).json({ error: 'PRIVATE_KEY eksik' });

  const log = [];
  try {
    log.push('RSS kaynaklarindan haberler cekiliyor...');
    const news = await fetchAllNews();
    log.push(`Siyasi: ${news.siyasi.length}, Futbol: ${news.futbol.length}, Kripto: ${news.kripto.length}`);

    if (!news.siyasi.length && !news.futbol.length && !news.kripto.length) {
      return res.status(200).json({ ok: false, message: 'Haber alinamadi', log });
    }

    log.push('Claude ile 6 tahmin sorusu uretiliyor...');
    const questions = await generateQuestions(news);
    if (!questions.length) return res.status(200).json({ ok: false, message: 'Sorular uretilemedi', log });
    log.push(`${questions.length} soru uretildi`);

    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
    const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, wallet);

    const txHashes = [];
    for (const question of questions) {
      const hash = await addPrediction(question, contract);
      txHashes.push(hash);
      log.push(`Tx: ${hash} — ${question}`);
    }

    return res.status(200).json({ ok: true, created: txHashes.length, txHashes, log });
  } catch (err) {
    log.push(`Hata: ${err.message}`);
    return res.status(500).json({ ok: false, error: err.message, log });
  }
};
