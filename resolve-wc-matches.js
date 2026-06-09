require('dotenv').config();
const { ethers } = require('ethers');
const Anthropic = require('@anthropic-ai/sdk');

const WC_CONTRACT_ADDRESS = "0x24c2AD016280f847d49874Dd06635B4DFe85Ea6D";
const RPC_URL = "https://rpc.testnet.arc.network";
const ABI = [
  "function matchCount() view returns (uint256)",
  "function getMatch(uint256 matchId) view returns (string homeTeam, string awayTeam, uint256 kickoff, bool resolved, uint8 result, uint256 poolHome, uint256 poolDraw, uint256 poolAway)",
  "function resolveMatch(uint256 matchId, uint8 result) external"
];

const OUTCOMES = ['Ev Sahibi (0)', 'Beraberlik (1)', 'Deplasman (2)'];
const OUTCOME_LABELS = { 0: 'EV SAHİBİ', 1: 'BERABERLİK', 2: 'DEPLASMAN' };

// ── Yardımcı fonksiyonlar ──────────────────────────────────────────────────────

function parseTitles(xml) {
  const titles = [];
  const itemRe = /<item[\s\S]*?<\/item>/gi;
  const titleRe = /<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i;
  for (const item of xml.match(itemRe) || []) {
    const m = item.match(titleRe);
    if (m) {
      const t = m[1].replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").trim();
      if (t) titles.push(t);
    }
  }
  return titles.slice(0, 8);
}

async function fetchNews(homeTeam, awayTeam) {
  const query = `${homeTeam} ${awayTeam} mac sonucu result`;
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=tr&gl=TR&ceid=TR:tr`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ArcPredict/1.0)' },
      signal: AbortSignal.timeout(10000)
    });
    if (!res.ok) return [];
    return parseTitles(await res.text());
  } catch { return []; }
}

async function askClaude(homeTeam, awayTeam, headlines) {
  if (!headlines.length) return null;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const prompt = `Asagidaki haber basliklarinda "${homeTeam} - ${awayTeam}" mac sonucu var mi?

${headlines.map(h => `- ${h}`).join('\n')}

Eger mac sonucu netse SADECE su seceneklerden birini yaz:
- EV_SAHIBI (${homeTeam} kazandi)
- BERABERLIK
- DEPLASMAN (${awayTeam} kazandi)
- BELIRSIZ (mac bitmedi veya bilgi yok)`;

  const response = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 20,
    messages: [{ role: "user", content: prompt }]
  });
  const answer = response.content.find(b => b.type === 'text')?.text?.trim().toUpperCase() || '';
  if (answer.includes('EV_SAHIBI') || answer.includes('EV SAH')) return 0;
  if (answer.includes('BERABERLIK') || answer.includes('BERABERL')) return 1;
  if (answer.includes('DEPLASMAN')) return 2;
  return null;
}

// ── Kontrat yardımcıları ───────────────────────────────────────────────────────

async function getAllMatches(contract) {
  const count = Number(await contract.matchCount());
  return Promise.all(
    Array.from({ length: count }, async (_, i) => {
      const m = await contract.getMatch(i);
      return {
        id: i,
        homeTeam: m[0], awayTeam: m[1],
        kickoff: Number(m[2]),
        resolved: m[3],
        result: Number(m[4]),
        poolHome: m[5], poolDraw: m[6], poolAway: m[7]
      };
    })
  );
}

function formatMatch(m) {
  const kickoffStr = new Date(m.kickoff * 1000).toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
  const pool = (Number(m.poolHome + m.poolDraw + m.poolAway) / 1e18).toFixed(4);
  const now = Math.floor(Date.now() / 1000);
  let status;
  if (m.resolved)           status = `COZUMLENDI → ${OUTCOME_LABELS[m.result]}`;
  else if (m.kickoff > now) status = `Bekliyor (${Math.floor((m.kickoff-now)/3600)}s kaldi)`;
  else                      status = 'COZUM BEKLIYOR';
  return `[${m.id}] ${m.homeTeam} vs ${m.awayTeam} | ${kickoffStr} | ${pool} USDC | ${status}`;
}

// ── Modlar ────────────────────────────────────────────────────────────────────

async function modeStatus(contract) {
  console.log('Tum maclar:\n');
  const matches = await getAllMatches(contract);
  matches.forEach(m => console.log(' ', formatMatch(m)));
  const pending = matches.filter(m => !m.resolved && m.kickoff <= Math.floor(Date.now()/1000));
  console.log(`\nCozum bekleyen: ${pending.length} mac`);
  if (pending.length) {
    console.log('\nManuel cozum icin:');
    pending.forEach(m => console.log(`  node resolve-wc-matches.js ${m.id} <0|1|2>   (0=ev 1=beraberlik 2=deplasman)`));
    console.log('\nOtomatik cozum icin:');
    console.log('  node resolve-wc-matches.js --auto');
  }
}

async function modeManual(contract, wallet, matchId, result) {
  const m = await contract.getMatch(matchId);
  if (m[3]) { console.error('Bu mac zaten cozumlendi.'); process.exit(1); }
  const now = Math.floor(Date.now() / 1000);
  if (Number(m[2]) > now) { console.error('Hata: Mac henuz baslamadi.'); process.exit(1); }
  console.log(`Cozumleniyor: [${matchId}] ${m[0]} vs ${m[1]} → ${OUTCOME_LABELS[result]}`);
  const c = new ethers.Contract(WC_CONTRACT_ADDRESS, ABI, wallet);
  const tx = await c.resolveMatch(matchId, result);
  console.log('Tx gonderildi:', tx.hash);
  await tx.wait();
  console.log('Basariyla cozumlendi.');
}

async function modeAuto(contract, wallet) {
  if (!process.env.ANTHROPIC_API_KEY) { console.error('ANTHROPIC_API_KEY gerekli'); process.exit(1); }
  const matches = await getAllMatches(contract);
  const now = Math.floor(Date.now() / 1000);
  const pending = matches.filter(m => !m.resolved && m.kickoff <= now);

  if (!pending.length) { console.log('Cozum bekleyen mac yok.'); return; }

  console.log(`${pending.length} mac cozum bekliyor...\n`);
  const c = new ethers.Contract(WC_CONTRACT_ADDRESS, ABI, wallet);
  let resolved = 0, skipped = 0;

  for (const m of pending) {
    console.log(`[${m.id}] ${m.homeTeam} vs ${m.awayTeam}`);
    const headlines = await fetchNews(m.homeTeam, m.awayTeam);
    console.log(`  ${headlines.length} haber basligı bulundu`);
    if (headlines.length) headlines.forEach(h => console.log(`  - ${h}`));

    const result = await askClaude(m.homeTeam, m.awayTeam, headlines);
    if (result === null) {
      console.log('  Sonuc belirlenemedi, atlaniyor.\n');
      skipped++;
      continue;
    }

    console.log(`  Sonuc: ${OUTCOME_LABELS[result]}`);
    try {
      const tx = await c.resolveMatch(m.id, result);
      await tx.wait();
      console.log(`  Tx: ${tx.hash}`);
      resolved++;
    } catch (err) {
      console.error(`  Hata: ${err.message}`);
      skipped++;
    }
    console.log();
  }

  console.log(`Tamamlandi: ${resolved} cozumlendi, ${skipped} atlanda.`);
}

// ── Ana fonksiyon ─────────────────────────────────────────────────────────────

async function main() {
  if (!process.env.PRIVATE_KEY) { console.error('PRIVATE_KEY gerekli'); process.exit(1); }

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  const contract = new ethers.Contract(WC_CONTRACT_ADDRESS, ABI, provider);

  const args = process.argv.slice(2);

  if (args.length === 0) {
    await modeStatus(contract);
  } else if (args[0] === '--auto') {
    await modeAuto(contract, wallet);
  } else if (args.length === 2 && !isNaN(args[0]) && ['0','1','2'].includes(args[1])) {
    await modeManual(contract, wallet, Number(args[0]), Number(args[1]));
  } else {
    console.log('Kullanim:');
    console.log('  node resolve-wc-matches.js                  → tum macları listele');
    console.log('  node resolve-wc-matches.js <matchId> <0|1|2> → manuel cozum');
    console.log('  node resolve-wc-matches.js --auto            → Claude AI ile otomatik cozum');
    console.log('\n  Sonuc kodlari: 0=Ev Sahibi  1=Beraberlik  2=Deplasman');
  }
}

main().catch(err => { console.error('Hata:', err.message); process.exit(1); });
