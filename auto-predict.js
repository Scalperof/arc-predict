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

const COINGECKO_URL = "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd&include_24hr_change=true&include_7d_change=true";

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

async function fetchCryptoPrices() {
  try {
    const res = await fetch(COINGECKO_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ArcPredict/1.0)' },
      signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return {
      BTC: {
        price: data.bitcoin?.usd,
        change24h: data.bitcoin?.usd_24h_change?.toFixed(2),
        change7d: data.bitcoin?.usd_7d_change?.toFixed(2)
      },
      ETH: {
        price: data.ethereum?.usd,
        change24h: data.ethereum?.usd_24h_change?.toFixed(2),
        change7d: data.ethereum?.usd_7d_change?.toFixed(2)
      },
      SOL: {
        price: data.solana?.usd,
        change24h: data.solana?.usd_24h_change?.toFixed(2),
        change7d: data.solana?.usd_7d_change?.toFixed(2)
      }
    };
  } catch (err) {
    console.warn(`    [UYARI] CoinGecko verisi alinamadi: ${err.message}`);
    return null;
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

function formatCryptoContext(crypto) {
  if (!crypto) return '- (veri alinamadi)';
  const lines = [];
  for (const [coin, d] of Object.entries(crypto)) {
    if (d.price) {
      lines.push(`- ${coin}: $${d.price.toLocaleString('en-US')} (24s: ${d.change24h}%, 7g: ${d.change7d}%)`);
    }
  }
  return lines.join('\n') || '- (veri alinamadi)';
}

async function generateQuestions(news, crypto) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const cryptoSection = formatCryptoContext(crypto);

  const prompt = `Asagidaki haber ve kripto fiyat verilerine dayanarak tam olarak 10 adet Evet/Hayir tahmin sorusu uret:
- 2 siyaset tahmini
- 2 ekonomi tahmini
- 2 magazin tahmini
- 2 spor tahmini
- 2 kripto para tahmini

Kurallar:
- Her soru 48 saat icinde netlesebilir olmali
- Spesifik, olculebilir ve kisa olmali
- Kripto sorulari: mevcut fiyati referans alarak "X coin 48 saat icerisinde Y dolar seviyesini asacak mi?" formatinda olmali
- YALNIZCA 10 soruyu yaz, her biri yeni satirda, "1." "2." seklinde numarayla baslamali
- Baska hicbir aciklama veya metin ekleme

SIYASET HABERLERI:
${news.siyaset.map(t => `- ${t}`).join('\n') || '- (veri alinamadi)'}

EKONOMI HABERLERI:
${news.ekonomi.map(t => `- ${t}`).join('\n') || '- (veri alinamadi)'}

MAGAZIN HABERLERI:
${news.magazin.map(t => `- ${t}`).join('\n') || '- (veri alinamadi)'}

SPOR HABERLERI:
${news.spor.map(t => `- ${t}`).join('\n') || '- (veri alinamadi)'}

KRIPTO FIYATLARI (anlik):
${cryptoSection}`;

  const response = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 640,
    messages: [{ role: "user", content: prompt }]
  });

  const text = response.content.find(b => b.type === 'text')?.text?.trim() || '';
  return text
    .split('\n')
    .map(l => l.replace(/^\d+\.\s*/, '').trim())
    .filter(l => l.length > 10)
    .slice(0, 10);
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
    console.log("  1/3 RSS haberleri ve kripto fiyatlari cekiliyor...");
    const [news, crypto] = await Promise.all([fetchAllNews(), fetchCryptoPrices()]);
    console.log(`    Siyaset: ${news.siyaset.length}, Ekonomi: ${news.ekonomi.length}, Magazin: ${news.magazin.length}, Spor: ${news.spor.length} haber alindi.`);
    if (crypto) {
      console.log(`    Kripto: BTC=$${crypto.BTC?.price?.toLocaleString('en-US')} ETH=$${crypto.ETH?.price?.toLocaleString('en-US')} SOL=$${crypto.SOL?.price?.toLocaleString('en-US')}`);
    }

    if (!news.siyaset.length && !news.ekonomi.length && !news.magazin.length && !news.spor.length && !crypto) {
      console.log("  Hic veri alinamadi, atlandi.");
      return;
    }

    console.log("  2/3 Claude ile 10 tahmin sorusu uretiliyor...");
    const questions = await generateQuestions(news, crypto);
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
  console.log("Kaynaklar: BBC Turkce, NTV, Bloomberg HT, Dunya, Hurriyet Magazin, Milliyet Magazin, Hurriyet Spor, Sabah Spor, CoinGecko (BTC/ETH/SOL)");
  console.log("--------------------------------------");

  await runCycle();
  setInterval(runCycle, INTERVAL_MS);
}

main();
