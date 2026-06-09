require('dotenv').config();
const { ethers } = require('ethers');

const WC_CONTRACT_ADDRESS = "0x24c2AD016280f847d49874Dd06635B4DFe85Ea6D";
const ABI = [
  "function createMatch(string homeTeam, string awayTeam, uint256 kickoff, uint256 externalId) external returns (uint256)",
  "function matchCount() view returns (uint256)",
  "function fixtureCreated(uint256) view returns (bool)"
];
const RPC_URL = "https://rpc.testnet.arc.network";

// FIFA Dunya Kupasi 2026 - Grup Asamasi ilk hafta
// Kickoff saatleri UTC (TR = UTC+3)
function utc(dateStr) {
  return Math.floor(new Date(dateStr).getTime() / 1000);
}

const WC_MATCHES = [
  // Haziran 11 - Acilis gunu
  { home: "Meksika",    away: "Ekvador",      kickoff: utc("2026-06-11T21:00:00Z"), id: 10001 },
  { home: "ABD",        away: "Panama",        kickoff: utc("2026-06-12T00:00:00Z"), id: 10002 },
  // Haziran 12
  { home: "Arjantin",   away: "Peru",          kickoff: utc("2026-06-12T18:00:00Z"), id: 10003 },
  { home: "Fransa",     away: "Fas",           kickoff: utc("2026-06-12T21:00:00Z"), id: 10004 },
  { home: "Almanya",    away: "Japonya",       kickoff: utc("2026-06-13T00:00:00Z"), id: 10005 },
  // Haziran 13
  { home: "Brezilya",   away: "Kamerun",       kickoff: utc("2026-06-13T18:00:00Z"), id: 10006 },
  { home: "Ingiltere",  away: "Arnavutluk",    kickoff: utc("2026-06-13T21:00:00Z"), id: 10007 },
  { home: "Ispanya",    away: "Hollanda",      kickoff: utc("2026-06-14T00:00:00Z"), id: 10008 },
  // Haziran 14
  { home: "Portekiz",   away: "G.Kore",        kickoff: utc("2026-06-14T18:00:00Z"), id: 10009 },
  { home: "Turkiye",    away: "Cezayir",       kickoff: utc("2026-06-14T21:00:00Z"), id: 10010 },
];

async function main() {
  if (!process.env.PRIVATE_KEY) { console.error("PRIVATE_KEY gerekli"); process.exit(1); }

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  const contract = new ethers.Contract(WC_CONTRACT_ADDRESS, ABI, wallet);

  const now = Math.floor(Date.now() / 1000);
  console.log(`WorldCupBet: ${WC_CONTRACT_ADDRESS}`);
  console.log(`Toplam mac tanimi: ${WC_MATCHES.length}\n`);

  let created = 0, skipped = 0;

  for (const m of WC_MATCHES) {
    const already = await contract.fixtureCreated(m.id);
    if (already) {
      console.log(`  ATLA  [${m.id}] ${m.home} vs ${m.away} (zaten mevcut)`);
      skipped++;
      continue;
    }
    if (m.kickoff <= now) {
      console.log(`  ATLA  [${m.id}] ${m.home} vs ${m.away} (basladi veya gecti)`);
      skipped++;
      continue;
    }
    const kickoffStr = new Date(m.kickoff * 1000).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
    console.log(`  OLUSTUR [${m.id}] ${m.home} vs ${m.away} @ ${kickoffStr}`);
    try {
      const tx = await contract.createMatch(m.home, m.away, m.kickoff, m.id);
      await tx.wait();
      console.log(`          Tx: ${tx.hash}`);
      created++;
    } catch (err) {
      console.error(`          HATA: ${err.message}`);
    }
  }

  console.log(`\nTamamlandi: ${created} olusturuldu, ${skipped} atlanda.`);
}

main().catch(err => { console.error(err); process.exit(1); });
