const Anthropic = require('@anthropic-ai/sdk');
const { ethers } = require('ethers');

const CONTRACT_ADDRESS = "0xad1BDA8570C867A43e427ae2f6a9721Ac1b89975";
const ABI = [
  "function getPrediction(uint256 id) view returns (string question, uint256 deadline, bool resolved, bool result, uint256 totalYes, uint256 totalNo)",
  "function predictionCount() view returns (uint256)",
  "function resolvePrediction(uint256 predictionId, bool result) external"
];
const RPC_URL = "https://rpc.testnet.arc.network";

const FOOTBALL_KEYWORDS = [
  'futbol', 'maç', 'gol', 'şampiyon', 'lig', 'takım', 'teknik direktör',
  'mourinho', 'bellingham', 'ronaldo', 'messi', 'premier league', 'la liga',
  'bundesliga', 'serie a', 'champions league', 'uefa', 'fifa', 'real madrid',
  'barcelona', 'chelsea', 'liverpool', 'manchester', 'arsenal', 'juventus',
  'milan', 'inter', 'psg', 'oynayacak', 'başlayacak', 'kazanacak', 'soccer',
  'football', 'squad', 'lineup', 'goal', 'match', 'coach', 'player', 'england',
  'costa rica', 'hazırlık maçı'
];

const CRYPTO_KEYWORDS = [
  'bitcoin', 'btc', 'ethereum', 'eth', 'kripto', 'crypto', 'coin', 'token',
  'dolar', 'usd', 'fiyat', 'zcash', 'zec', 'solana', 'sol', 'cardano', 'ada',
  'binance', 'bnb', 'xrp', 'ripple', 'dogecoin', 'doge', 'polygon', 'matic',
  'avalanche', 'avax', 'chainlink', 'link', 'defi', 'blockchain', 'altcoin',
  'securitize', 'galaxy', 'clarity act', 'nyse'
];

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
    const home = f.teams?.home?.name || '';
    const away = f.teams?.away?.name || '';
    const score = finished ? `Sonuc: ${f.goals?.home}-${f.goals?.away}` : `Durum: ${status}`;
    return `${home} vs ${away} | ${score} | ${f.fixture?.date?.split('T')[0]}`;
  }).join('\n');

  const response = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 16,
    messages: [{
      role: "user",
      content: `Asagidaki futbol mac verilerine gore su soruyu cevapla:\n\nSoru: "${question}"\n\nMac verileri:\n${fixtureText}\n\nSADECE "EVET", "HAYIR" veya "BELIRSIZ" yaz.`
    }]
  });

  const answer = response.content.find(b => b.type === 'text')?.text?.trim().toUpperCase();
  if (answer?.includes('EVET')) return true;
  if (answer?.includes('HAYIR')) return false;
  return null;
}

const COIN_MAP = {
  'bitcoin': 'bitcoin', 'btc': 'bitcoin',
  'ethereum': 'ethereum', 'eth': 'ethereum',
  'zcash': 'zcash', 'zec': 'zcash',
  'solana': 'solana', 'sol': 'solana',
  'cardano': 'cardano', 'ada': 'cardano',
  'binance': 'binancecoin', 'bnb': 'binancecoin',
  'xrp': 'ripple', 'ripple': 'ripple',
  'dogecoin': 'dogecoin', 'doge': 'dogecoin',
  'polygon': 'matic-network', 'matic': 'matic-network',
  'avalanche': 'avalanche-2', 'avax': 'avalanche-2',
  'chainlink': 'chainlink', 'link': 'chainlink'
};

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
    return threshold.direction === 'over' ? price > threshold.value : price < threshold.value;
  } catch { return null; }
}

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
  return titles.slice(0, 8);
}

async function fetchGoogleNews(question) {
  const keywords = question
    .replace(/[?'"()]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 4)
    .slice(0, 5)
    .join(' ');
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
    messages: [{
      role: "user",
      content: `Asagidaki guncel haber basliklarini inceleyerek su soruyu cevapla:\n\nSoru: "${question}"\n\nGuncel haberler:\n${headlines.map(h => `- ${h}`).join('\n')}\n\nSADECE "EVET", "HAYIR" veya "BELIRSIZ" yaz.`
    }]
  });
  const answer = response.content.find(b => b.type === 'text')?.text?.trim().toUpperCase();
  if (answer?.includes('EVET')) return true;
  if (answer?.includes('HAYIR')) return false;
  return null;
}

module.exports = async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers['authorization'] !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY eksik' });
  if (!process.env.PRIVATE_KEY) return res.status(500).json({ error: 'PRIVATE_KEY eksik' });

  const log = [];
  try {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
    const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, wallet);
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const total = Number(await contract.predictionCount());
    const now = Math.floor(Date.now() / 1000);
    log.push(`Toplam tahmin: ${total}`);

    let fixtures = [];
    if (process.env.API_FOOTBALL_KEY) {
      fixtures = await fetchFootballFixtures();
      log.push(`${fixtures.length} mac verisi alindi`);
    }

    let resolved = 0, skipped = 0, errors = 0;

    for (let id = 0; id < total; id++) {
      const [question, deadline, isResolved] = await contract.getPrediction(id);

      if (isResolved) { skipped++; continue; }
      if (Number(deadline) > now) { skipped++; continue; }

      const category = categorize(question);
      let result = null;

      if (category === 'futbol') {
        if (process.env.API_FOOTBALL_KEY) result = await resolveFootball(question, fixtures, client);
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
        log.push(`[${id}] ${result ? 'EVET' : 'HAYIR'} — Tx: ${tx.hash}`);
        resolved++;
      } catch (err) {
        log.push(`[${id}] Hata: ${err.message}`);
        errors++;
      }
    }

    return res.status(200).json({ ok: true, resolved, skipped, errors, log });
  } catch (err) {
    log.push(`Fatal: ${err.message}`);
    return res.status(500).json({ ok: false, error: err.message, log });
  }
};
