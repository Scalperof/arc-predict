const { ethers } = require('ethers');

const WC_CONTRACT_ADDRESS = "0x24c2AD016280f847d49874Dd06635B4DFe85Ea6D";
const RPC_URL = "https://rpc.testnet.arc.network";
const WC_ABI = [
  "function matchCount() view returns (uint256)",
  "function getMatch(uint256 matchId) view returns (string homeTeam, string awayTeam, uint256 kickoff, bool resolved, uint8 result, uint256 poolHome, uint256 poolDraw, uint256 poolAway)",
  "function resolveMatch(uint256 matchId, uint8 result) external"
];

function normalizeName(name) {
  return name.toLowerCase().replace(/[^a-z0-9À-ɏ]/g, ' ').replace(/\s+/g, ' ').trim();
}

function teamsMatch(contractName, apiName) {
  const a = normalizeName(contractName);
  const b = normalizeName(apiName);
  return a === b || a.startsWith(b.slice(0, 4)) || b.startsWith(a.slice(0, 4));
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
        {
          headers: { 'x-apisports-key': process.env.API_FOOTBALL_KEY },
          signal: AbortSignal.timeout(10000)
        }
      );
      if (!res.ok) continue;
      const data = await res.json();
      fixtures.push(...(data.response || []));
    } catch { /* devam */ }
  }
  return fixtures;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers['authorization'];
    if (auth !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  if (!process.env.PRIVATE_KEY) return res.status(500).json({ error: 'PRIVATE_KEY eksik' });
  if (!process.env.API_FOOTBALL_KEY) return res.status(500).json({ error: 'API_FOOTBALL_KEY eksik' });

  const log = [];
  try {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
    const contract = new ethers.Contract(WC_CONTRACT_ADDRESS, WC_ABI, wallet);

    const count = Number(await contract.matchCount());
    const now = Math.floor(Date.now() / 1000);

    const matches = await Promise.all(
      Array.from({ length: count }, async (_, i) => {
        const m = await contract.getMatch(i);
        return { id: i, homeTeam: m[0], awayTeam: m[1], kickoff: Number(m[2]), resolved: m[3] };
      })
    );

    const pending = matches.filter(m => !m.resolved && m.kickoff <= now);
    log.push(`Toplam: ${count} mac | Cozum bekleyen: ${pending.length}`);

    if (!pending.length) return res.status(200).json({ ok: true, resolved: 0, log });

    const fixtures = await fetchWCFixtures();
    log.push(`api-sports: ${fixtures.length} fixture alindi`);

    let resolved = 0, skipped = 0;

    for (const m of pending) {
      const fixture = fixtures.find(f => {
        const home = f.teams?.home?.name || '';
        const away = f.teams?.away?.name || '';
        return teamsMatch(m.homeTeam, home) && teamsMatch(m.awayTeam, away);
      });

      if (!fixture) {
        log.push(`[${m.id}] ${m.homeTeam} vs ${m.awayTeam}: fixture bulunamadi`);
        skipped++;
        continue;
      }

      const status = fixture.fixture?.status?.short;
      const finished = ['FT', 'AET', 'PEN'].includes(status);

      if (!finished) {
        log.push(`[${m.id}] ${m.homeTeam} vs ${m.awayTeam}: bitmedi (${status})`);
        skipped++;
        continue;
      }

      const homeGoals = fixture.goals?.home ?? 0;
      const awayGoals = fixture.goals?.away ?? 0;
      const result = homeGoals > awayGoals ? 0 : homeGoals === awayGoals ? 1 : 2;
      const labels = ['Ev Sahibi', 'Beraberlik', 'Deplasman'];

      try {
        const tx = await contract.resolveMatch(m.id, result);
        await tx.wait();
        log.push(`[${m.id}] ${m.homeTeam} ${homeGoals}-${awayGoals} ${m.awayTeam} → ${labels[result]} | ${tx.hash}`);
        resolved++;
      } catch (err) {
        log.push(`[${m.id}] Hata: ${err.message}`);
        skipped++;
      }
    }

    return res.status(200).json({ ok: true, resolved, skipped, log });
  } catch (err) {
    log.push(`Fatal: ${err.message}`);
    return res.status(500).json({ ok: false, error: err.message, log });
  }
};
