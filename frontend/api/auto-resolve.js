'use strict';
const Anthropic = require('@anthropic-ai/sdk');
const { ethers } = require('ethers');

// ═══════════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════════
const CONTRACT_ADDRESS = '0xad1BDA8570C867A43e427ae2f6a9721Ac1b89975';
const ABI = [
  'function getPrediction(uint256 id) view returns (string question, uint256 deadline, bool resolved, bool result, uint256 totalYes, uint256 totalNo)',
  'function predictionCount() view returns (uint256)',
  'function resolvePrediction(uint256 predictionId, bool result) external',
];
const RPC_URL = 'https://rpc.testnet.arc.network';

// ═══════════════════════════════════════════════════════════════════
// CATEGORY DETECTION
// ═══════════════════════════════════════════════════════════════════
const CATEGORY_KEYWORDS = {
  kripto: [
    'bitcoin', 'btc', 'ethereum', 'eth', 'kripto', 'crypto', 'coin', 'token',
    'zcash', 'zec', 'solana', 'sol', 'cardano', 'ada', 'bnb', 'xrp', 'ripple',
    'dogecoin', 'doge', 'polygon', 'matic', 'avalanche', 'avax', 'chainlink',
    'link', 'defi', 'altcoin', 'usdt', 'blockchain',
    'dolar seviyesi', 'fiyat seviyesi', 'seviyesini aşacak', 'üzerinde kal',
  ],
  spor: [
    'futbol', 'maç', 'gol', 'şampiyon', 'lig', 'kazanacak', 'kaybedecek',
    'beraberlik', 'skor', 'basketbol', 'voleybol', 'tenis', 'golf', 'formula',
    'nba', 'champions league', 'premier league', 'la liga', 'bundesliga',
    'fifa', 'uefa', 'dünya kupası', 'world cup', 'milli maç', 'hazırlık maçı',
    'beşiktaş', 'galatasaray', 'fenerbahçe', 'trabzonspor', 'başakşehir',
    'real madrid', 'barcelona', 'chelsea', 'liverpool', 'manchester', 'arsenal',
    'milan', 'juventus', 'psg', 'nottingham',
    'serinin', 'çeyrek final', 'yarı final', 'finale', 'turnuva',
    'efeleri', 'rosmalen', 'wimbledon', 'roland garros', 'transfer açıkla',
  ],
  siyaset: [
    'seçim', 'cumhurbaşkan', 'hükümet', 'meclis', 'parti', 'muhalefet',
    'erdoğan', 'trump', 'biden', 'putin', 'macron', 'nato', 'ukrayna', 'rusya',
    'savaş', 'barış', 'anlaşma', 'yaptırım', 'bakan', 'başbakan',
    'g7', 'g20', 'savcı', 'mahkeme', 'dava', 'tutuklama', 'istifa',
    'kılıçdaroğlu', 'chp', 'akp', 'iyi parti', 'kurultay', 'disiplin',
    'müzakere', 'diplomatik', 'büyükelçi', 'gümrük kapısı', 'yasa', 'kanun',
    'referandum', 'veto', 'halkbank', 'dışişleri', 'ermenistan',
    'iran', 'hürmüz', 'askeri', 'saldırı', 'bombardıman',
  ],
  ekonomi: [
    'enflasyon', 'faiz', 'döviz', 'borsa', 'büyüme', 'gdp', 'gsyh',
    'merkez bankası', 'fed', 'ecb', 'tcmb', 'işsizlik', 'ihracat', 'ithalat',
    'tahvil', 'altın', 'petrol', 'ham petrol', 'doğalgaz', 'resesyon',
    'bütçe', 'vergi', 'hazine', 'hisse', 'endeks', 'ticaret açığı',
    'şimşek', 'astor enerji', 'rivian', 'soğan ithalat', 'japonya merkez',
  ],
  magazin: [
    'ünlü', 'oyuncu', 'şarkıcı', 'evlendi', 'boşandı', 'bebek',
    'düğün', 'nişan', 'balayı', 'magazin', 'oscar', 'grammy', 'dizi',
    'konser', 'albüm', 'skandal', 'kavga', 'sosyal medya', 'instagram',
    'takipçi', 'ifşa', 'flaş', 'kraliyet', 'gelinlik', 'gelin', 'nikah',
    'ünlü model', 'ünlü çift',
  ],
};

function detectCategory(question) {
  const q = question.toLowerCase();
  const scores = {};
  for (const [cat, kws] of Object.entries(CATEGORY_KEYWORDS)) {
    scores[cat] = kws.filter(k =>
      k.length <= 5
        ? new RegExp(`\\b${k}\\b`).test(q)  // word-boundary for short tickers (ada, defi, sol…)
        : q.includes(k)
    ).length;
  }
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  return sorted[0][1] === 0 ? 'siyaset' : sorted[0][0];
}

// ═══════════════════════════════════════════════════════════════════
// CRYPTO RESOLVER
// Primary:  Binance data.binance.vision (public, no geo-block)
// Fallback: CoinGecko market_chart (free tier, no key)
// ═══════════════════════════════════════════════════════════════════
const BINANCE_SYMBOLS = {
  bitcoin: 'BTCUSDT', btc: 'BTCUSDT',
  ethereum: 'ETHUSDT', eth: 'ETHUSDT',
  solana: 'SOLUSDT', sol: 'SOLUSDT',
  cardano: 'ADAUSDT', ada: 'ADAUSDT',
  bnb: 'BNBUSDT',
  xrp: 'XRPUSDT', ripple: 'XRPUSDT',
  dogecoin: 'DOGEUSDT', doge: 'DOGEUSDT',
  polygon: 'MATICUSDT', matic: 'MATICUSDT',
  avalanche: 'AVAXUSDT', avax: 'AVAXUSDT',
  chainlink: 'LINKUSDT', link: 'LINKUSDT',
  zcash: 'ZECUSDT', zec: 'ZECUSDT',
};

const COINGECKO_IDS = {
  bitcoin: 'bitcoin', btc: 'bitcoin',
  ethereum: 'ethereum', eth: 'ethereum',
  solana: 'solana', sol: 'solana',
  cardano: 'cardano', ada: 'cardano',
  bnb: 'binancecoin',
  xrp: 'ripple', ripple: 'ripple',
  dogecoin: 'dogecoin', doge: 'dogecoin',
  polygon: 'matic-network', matic: 'matic-network',
  avalanche: 'avalanche-2', avax: 'avalanche-2',
  chainlink: 'chainlink', link: 'chainlink',
  zcash: 'zcash', zec: 'zcash',
};

function detectCoinInfo(question) {
  const q = question.toLowerCase();
  for (const [kw, sym] of Object.entries(BINANCE_SYMBOLS)) {
    if (q.includes(kw)) return { symbol: sym, cgId: COINGECKO_IDS[kw] || null };
  }
  return null;
}

// Keep old name for internal compat
function detectBinanceSymbol(question) {
  return detectCoinInfo(question)?.symbol || null;
}

function extractPriceThreshold(question) {
  const q = question.toLowerCase();
  let value = null;

  // 1. Turkish dot-thousands: 60.000, 1.750, 64.000
  const trMatch = q.match(/(\d{1,3}(?:\.\d{3})+)/);
  if (trMatch) value = parseFloat(trMatch[1].replace(/\./g, ''));

  // 2. American comma-thousands: 63,000, 1,700 (user typed American-style)
  if (value === null) {
    const amMatch = q.match(/(\d{1,3}(?:,\d{3})+)/);
    if (amMatch) value = parseFloat(amMatch[1].replace(/,/g, ''));
  }

  // 3. Plain 4+ digit integer: 63000
  if (value === null) {
    const plainMatch = q.match(/(\d{4,})/);
    if (plainMatch) value = parseFloat(plainMatch[1]);
  }

  if (value === null || value < 100 || isNaN(value)) return null;

  // Direction detection (order matters: more specific first)
  const stayAbove =
    q.includes('üzerinde kal') || q.includes('üstünde kal') ||
    (q.includes('üzerinde') && (q.includes('başar') || q.includes('tutun')));
  const dropBelow =
    q.includes('altına düş') || q.includes('altına in') ||
    (q.includes('altında') && q.includes('kalacak'));
  const exceed =
    q.includes('aşacak') || q.includes('geçecek') ||
    q.includes('üzerine çık') || q.includes('üstüne çık');

  let direction = 'exceed'; // default
  if (stayAbove) direction = 'stay_above';
  else if (dropBelow) direction = 'under';

  return { value, direction };
}

function applyThreshold(maxHigh, minLow, threshold) {
  const thr = threshold.value.toLocaleString();
  if (threshold.direction === 'stay_above') {
    const result = minLow > threshold.value;
    return { result, reason: `min=$${minLow.toFixed(2)} eşik $${thr} → ${result ? 'Üzerinde kaldı ✅' : 'Altına düştü ❌'}` };
  }
  if (threshold.direction === 'under') {
    const result = minLow < threshold.value;
    return { result, reason: `min=$${minLow.toFixed(2)} eşik $${thr} → ${result ? 'Altına düştü ✅' : 'Düşmedi ❌'}` };
  }
  const result = maxHigh > threshold.value;
  return { result, reason: `max=$${maxHigh.toFixed(2)} eşik $${thr} → ${result ? 'Aştı ✅' : 'Aşamadı ❌'}` };
}

async function resolveCrypto(question, deadline) {
  const coinInfo = detectCoinInfo(question);
  if (!coinInfo) return { result: null, reason: 'Kripto sembolü tanınamadı', source: 'none' };
  const { symbol, cgId } = coinInfo;

  const threshold = extractPriceThreshold(question);
  if (!threshold) return { result: null, reason: `Fiyat eşiği bulunamadı (${symbol})`, source: 'none' };

  const endMs = Number(deadline) * 1000;
  const startMs = endMs - 48 * 3600 * 1000;

  // ── Try 1: Binance data.binance.vision (public data API, not geo-blocked) ──
  const binanceUrls = [
    `https://data-api.binance.vision/api/v3/klines?symbol=${symbol}&interval=1h&startTime=${startMs}&endTime=${endMs}&limit=50`,
    `https://api1.binance.com/api/v3/klines?symbol=${symbol}&interval=1h&startTime=${startMs}&endTime=${endMs}&limit=50`,
    `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1h&startTime=${startMs}&endTime=${endMs}&limit=50`,
  ];

  for (const url of binanceUrls) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const klines = await res.json();
      if (!Array.isArray(klines) || klines.length === 0) continue;

      const highs = klines.map(k => parseFloat(k[2]));
      const lows = klines.map(k => parseFloat(k[3]));
      const { result, reason } = applyThreshold(Math.max(...highs), Math.min(...lows), threshold);
      const host = new URL(url).hostname;
      return { result, reason: `${symbol} ${reason}`, source: `binance-${host}` };
    } catch { /* try next */ }
  }

  // ── Try 2: CoinGecko market_chart (free, historical hourly prices) ──
  if (cgId) {
    try {
      // days=3 gives hourly granularity for the past 3 days
      const days = Math.ceil((Date.now() - startMs) / 86400000) + 1;
      const cgUrl = `https://api.coingecko.com/api/v3/coins/${cgId}/market_chart?vs_currency=usd&days=${Math.min(days, 90)}`;
      const res = await fetch(cgUrl, { signal: AbortSignal.timeout(10000) });
      if (res.ok) {
        const data = await res.json();
        const prices = (data.prices || []).filter(([ts]) => ts >= startMs && ts <= endMs).map(([, p]) => p);
        if (prices.length > 0) {
          const maxH = Math.max(...prices);
          const minL = Math.min(...prices);
          const { result, reason } = applyThreshold(maxH, minL, threshold);
          return { result, reason: `${cgId} CoinGecko ${reason}`, source: 'coingecko' };
        }
      }
    } catch { /* fall through */ }
  }

  return { result: null, reason: `Kripto fiyat verisi alınamadı (${symbol}) — Binance+CoinGecko başarısız`, source: 'none' };
}

// ═══════════════════════════════════════════════════════════════════
// SPORTS RESOLVER
// WC matches → football-data.org
// Club matches → api-sports.io
// Everything else → Google News + Claude
// ═══════════════════════════════════════════════════════════════════
const TR_TEAM_MAP = {
  'avustralya': 'australia', 'türkiye milli': 'turkey', 'türkiye': 'turkey',
  'brezilya': 'brazil', 'almanya': 'germany', 'fransa': 'france',
  'ispanya': 'spain', 'hollanda': 'netherlands', 'portekiz': 'portugal',
  'arjantin': 'argentina', 'japonya': 'japan', 'güney kore': 'south korea',
  'fas': 'morocco', 'meksika': 'mexico', 'abd': 'united states',
  'kanada': 'canada', 'belçika': 'belgium', 'hırvatistan': 'croatia',
  'isviçre': 'switzerland', 'danimarka': 'denmark', 'polonya': 'poland',
  'sırbistan': 'serbia', 'urugua': 'uruguay', 'ekvador': 'ecuador',
  'kamerun': 'cameroon', 'gana': 'ghana', 'tunus': 'tunisia',
  'katar': 'qatar', 'suudi arabistan': 'saudi arabia',
  'norveç': 'norway', 'isveç': 'sweden', 'avusturya': 'austria',
  'iskocya': 'scotland', 'haiti': 'haiti', 'irak': 'iraq',
  'ingiltere': 'england', 'kostarika': 'costa rica',
  'paraguay': 'paraguay', 'venezüela': 'venezuela', 'kolombiya': 'colombia',
  'şili': 'chile', 'peru': 'peru', 'bolivya': 'bolivia',
  'yeni zelanda': 'new zealand', 'nijerya': 'nigeria', 'senegal': 'senegal',
  'fildişi sahili': 'ivory coast', 'angola': 'angola', 'kenya': 'kenya',
};

function normalizeTeam(name) {
  return name.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function extractMentionedTeams(question) {
  const q = question.toLowerCase();
  const found = [];
  // Longer phrases first (e.g. "türkiye milli" before "türkiye")
  for (const [tr] of Object.entries(TR_TEAM_MAP).sort((a, b) => b[0].length - a[0].length)) {
    if (q.includes(tr)) found.push(TR_TEAM_MAP[tr]);
  }
  return [...new Set(found)];
}

async function fetchWCFinished() {
  const token = (process.env.FOOTBALL_API_TOKEN || 'd393bb1aa1184d4b8ef6145564909128').trim();
  try {
    const res = await fetch('https://api.football-data.org/v4/competitions/WC/matches?status=FINISHED', {
      headers: { 'X-Auth-Token': token }, signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.matches || [];
  } catch { return []; }
}

async function fetchApiSportsFixtures() {
  const key = process.env.API_FOOTBALL_KEY;
  if (!key) return [];
  const results = [];
  const today = new Date();
  await Promise.all([-3, -2, -1, 0, 1].map(async (offset) => {
    const d = new Date(today);
    d.setDate(d.getDate() + offset);
    const dateStr = d.toISOString().split('T')[0];
    try {
      const res = await fetch(`https://v3.football.api-sports.io/fixtures?date=${dateStr}`, {
        headers: { 'x-apisports-key': key }, signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) return;
      const data = await res.json();
      results.push(...(data.response || []));
    } catch { /* skip */ }
  }));
  return results;
}

async function resolveSports(question, deadline, anthropic) {
  const q = question.toLowerCase();
  const isResult = q.includes('kazanacak') || q.includes('kaybedecek') || q.includes('beraberlik') ||
    q.includes('finale') || q.includes('çeyrek') || q.includes('oynanacak') || q.includes('başlayacak');

  // ── football-data.org for WC ──
  const mentionedTeams = extractMentionedTeams(question);
  if (mentionedTeams.length > 0) {
    const wcMatches = await fetchWCFinished();
    if (wcMatches.length > 0) {
      const matchesTeam = (sideName, teamName) => {
        const s = normalizeTeam(sideName);
        const t = normalizeTeam(teamName);
        return s.includes(t) || t.includes(s) ||
          t.startsWith(s.split(' ')[0]) || s.startsWith(t.split(' ')[0]);
      };

      // If 2+ teams mentioned, require both in the same fixture
      let fixture;
      let exactMatchup = false;
      if (mentionedTeams.length >= 2) {
        fixture = wcMatches.find(m => {
          const home = m.homeTeam?.name || '';
          const away = m.awayTeam?.name || '';
          return mentionedTeams.every(t => matchesTeam(home, t) || matchesTeam(away, t));
        });
        if (fixture) exactMatchup = true;
      }
      // Fall back to single-team match (only useful for win/loss, not oynanacak)
      if (!fixture) {
        fixture = wcMatches.find(m => {
          const home = m.homeTeam?.name || '';
          const away = m.awayTeam?.name || '';
          return mentionedTeams.some(t => matchesTeam(home, t) || matchesTeam(away, t));
        });
      }

      // Don't process fixture if oynanacak question needs exact pairing but only single-team found
      const needsExactPairing = (q.includes('oynanacak') || q.includes('başlayacak')) && mentionedTeams.length >= 2;
      if (fixture && !(needsExactPairing && !exactMatchup)) {
        const home = fixture.homeTeam?.name;
        const away = fixture.awayTeam?.name;
        const homeG = fixture.score?.fullTime?.home;
        const awayG = fixture.score?.fullTime?.away;
        const kickoffEpoch = Math.floor(new Date(fixture.utcDate).getTime() / 1000);
        const withinDeadline = kickoffEpoch <= Number(deadline);

        if (q.includes('oynanacak') || q.includes('başlayacak')) {
          const played = fixture.status === 'FINISHED' && withinDeadline;
          return { result: played, reason: `${home} vs ${away} | ${fixture.status} | ${fixture.utcDate.slice(0, 10)}`, source: 'football-data.org' };
        }

        if (homeG !== null && homeG !== undefined && awayG !== null) {
          const firstTeam = mentionedTeams[0];
          const homeNorm = normalizeTeam(home);
          const ftNorm = normalizeTeam(firstTeam);
          const isAskingHome = homeNorm.startsWith(ftNorm.split(' ')[0]) || ftNorm.startsWith(homeNorm.split(' ')[0]);

          let result;
          if (q.includes('beraberlik')) {
            result = homeG === awayG;
          } else {
            result = isAskingHome ? homeG > awayG : awayG > homeG;
          }
          return {
            result,
            reason: `${home} ${homeG}-${awayG} ${away} | ${firstTeam} ${result ? 'kazandı ✅' : 'kazanamadı ❌'}`,
            source: 'football-data.org',
          };
        }
      }
    }
  }

  // ── api-sports.io for club football ──
  const clubTeams = ['beşiktaş', 'galatasaray', 'fenerbahçe', 'trabzonspor', 'başakşehir',
    'real madrid', 'barcelona', 'chelsea', 'liverpool', 'manchester', 'arsenal',
    'milan', 'juventus', 'psg', 'nottingham', 'manchester city'];
  const isClubFootball = clubTeams.some(t => q.includes(t));

  if (isResult && isClubFootball) {
    const fixtures = await fetchApiSportsFixtures();
    const finished = fixtures.filter(f => ['FT', 'AET', 'PEN'].includes(f.fixture?.status?.short));
    if (finished.length > 0) {
      const fixtureData = finished.slice(0, 40).map(f =>
        `${f.teams?.home?.name} ${f.goals?.home ?? '?'}-${f.goals?.away ?? '?'} ${f.teams?.away?.name} (${f.fixture?.date?.split('T')[0]})`
      ).join('\n');

      const { result: r1, reasoning: rs1 } = await askClaude(question, [fixtureData], anthropic, true);
      if (r1 !== null) {
        return { result: r1, reason: `api-sports.io ${finished.length} biten maç + Claude | ${rs1}`, source: 'api-sports.io+claude' };
      }
    }
  }

  // ── Google News + Claude fallback ──
  const headlines = await fetchGoogleNews(question);
  if (headlines.length > 0) {
    const { result: r2, reasoning: rs2 } = await askClaude(question, headlines, anthropic, false);
    if (r2 !== null) {
      return { result: r2, reason: `Google News + Claude | ${rs2}`, source: 'google-news+claude' };
    }
  }

  return { result: null, reason: 'Spor verisi bulunamadı — manuel inceleme gerekli', source: 'none' };
}

// ═══════════════════════════════════════════════════════════════════
// NEWS RESOLVER — RSS feeds + Google News + Claude
// Used for: siyaset, ekonomi, magazin
// ═══════════════════════════════════════════════════════════════════
const RSS_BY_CATEGORY = {
  siyaset: ['https://feeds.bbci.co.uk/turkce/rss.xml', 'https://www.ntv.com.tr/turkiye.rss'],
  ekonomi: ['https://www.bloomberght.com/rss', 'https://www.dunya.com/rss'],
  magazin: ['https://www.hurriyet.com.tr/rss/magazin', 'https://www.milliyet.com.tr/rss/rssNew/magazin_rss.xml'],
};

function parseTitlesFromRSS(xml) {
  const titles = [];
  const itemRx = /<item[\s\S]*?<\/item>/gi;
  const titleRx = /<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i;
  for (const item of xml.match(itemRx) || []) {
    const m = item.match(titleRx);
    if (m) {
      const t = m[1]
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
      if (t) titles.push(t);
    }
  }
  return titles.slice(0, 8);
}

async function fetchRSS(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ArcPredict/1.0)' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    return parseTitlesFromRSS(await res.text());
  } catch { return []; }
}

async function fetchGoogleNews(question) {
  const kws = question.replace(/[?'"()]/g, '').split(/\s+/).filter(w => w.length > 3).slice(0, 5).join(' ');
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(kws)}&hl=tr&gl=TR&ceid=TR:tr`;
  return fetchRSS(url);
}

// isStructured=true: headlines is a single block of structured data, not a news list
// Returns { result: true|false|null, reasoning: string }
async function askClaude(question, headlines, anthropic, isStructured = false) {
  if (!headlines.length) return { result: null, reasoning: 'Veri yok' };
  const body = isStructured
    ? headlines.join('\n')
    : headlines.map(h => `- ${h}`).join('\n');

  const resp = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 300,
    messages: [{
      role: 'user',
      content: `Aşağıdaki tahmin sorusunu ve güncel bilgileri analiz et. SADECE JSON döndür, başka açıklama yapma.\n\nSoru: "${question}"\n\nGüncel bilgi:\n${body}\n\nYanıtını YALNIZCA şu JSON formatında ver:\n{"answer":"yes","reasoning":"kısa açıklama"}\nveya {"answer":"no","reasoning":"kısa açıklama"}\nveya {"answer":"inconclusive","reasoning":"neden belirlenemedi"}`,
    }],
  });
  const text = resp.content.find(b => b.type === 'text')?.text?.trim() || '';
  try {
    const m = text.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(m ? m[0] : text);
    const answer = (parsed.answer || '').toLowerCase();
    const reasoning = parsed.reasoning || '';
    if (answer === 'yes') return { result: true, reasoning };
    if (answer === 'no') return { result: false, reasoning };
    return { result: null, reasoning: reasoning || 'Belirsiz' };
  } catch {
    const up = text.toUpperCase();
    if (up.includes('YES') || up.includes('EVET')) return { result: true, reasoning: text.slice(0, 100) };
    if (up.includes('NO') || up.includes('HAYIR')) return { result: false, reasoning: text.slice(0, 100) };
    return { result: null, reasoning: `JSON parse hatası: ${text.slice(0, 80)}` };
  }
}

async function resolveNews(question, category, anthropic) {
  const feeds = RSS_BY_CATEGORY[category] || RSS_BY_CATEGORY.siyaset;

  const [feed1, feed2, google] = await Promise.all([
    fetchRSS(feeds[0]),
    feeds[1] ? fetchRSS(feeds[1]) : Promise.resolve([]),
    fetchGoogleNews(question),
  ]);

  const allHeadlines = [...new Set([...google, ...feed1, ...feed2])].slice(0, 15);

  if (!allHeadlines.length) {
    return { result: null, reason: 'RSS + Google News boş — manuel inceleme', source: 'none' };
  }

  const { result, reasoning } = await askClaude(question, allHeadlines, anthropic, false);

  return {
    result,
    reason: result === null
      ? `Claude BELİRSİZ (${allHeadlines.length} haber) | ${reasoning}`
      : `${category.toUpperCase()} RSS+Google+Claude (${allHeadlines.length} haber) | ${reasoning}`,
    source: `${category}-rss+claude`,
  };
}

// ═══════════════════════════════════════════════════════════════════
// MAIN HANDLER
// Optimized for Vercel 60s timeout:
// - Reads all predictions in parallel batches (5 at a time)
// - Prioritizes predictions with stakes (non-zero pool)
// - Caps at MAX_PER_RUN resolutions per invocation
// - ?all=1 query param disables the cap (for manual runs)
// ═══════════════════════════════════════════════════════════════════
const READ_BATCH = 5;
const MAX_PER_RUN = 10;

// Named exports for dry-run testing
const handler = async function handler(req, res) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers['authorization'] !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: 'ANTHROPIC_API_KEY eksik' });
  if (!process.env.PRIVATE_KEY) return res.status(500).json({ error: 'PRIVATE_KEY eksik' });

  const runAll = req.query?.all === '1';
  const log = [];
  const inconclusiveItems = [];

  try {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
    const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, wallet);
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const total = Number(await contract.predictionCount());
    const now = Math.floor(Date.now() / 1000);
    log.push(`Toplam: ${total} tahmin | ${new Date().toISOString()}`);

    // ── Batch-read all predictions in parallel ──
    const allPredictions = [];
    for (let base = 0; base < total; base += READ_BATCH) {
      const ids = Array.from({ length: Math.min(READ_BATCH, total - base) }, (_, i) => base + i);
      const batch = await Promise.all(ids.map(id =>
        contract.getPrediction(id)
          .then(([question, deadline, isResolved, result, yes, no]) =>
            ({ id, question, deadline: Number(deadline), isResolved, yes: BigInt(yes), no: BigInt(no) }))
          .catch(() => null)
      ));
      allPredictions.push(...batch.filter(Boolean));
    }

    // ── Filter: unresolved + past deadline ──
    const pending = allPredictions.filter(p => !p.isResolved && p.deadline <= now);
    log.push(`Bekleyen (vadesi geçmiş): ${pending.length}`);

    // ── Prioritize: non-zero stake predictions first, then oldest ──
    pending.sort((a, b) => {
      const aStake = a.yes + a.no > 0n ? 1 : 0;
      const bStake = b.yes + b.no > 0n ? 1 : 0;
      if (bStake !== aStake) return bStake - aStake; // stakes first
      return a.deadline - b.deadline; // then oldest
    });

    const toProcess = runAll ? pending : pending.slice(0, MAX_PER_RUN);
    log.push(`İşlenecek: ${toProcess.length}${runAll ? ' (tümü)' : ` / ${pending.length} (max ${MAX_PER_RUN})`}`);

    let resolved = 0, inconclusive = 0, errors = 0;

    for (const pred of toProcess) {
      const { id, question, deadline } = pred;
      const category = detectCategory(question);
      console.log(`\n[${id}] CATEGORY=${category.toUpperCase()} | ${question.slice(0, 70)}`);
      let resolution;

      if (category === 'kripto') {
        resolution = await resolveCrypto(question, deadline);
      } else if (category === 'spor') {
        resolution = await resolveSports(question, deadline, anthropic);
      } else {
        resolution = await resolveNews(question, category, anthropic);
      }

      const { result, reason, source } = resolution;
      console.log(`[${id}] RESOLVER=${source} | DECISION=${result === null ? 'INCONCLUSIVE' : result ? 'YES ✅' : 'NO ❌'}`);
      console.log(`[${id}] REASON: ${reason.slice(0, 150)}`);

      if (result === null) {
        inconclusive++;
        log.push(`[${id}] BELIRSIZ [${category}/${source}] — ${reason}`);
        inconclusiveItems.push({ id, category, question: question.slice(0, 80) });
        continue;
      }

      try {
        const tx = await contract.resolvePrediction(id, result);
        await tx.wait();
        log.push(`[${id}] ${result ? 'EVET✅' : 'HAYIR❌'} [${category}/${source}] — ${reason} | Tx:${tx.hash.slice(0, 10)}`);
        console.log(`[${id}] TX OK: ${tx.hash.slice(0, 16)}...`);
        resolved++;
      } catch (err) {
        log.push(`[${id}] TX HATA [${category}]: ${err.message.slice(0, 80)}`);
        console.log(`[${id}] TX ERROR: ${err.message.slice(0, 80)}`);
        errors++;
      }
    }

    log.push('');
    log.push('═══ ÖZET ═══');
    log.push(`Çözümlendi: ${resolved} | Belirsiz/Manuel: ${inconclusive} | Hata: ${errors} | Kalan: ${pending.length - toProcess.length}`);
    if (inconclusiveItems.length) {
      log.push('');
      log.push('Manuel inceleme gereken tahminler:');
      inconclusiveItems.forEach(e => log.push(`  [${e.id}] ${e.category}: ${e.question}`));
    }

    return res.status(200).json({ ok: true, resolved, inconclusive, errors, remaining: pending.length - toProcess.length, log });
  } catch (err) {
    log.push(`Fatal: ${err.message}`);
    return res.status(500).json({ ok: false, error: err.message, log });
  }
};

module.exports = handler;
module.exports.detectCategory = detectCategory;
module.exports.resolveCrypto = resolveCrypto;
module.exports.resolveSports = resolveSports;
module.exports.resolveNews = resolveNews;
