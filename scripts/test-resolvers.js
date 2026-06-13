// Quick test of each resolver against real prediction data
// Usage: node scripts/test-resolvers.js
const path = require('path');

// Load .env
const fs = require('fs');
const envLines = fs.readFileSync(path.join(__dirname, '../.env'), 'utf8').split('\n');
for (const line of envLines) {
  const m = line.match(/^([^=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}

// Inline the resolver functions (copy from auto-resolve.js for local testing)
const BINANCE_SYMBOLS = {
  bitcoin: 'BTCUSDT', btc: 'BTCUSDT',
  ethereum: 'ETHUSDT', eth: 'ETHUSDT',
  solana: 'SOLUSDT', sol: 'SOLUSDT',
  bnb: 'BNBUSDT', xrp: 'XRPUSDT', ripple: 'XRPUSDT',
  dogecoin: 'DOGEUSDT', doge: 'DOGEUSDT',
  zcash: 'ZECUSDT', zec: 'ZECUSDT',
};

function detectBinanceSymbol(question) {
  const q = question.toLowerCase();
  for (const [kw, sym] of Object.entries(BINANCE_SYMBOLS)) {
    if (q.includes(kw)) return sym;
  }
  return null;
}

function extractPriceThreshold(question) {
  const q = question.toLowerCase();
  let value = null;
  const trMatch = q.match(/(\d{1,3}(?:\.\d{3})+)/);
  if (trMatch) value = parseFloat(trMatch[1].replace(/\./g, ''));
  if (value === null) {
    const amMatch = q.match(/(\d{1,3}(?:,\d{3})+)/);
    if (amMatch) value = parseFloat(amMatch[1].replace(/,/g, ''));
  }
  if (value === null) {
    const plain = q.match(/(\d{4,})/);
    if (plain) value = parseFloat(plain[1]);
  }
  if (value === null || value < 100 || isNaN(value)) return null;

  const stayAbove = q.includes('üzerinde kal') || (q.includes('üzerinde') && q.includes('başar'));
  const dropBelow = q.includes('altına düş') || q.includes('altına in');
  let direction = 'exceed';
  if (stayAbove) direction = 'stay_above';
  else if (dropBelow) direction = 'under';
  return { value, direction };
}

async function testCrypto(question, deadline) {
  const symbol = detectBinanceSymbol(question);
  const threshold = extractPriceThreshold(question);
  console.log(`  Symbol: ${symbol} | Threshold: ${JSON.stringify(threshold)}`);
  if (!symbol || !threshold) return;

  const endMs = Number(deadline) * 1000;
  const startMs = endMs - 48 * 3600 * 1000;
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1h&startTime=${startMs}&endTime=${endMs}&limit=50`;
  console.log(`  Fetching: .../${symbol}&startTime=${new Date(startMs).toISOString().slice(0,16)}&endTime=${new Date(endMs).toISOString().slice(0,16)}`);

  const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
  if (!res.ok) { console.log(`  Binance ${res.status}`); return; }
  const klines = await res.json();
  if (!klines.length) { console.log(`  No klines`); return; }

  const highs = klines.map(k => parseFloat(k[2]));
  const lows = klines.map(k => parseFloat(k[3]));
  const maxH = Math.max(...highs).toFixed(2);
  const minL = Math.min(...lows).toFixed(2);
  console.log(`  ${klines.length} candles | max=$${maxH} | min=$${minL}`);

  let result;
  if (threshold.direction === 'stay_above') result = parseFloat(minL) > threshold.value;
  else if (threshold.direction === 'under') result = parseFloat(minL) < threshold.value;
  else result = parseFloat(maxH) > threshold.value;

  console.log(`  Result: ${result ? 'EVET ✅' : 'HAYIR ❌'} (${threshold.direction} $${threshold.value.toLocaleString()})`);
}

async function main() {
  // Test predictions: id → [question, deadline_unix]
  const tests = [
    [41, 'BTC 48 saat içerisinde 64.000 dolar seviyesini aşacak mı?', 1749650400],
    [42, 'ETH 48 saat içerisinde 1.750 dolar seviyesini aşacak mı?', 1749650400],
    [51, 'BTC 48 saat içerisinde 63.000 dolar seviyesini aşacak mı?', 1749675660],
    [52, 'ETH 48 saat içerisinde 1.700 dolar seviyesini aşacak mı?', 1749675660],
    [61, 'BTC 48 saat içerisinde 63,000 dolar seviyesini aşacak mı?', 1749683460],
    [62, 'ETH 48 saat içerisinde 1,700 dolar seviyesini aşacak mı?', 1749683460],
    [67, 'Bitcoin, önümüzdeki 48 saat içinde 60.000 dolar seviyesinin üzerinde kalmayı başaracak mı?', 1749760500],
  ];

  for (const [id, question, deadline] of tests) {
    console.log(`\n[${id}] ${question}`);
    await testCrypto(question, deadline);
  }

  // Test WC sports: England vs Costa Rica
  console.log('\n\n── WC Sports test ──');
  console.log('[65] İngiltere, Kostarika ile oynanacak Dünya Kupası 2026 hazırlık maçını kazanacak mı?');
  const token = process.env.FOOTBALL_API_TOKEN || 'd393bb1aa1184d4b8ef6145564909128';
  const r = await fetch('https://api.football-data.org/v4/competitions/WC/matches?status=FINISHED', {
    headers: { 'X-Auth-Token': token }, signal: AbortSignal.timeout(10000)
  });
  if (r.ok) {
    const d = await r.json();
    const matches = (d.matches || []).slice(0, 5);
    console.log(`  WC finished matches (first 5): ${matches.map(m => `${m.homeTeam?.name} vs ${m.awayTeam?.name} (${m.status})`).join(', ') || 'none'}`);
  }
}

main().catch(console.error);
