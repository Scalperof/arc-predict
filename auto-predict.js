require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const { ethers } = require('ethers');

const CONTRACT_ADDRESS = "0xad1BDA8570C867A43e427ae2f6a9721Ac1b89975";
const ABI = [
  "function createPrediction(string question, uint256 deadline) external",
  "function predictionCount() view returns (uint256)"
];
const RPC_URL = "https://rpc.testnet.arc.network";
const INTERVAL_MS = 4 * 60 * 60 * 1000;

const RSS_SOURCES = {
  siyaset: [
    "https://feeds.bbci.co.uk/turkce/rss.xml",
    "https://www.ntv.com.tr/turkiye.rss"
  ],
  ekonomi: [
    "https://www.bloomberght.com/rss",
    "https://www.dunya.com/rss"
  ],
  magazin: [
    "https://www.hurriyet.com.tr/rss/magazin",
    "https://www.milliyet.com.tr/rss/rssNew/magazin_rss.xml"
  ],
  spor: [
    "https://www.hurriyet.com.tr/rss/spor",
    "https://www.sabah.com.tr/rss/spor.xml"
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
    console.warn(`    [UYARI] ${url} alinamadi: ${err.message}`);
    return [];
  }
}

async function fetchAllNews() {
  const [bbcTr, ntv, bloomberght, dunya, hurriyetMag, milliyetMag, trtSpor, fanatik] = await Promise.all([
    fetchRSS(RSS_SOURCES.siyaset[0]),
    fetchRSS(RSS_SOURCES.siyaset[1]),
    fetchRSS(RSS_SOURCES.ekonomi[0]),
    fetchRSS(RSS_SOURCES.ekonomi[1]),
    fetchRSS(RSS_SOURCES.magazin[0]),
    fetchRSS(RSS_SOURCES.magazin[1]),
    fetchRSS(RSS_SOURCES.spor[0]),
    fetchRSS(RSS_SOURCES.spor[1])
  ]);

  return {
    siyaset: [...bbcTr, ...ntv].slice(0, 10),
    ekonomi: [...bloomberght, ...dunya].slice(0, 10),
    magazin: [...hurriyetMag, ...milliyetMag].slice(0, 10),
    spor: [...trtSpor, ...fanatik].slice(0, 10)
  };
}

async function generateQuestions(news) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const prompt = `Asagidaki haberlere dayanarak tam olarak 8 adet Evet/Hayir tahmin sorusu uret:
- 2 siyaset tahmini
- 2 ekonomi tahmini
- 2 magazin tahmini
- 2 spor tahmini

Kurallar:
- Her soru 48 saat icinde netlesebilir olmali
- Spesifik, olculebilir ve kisa olmali
- YALNIZCA 8 soruyu yaz, her biri yeni satirda, "1." "2." seklinde numarayla baslamali
- Baska hicbir aciklama veya metin ekleme

SIYASET HABERLERI:
${news.siyaset.map(t => `- ${t}`).join('\n') || '- (veri alinamadi)'}

EKONOMI HABERLERI:
${news.ekonomi.map(t => `- ${t}`).join('\n') || '- (veri alinamadi)'}

MAGAZIN HABERLERI:
${news.magazin.map(t => `- ${t}`).join('\n') || '- (veri alinamadi)'}

SPOR HABERLERI:
${news.spor.map(t => `- ${t}`).join('\n') || '- (veri alinamadi)'}`;

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
    .slice(0, 8);
}

async function addPrediction(question, contract) {
  const deadline = Math.floor(Date.now() / 1000) + 48 * 60 * 60;
  const tx = await contract.createPrediction(question, deadline);
  await tx.wait();
  return tx.hash;
}

async function runCycle() {
  console.log(`\n[${new Date().toISOString()}] Dongu baslatiliyor...`);
  try {
    console.log("  1/3 RSS kaynaklarindan haberler cekiliyor...");
    const news = await fetchAllNews();
    console.log(`    Siyaset: ${news.siyaset.length}, Ekonomi: ${news.ekonomi.length}, Magazin: ${news.magazin.length}, Spor: ${news.spor.length} haber alindi.`);

    if (!news.siyaset.length && !news.ekonomi.length && !news.magazin.length && !news.spor.length) {
      console.log("  Hic haber alinamadi, atlandi.");
      return;
    }

    console.log("  2/3 Claude ile 6 tahmin sorusu uretiliyor...");
    const questions = await generateQuestions(news);
    if (!questions.length) { console.log("  Sorular uretilemedi, atlandi."); return; }
    console.log(`  ${questions.length} soru uretildi:`);
    questions.forEach((q, i) => console.log(`    ${i + 1}. ${q}`));

    console.log("  3/3 Contract'a yaziliyor...");
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
    const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, wallet);

    for (let i = 0; i < questions.length; i++) {
      const txHash = await addPrediction(questions[i], contract);
      console.log(`    [${i + 1}/${questions.length}] Tx: ${txHash}`);
    }
    console.log("  Tum tahminler basariyla eklendi.");
  } catch (err) {
    console.error("  Hata:", err.message);
  }
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("HATA: ANTHROPIC_API_KEY .env dosyasinda tanimli degil!");
    process.exit(1);
  }
  if (!process.env.PRIVATE_KEY) {
    console.error("HATA: PRIVATE_KEY .env dosyasinda tanimli degil!");
    process.exit(1);
  }

  console.log("Arc Predict - Otomatik Tahmin Sistemi");
  console.log(`Contract: ${CONTRACT_ADDRESS}`);
  console.log("Interval: 4 saatte bir");
  console.log("Kaynaklar: BBC Turkce, NTV, Bloomberg HT, Dunya, Hurriyet Magazin, Milliyet Magazin, Hurriyet Spor, Sabah Spor");
  console.log("--------------------------------------");

  await runCycle();
  setInterval(runCycle, INTERVAL_MS);
}

main();
