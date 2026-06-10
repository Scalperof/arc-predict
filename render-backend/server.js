const express = require('express');
const cron = require('node-cron');
const Anthropic = require('@anthropic-ai/sdk');
const { ethers } = require('ethers');

const CONTRACT_ADDRESS    = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const WC_CONTRACT_ADDRESS = "0x24c2AD016280f847d49874Dd06635B4DFe85Ea6D";
const RPC_URL = "https://rpc.testnet.arc.network";

const PREDICT_ABI = [
  "function createPrediction(string question, uint256 deadline) external",
  "function predictionCount() view returns (uint256)"
];

const RESOLVE_ABI = [
  "function getPrediction(uint256 id) view returns (string question, uint256 deadline, bool resolved, bool result, uint256 totalYes, uint256 totalNo)",
  "function predictionCount() view returns (uint256)",
  "function resolvePrediction(uint256 predictionId, bool result) external"
];

const WC_RESOLVE_ABI = [
  "function matchCount() view returns (uint256)",
  "function getMatch(uint256 matchId) view returns (string homeTeam, string awayTeam, uint256 kickoff, bool resolved, uint8 result, uint256 poolHome, uint256 poolDraw, uint256 poolAway)",
  "function resolveMatch(uint256 matchId, uint8 result) external"
];

// ─── RSS / PREDICT ────────────────────────────────────────────────────────────

const RSS_SOURCES = {
  siyasi: ["https://feeds.bbci.co.uk/news/world/rss.xml", "https://www.hurriyet.com.tr/rss/anasayfa"],
  futbol: ["https://www.theguardian.com/football/rss", "https://www.bbc.co.uk/sport/football/rss.xml"],
  kripto: ["https://cointelegraph.com/rss", "https://www.aljazeera.com/xml/rss/all.xml"]
};

function parseTitlesFromRSS(xml) {
  const titles = [];
  const itemRegex = /<item[\s\S]*?<\/item>/gi;
  const titleRegex = /<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i;
  for (const item of xml.match(itemRegex) || []) {
    const m = item.match(titleRegex);
    if (m) {
      const t = m[1]
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>').replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'").trim();
      if (t) titles.push(t);
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
  const [bbc, hurriyet, guardian, bbcSport, cointelegraph, aljazeera] = await Promise.all([
    fetchRSS(RSS_SOURCES.siyasi[0]),
    fetchRSS(RSS_SOURCES.siyasi[1]),
    fetchRSS(RSS_SOURCES.futbol[0]),
    fetchRSS(RSS_SOURCES.futbol[1]),
    fetchRSS(RSS_SOURCES.kripto[0]),
    fetchRSS(RSS_SOURCES.kripto[1])
  ]);
  return {
    siyasi: [...bbc, ...hurriyet].slice(0, 10),
    futbol: [...guardian, ...bbcSport].slice(0, 10),
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

async function runAutoPredict() {
  const ts = new Date().toISOString();
  console.log(`\n[${ts}] AUTO-PREDICT başlıyor...`);
  try {
    const news = await fetchAllNews();
    console.log(`  Haberler: siyasi=${news.siyasi.length} futbol=${news.futbol.length} kripto=${news.kripto.length}`);

    if (!news.siyasi.length && !news.futbol.length && !news.kripto.length) {
      console.log('  Haber alınamadı, atlandı.');
      return { ok: false, message: 'Haber alinamadi' };
    }

    const questions = await generateQuestions(news);
    if (!questions.length) {
      console.log('  Soru üretilemedi, atlandı.');
      return { ok: false, message: 'Sorular uretilemedi' };
    }
    console.log(`  ${questions.length} soru üretildi.`);

    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
    const contract = new ethers.Contract(CONTRACT_ADDRESS, PREDICT_ABI, wallet);

    const txHashes = [];
    for (const question of questions) {
      const deadline = Math.floor(Date.now() / 1000) + 48 * 60 * 60;
      const tx = await contract.createPrediction(question, deadline);
      await tx.wait();
      txHashes.push(tx.hash);
      console.log(`  Tx: ${tx.hash} — ${question}`);
    }

    console.log(`  AUTO-PREDICT tamamlandı: ${txHashes.length} tahmin eklendi.`);
    return { ok: true, created: txHashes.length, txHashes };
  } catch (err) {
    console.error(`  AUTO-PREDICT hata: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

// ─── RESOLVE ──────────────────────────────────────────────────────────────────

const FOOTBALL_KEYWORDS = [
  'futbol', 'maç', 'gol', 'şampiyon', 'lig', 'takım', 'teknik direktör',
  'mourinho', 'bellingham', 'ronaldo', 'messi', 'premier league', 'la liga',
  'bundesliga', 'serie a', 'champions league', 'uefa', 'fifa', 'real madrid',
  'barcelona', 'chelsea', 'liverpool', 'manchester', 'arsenal', 'juventus',
  'milan', 'inter', 'psg', 'oynayacak', 'başlayacak', 'kazanacak', 'soccer',
  'football', 'squad', 'lineup', 'goal', 'match', 'coach', 'player'
];

const CRYPTO_KEYWORDS = [
  'bitcoin', 'btc', 'ethereum', 'eth', 'kripto', 'crypto', 'coin', 'token',
  'dolar', 'usd', 'fiyat', 'zcash', 'zec', 'solana', 'sol', 'cardano', 'ada',
  'binance', 'bnb', 'xrp', 'ripple', 'dogecoin', 'doge', 'polygon', 'matic',
  'avalanche', 'avax', 'chainlink', 'link', 'defi', 'blockchain', 'altcoin'
];

const COIN_MAP = {
  'bitcoin': 'bitcoin', 'btc': 'bitcoin', 'ethereum': 'ethereum', 'eth': 'ethereum',
  'zcash': 'zcash', 'zec': 'zcash', 'solana': 'solana', 'sol': 'solana',
  'cardano': 'cardano', 'ada': 'cardano', 'binance': 'binancecoin', 'bnb': 'binancecoin',
  'xrp': 'ripple', 'ripple': 'ripple', 'dogecoin': 'dogecoin', 'doge': 'dogecoin',
  'polygon': 'matic-network', 'matic': 'matic-network', 'avalanche': 'avalanche-2',
  'avax': 'avalanche-2', 'chainlink': 'chainlink', 'link': 'chainlink'
};

function categorize(question) {
  const q = question.toLowerCase();
  const fScore = FOOTBALL_KEYWORDS.filter(k => q.includes(k)).length;
  const cScore = CRYPTO_KEYWORDS.filter(k => q.includes(k)).length;
  if (fScore > cScore && fScore > 0) return 'futbol';
  if (cScore > 0) return 'kripto';
  return 'siyasi';
}

async function fetchFootballFixtures() {
  const fixtures = [];
  const today = new Date();
  for (const offset of [-3, -2, -1, 0, 1]) {
    const d = new Date(today);
    d.setDate(d.getDate() + offset);
    const dateStr = d.toISOString().split('T')[0];
    try {
      const res = await fetch(`https://v3.football.api-sports.io/fixtures?date=${dateStr}`, {
        headers: { 'x-apisports-key': process.env.API_FOOTBALL_KEY },
        signal: AbortSignal.timeout(10000)
      });
      if (!res.ok) continue;
      const data = await res.json();
      fixtures.push(...(data.response || []));
    } catch { /* devam */ }
  }
  return fixtures;
}

async function resolveFootball(question, fixtures, client) {
  const fixtureText = fixtures.slice(0, 40).map(f => {
    const status = f.fixture?.status?.short;
    const finished = ['FT', 'AET', 'PEN'].includes(status);
    return `${f.teams?.home?.name} vs ${f.teams?.away?.name} | ${finished ? `Sonuc: ${f.goals?.home}-${f.goals?.away}` : `Durum: ${status}`} | ${f.fixture?.date?.split('T')[0]}`;
  }).join('\n');

  const response = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 16,
    messages: [{ role: "user", content: `Mac verilerine gore:\n\nSoru: "${question}"\n\n${fixtureText}\n\nSADECE "EVET", "HAYIR" veya "BELIRSIZ" yaz.` }]
  });

  const answer = response.content.find(b => b.type === 'text')?.text?.trim().toUpperCase();
  if (answer?.includes('EVET')) return true;
  if (answer?.includes('HAYIR')) return false;
  return null;
}

function detectCoin(question) {
  const q = question.toLowerCase();
  for (const [kw, id] of Object.entries(COIN_MAP)) {
    if (q.includes(kw)) return id;
  }
  return null;
}

function extractThreshold(question) {
  const q = question.toLowerCase();
  const nums = q.match(/[\d]{1,3}(?:[.,\s]\d{3})*(?:[.,]\d+)?/g);
  if (!nums) return null;
  const raw = nums[nums.length - 1].replace(/\s/g, '').replace(/\.(?=\d{3})/g, '').replace(',', '.');
  const value = parseFloat(raw);
  if (isNaN(value)) return null;
  const over = q.includes('üzerine') || q.includes('üstüne') || q.includes('aşacak') || q.includes('geçecek');
  return { value, direction: over ? 'over' : 'under' };
}

async function resolveCrypto(question) {
  const coinId = detectCoin(question);
  if (!coinId) return null;
  const threshold = extractThreshold(question);
  if (!threshold) return null;
  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd`,
      { signal: AbortSignal.timeout(10000) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const price = data[coinId]?.usd;
    if (!price) return null;
    console.log(`    CoinGecko: ${coinId} = $${price.toLocaleString()} | eşik: ${threshold.direction === 'over' ? '>' : '<'} $${threshold.value}`);
    return threshold.direction === 'over' ? price > threshold.value : price < threshold.value;
  } catch { return null; }
}

async function fetchGoogleNews(question) {
  const keywords = question.replace(/[?'"()]/g, '').split(/\s+/).filter(w => w.length > 4).slice(0, 5).join(' ');
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(keywords)}&hl=tr&gl=TR&ceid=TR:tr`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ArcPredict/1.0)' },
      signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) return [];
    return parseTitlesFromRSS(await res.text());
  } catch { return []; }
}

async function resolveWithClaude(question, headlines, client) {
  if (!headlines.length) return null;
  const response = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 16,
    messages: [{ role: "user", content: `Haberlere gore:\n\nSoru: "${question}"\n\n${headlines.map(h => `- ${h}`).join('\n')}\n\nSADECE "EVET", "HAYIR" veya "BELIRSIZ" yaz.` }]
  });
  const answer = response.content.find(b => b.type === 'text')?.text?.trim().toUpperCase();
  if (answer?.includes('EVET')) return true;
  if (answer?.includes('HAYIR')) return false;
  return null;
}

async function runAutoResolve() {
  const ts = new Date().toISOString();
  console.log(`\n[${ts}] AUTO-RESOLVE başlıyor...`);
  try {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
    const contract = new ethers.Contract(CONTRACT_ADDRESS, RESOLVE_ABI, wallet);
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const total = Number(await contract.predictionCount());
    const now = Math.floor(Date.now() / 1000);
    console.log(`  Toplam tahmin: ${total}`);

    let fixtures = [];
    if (process.env.API_FOOTBALL_KEY) {
      fixtures = await fetchFootballFixtures();
      console.log(`  ${fixtures.length} maç verisi alındı.`);
    }

    let resolved = 0, skipped = 0, errors = 0;

    for (let id = 0; id < total; id++) {
      const [question, deadline, isResolved] = await contract.getPrediction(id);
      if (isResolved || Number(deadline) > now) { skipped++; continue; }

      const category = categorize(question);
      console.log(`  [${id}] [${category}] ${question}`);
      let result = null;

      if (category === 'futbol') {
        if (fixtures.length) result = await resolveFootball(question, fixtures, client);
        if (result === null) result = await resolveWithClaude(question, await fetchGoogleNews(question), client);
      } else if (category === 'kripto') {
        result = await resolveCrypto(question);
        if (result === null) result = await resolveWithClaude(question, await fetchGoogleNews(question), client);
      } else {
        result = await resolveWithClaude(question, await fetchGoogleNews(question), client);
      }

      if (result === null) { skipped++; continue; }

      try {
        const tx = await contract.resolvePrediction(id, result);
        await tx.wait();
        console.log(`  [${id}] ${result ? 'EVET' : 'HAYIR'} — Tx: ${tx.hash}`);
        resolved++;
      } catch (err) {
        console.error(`  [${id}] Hata: ${err.message}`);
        errors++;
      }
    }

    console.log(`  AUTO-RESOLVE tamamlandı: ${resolved} çözüldü | ${skipped} atlandı | ${errors} hata`);
    return { ok: true, resolved, skipped, errors };
  } catch (err) {
    console.error(`  AUTO-RESOLVE hata: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

// ─── WC AUTO-RESOLVE ─────────────────────────────────────────────────────────

function normalizeTeam(name) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
}

function teamsMatch(a, b) {
  const na = normalizeTeam(a), nb = normalizeTeam(b);
  return na === nb || na.startsWith(nb.slice(0, 4)) || nb.startsWith(na.slice(0, 4));
}

async function fetchWCFixtures() {
  const fixtures = [];
  const today = new Date();
  for (const offset of [-7, -6, -5, -4, -3, -2, -1, 0]) {
    const d = new Date(today);
    d.setDate(d.getDate() + offset);
    const dateStr = d.toISOString().split('T')[0];
    try {
      const res = await fetch(
        `https://v3.football.api-sports.io/fixtures?league=1&season=2026&date=${dateStr}`,
        { headers: { 'x-apisports-key': process.env.API_FOOTBALL_KEY }, signal: AbortSignal.timeout(10000) }
      );
      if (!res.ok) continue;
      const data = await res.json();
      fixtures.push(...(data.response || []));
    } catch { /* devam */ }
  }
  return fixtures;
}

async function runAutoResolveWC() {
  const ts = new Date().toISOString();
  console.log(`\n[${ts}] WC AUTO-RESOLVE başlıyor...`);
  if (!process.env.API_FOOTBALL_KEY) { console.log('  API_FOOTBALL_KEY yok, atlandı.'); return; }
  try {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
    const contract = new ethers.Contract(WC_CONTRACT_ADDRESS, WC_RESOLVE_ABI, wallet);

    const count = Number(await contract.matchCount());
    const now = Math.floor(Date.now() / 1000);
    const matches = await Promise.all(
      Array.from({ length: count }, async (_, i) => {
        const m = await contract.getMatch(i);
        return { id: i, homeTeam: m[0], awayTeam: m[1], kickoff: Number(m[2]), resolved: m[3] };
      })
    );
    const pending = matches.filter(m => !m.resolved && m.kickoff <= now);
    console.log(`  Cozum bekleyen WC mac: ${pending.length}`);
    if (!pending.length) return;

    const fixtures = await fetchWCFixtures();
    console.log(`  ${fixtures.length} fixture alindi`);
    let resolved = 0, skipped = 0;

    for (const m of pending) {
      const fixture = fixtures.find(f =>
        teamsMatch(m.homeTeam, f.teams?.home?.name || '') &&
        teamsMatch(m.awayTeam, f.teams?.away?.name || '')
      );
      if (!fixture) { console.log(`  [${m.id}] Fixture yok: ${m.homeTeam} vs ${m.awayTeam}`); skipped++; continue; }
      const status = fixture.fixture?.status?.short;
      if (!['FT', 'AET', 'PEN'].includes(status)) { console.log(`  [${m.id}] Bitmedi (${status})`); skipped++; continue; }
      const hg = fixture.goals?.home ?? 0, ag = fixture.goals?.away ?? 0;
      const result = hg > ag ? 0 : hg === ag ? 1 : 2;
      const labels = ['Ev Sahibi', 'Beraberlik', 'Deplasman'];
      try {
        const tx = await contract.resolveMatch(m.id, result);
        await tx.wait();
        console.log(`  [${m.id}] ${m.homeTeam} ${hg}-${ag} ${m.awayTeam} → ${labels[result]} | ${tx.hash}`);
        resolved++;
      } catch (err) { console.error(`  [${m.id}] Hata: ${err.message}`); skipped++; }
    }
    console.log(`  WC AUTO-RESOLVE tamamlandi: ${resolved} cozumlendi, ${skipped} atlandi.`);
  } catch (err) {
    console.error(`  WC AUTO-RESOLVE hata: ${err.message}`);
  }
}

// ─── EXPRESS + CRON ───────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

app.use((_req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

app.get('/health', (_req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// Manuel tetikleme endpointleri (test için)
app.post('/run/predict', async (_req, res) => {
  const result = await runAutoPredict();
  res.json(result);
});

app.post('/run/resolve', async (_req, res) => {
  const result = await runAutoResolve();
  res.json(result);
});

app.post('/run/resolve-wc', async (_req, res) => {
  await runAutoResolveWC();
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Arc Predict Backend — port ${PORT}`);
  console.log('Contract:', CONTRACT_ADDRESS);
  console.log('Schedule: auto-predict her 4 saatte bir | auto-resolve her saatte bir');
  console.log('--------------------------------------');
});

// Her 4 saatte bir: dakika 0, saat 0/4/8/12/16/20
cron.schedule('0 */4 * * *', () => {
  runAutoPredict().catch(err => console.error('Cron predict hata:', err.message));
});

// Her saatte bir: dakika 0
cron.schedule('0 * * * *', () => {
  runAutoResolve().catch(err => console.error('Cron resolve hata:', err.message));
});

// WC resolve: her 30 dakikada bir
cron.schedule('*/30 * * * *', () => {
  runAutoResolveWC().catch(err => console.error('Cron WC resolve hata:', err.message));
});

// İlk açılışta hemen çalıştır
setTimeout(() => runAutoPredict(), 5000);
setTimeout(() => runAutoResolve(), 15000);
setTimeout(() => runAutoResolveWC(), 25000);
