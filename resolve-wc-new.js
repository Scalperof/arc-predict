require('dotenv').config();
require('dotenv').config({ path: 'frontend/.env.local', override: false });

const { ethers } = require('ethers');

const WC_CONTRACT_ADDRESS = "0x7Aa8715b1641D4EC1A52d646d4e3E6f883064391";
const RPC_URL = "https://rpc.testnet.arc.network";
const ABI = [
  "function matchCount() view returns (uint256)",
  "function getMatch(uint256 matchId) view returns (string homeTeam, string awayTeam, uint256 kickoff, bool resolved, uint8 result, uint256 poolHome, uint256 poolDraw, uint256 poolAway)",
  "function resolveMatch(uint256 matchId, uint8 result) external"
];
const LABELS = { 0: 'HOME', 1: 'DRAW', 2: 'AWAY' };

function norm(name) {
  return name.toLowerCase()
    .replace(/\bdr\b/, 'dr')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function teamsMatch(a, b) {
  const na = norm(a), nb = norm(b);
  if (na === nb) return true;
  // prefix match (first 5 chars)
  if (na.length >= 5 && nb.length >= 5 && na.slice(0, 5) === nb.slice(0, 5)) return true;
  // one contains the other
  if (na.includes(nb) || nb.includes(na)) return true;
  return false;
}

async function fetchFinishedMatches(token) {
  const r = await fetch('https://api.football-data.org/v4/competitions/WC/matches', {
    headers: { 'X-Auth-Token': token },
    signal: AbortSignal.timeout(15000)
  });
  if (!r.ok) throw new Error(`football-data.org API error ${r.status}`);
  const data = await r.json();
  return (data.matches || []).filter(m => m.status === 'FINISHED');
}

async function main() {
  const token = (process.env.FOOTBALL_API_TOKEN || '').trim();
  if (!token) { console.error('FOOTBALL_API_TOKEN not set'); process.exit(1); }
  if (!process.env.PRIVATE_KEY) { console.error('PRIVATE_KEY not set'); process.exit(1); }

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  const contract = new ethers.Contract(WC_CONTRACT_ADDRESS, ABI, wallet);

  const count = Number(await contract.matchCount());
  const now = Math.floor(Date.now() / 1000);
  console.log(`WC contract: ${WC_CONTRACT_ADDRESS}`);
  console.log(`Total matches: ${count}\n`);

  const contractMatches = await Promise.all(
    Array.from({ length: count }, async (_, i) => {
      const m = await contract.getMatch(i);
      return {
        id: i, homeTeam: m[0], awayTeam: m[1],
        kickoff: Number(m[2]), resolved: m[3], result: Number(m[4])
      };
    })
  );

  const pending = contractMatches.filter(m => !m.resolved && m.kickoff <= now);
  console.log(`Expired but unresolved: ${pending.length}`);

  if (!pending.length) { console.log('Nothing to resolve.'); return; }

  console.log('\nFetching results from football-data.org...');
  const apiMatches = await fetchFinishedMatches(token);
  console.log(`API finished matches: ${apiMatches.length}\n`);

  let resolved = 0, skipped = 0;

  for (const m of pending) {
    // find API match by team name (both teams must match, kickoff within 2h)
    const apiMatch = apiMatches.find(f => {
      const timeDiff = Math.abs(new Date(f.utcDate).getTime() / 1000 - m.kickoff);
      return timeDiff < 7200 &&
        teamsMatch(m.homeTeam, f.homeTeam.name) &&
        teamsMatch(m.awayTeam, f.awayTeam.name);
    });

    if (!apiMatch) {
      const date = new Date(m.kickoff * 1000).toISOString().slice(0, 16);
      console.log(`[${m.id}] ${m.homeTeam} vs ${m.awayTeam} (${date}) → NO API MATCH FOUND, skipping`);
      skipped++;
      continue;
    }

    const hg = apiMatch.score.fullTime.home;
    const ag = apiMatch.score.fullTime.away;
    const result = hg > ag ? 0 : hg === ag ? 1 : 2;

    console.log(`[${m.id}] ${m.homeTeam} ${hg}-${ag} ${m.awayTeam} → ${LABELS[result]}`);
    try {
      const tx = await contract.resolveMatch(m.id, result);
      console.log(`     Tx: ${tx.hash}`);
      await tx.wait();
      console.log(`     Confirmed.`);
      resolved++;
    } catch (err) {
      console.error(`     ERROR: ${err.message}`);
      skipped++;
    }
  }

  console.log(`\nDone: ${resolved} resolved, ${skipped} skipped.`);
}

main().catch(err => { console.error('Fatal:', err.message); process.exit(1); });
