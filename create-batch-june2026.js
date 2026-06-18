require('dotenv').config();
const { ethers } = require('ethers');

const CONTRACT_ADDRESS = "0xad1BDA8570C867A43e427ae2f6a9721Ac1b89975";
const RPC_URL = "https://rpc.testnet.arc.network";
const ABI = [
  "function createPrediction(string calldata question, uint256 deadline) external",
  "function predictionCount() view returns (uint256)"
];

const now = Math.floor(Date.now() / 1000);
const days = d => now + d * 86400;

const PREDICTIONS = [
  // ── WC 2026 (group stage ongoing) ───────────────────────────────────────
  { q: "Türkiye 2026 FIFA Dünya Kupası grup aşamasını geçecek mi?",                   deadline: days(18) },
  { q: "Türkiye, 2026 WC grup aşamasında en az 1 galibiyet alacak mı?",               deadline: days(15) },
  { q: "2026 FIFA Dünya Kupası'nı Arjantin kazanacak mı?",                             deadline: days(37) },
  { q: "Kylian Mbappé 2026 FIFA Dünya Kupası'nda en az 3 gol atacak mı?",             deadline: days(37) },
  { q: "Brezilya 2026 FIFA Dünya Kupası'nda çeyrek finale çıkacak mı?",               deadline: days(25) },
  { q: "2026 FIFA Dünya Kupası gol kralı Avrupalı bir oyuncu olacak mı?",             deadline: days(37) },

  // ── Spor ────────────────────────────────────────────────────────────────
  { q: "Galatasaray 2026-27 sezonu için Victor Osimhen'i kadrosunda tutacak mı?",     deadline: days(30) },
  { q: "Fenerbahçe 2026 yaz transfer döneminde 3 veya daha fazla oyuncu alacak mı?", deadline: days(45) },

  // ── Kripto ──────────────────────────────────────────────────────────────
  { q: "Bitcoin Temmuz 2026'da $80,000 seviyesini aşacak mı?",                        deadline: days(43) },
  { q: "Ethereum 2026 Q3'te $3,000 seviyesini görecek mi?",                           deadline: days(90) },
  { q: "BTC Ağustos 2026 sonunda $100,000'in üzerinde kapanacak mı?",                 deadline: days(73) },
  { q: "Solana (SOL) 2026'da $300 seviyesini kıracak mı?",                            deadline: days(180) },

  // ── Ekonomi ─────────────────────────────────────────────────────────────
  { q: "Fed Temmuz 2026 toplantısında faiz indirecek mi?",                             deadline: days(43) },
  { q: "Türkiye Merkez Bankası Temmuz 2026'da politika faizini düşürecek mi?",        deadline: days(43) },
  { q: "Dolar/TL kuru Eylül 2026'da 45 TL'yi aşacak mı?",                             deadline: days(90) },
  { q: "Altın fiyatı Temmuz 2026'da $3,200/oz üzerinde kalacak mı?",                  deadline: days(43) },

  // ── Siyaset ─────────────────────────────────────────────────────────────
  { q: "ABD 2026 Kongre seçimlerinde Demokratlar Senato çoğunluğunu geri kazanacak mı?", deadline: days(150) },
  { q: "Türkiye ile İsrail 2026 yılında büyükelçi düzeyinde diplomatik ilişkileri yeniden kuracak mı?", deadline: days(180) },

  // ── Teknoloji ────────────────────────────────────────────────────────────
  { q: "OpenAI 2026 yılı içinde GPT-5 modelini kamuoyuyla paylaşacak mı?",           deadline: days(180) },
  { q: "Arc Blockchain mainnet lansmanı 2026 yılı içinde gerçekleşecek mi?",          deadline: days(180) },
];

async function main() {
  const pk = process.env.PRIVATE_KEY;
  if (!pk) { console.error("PRIVATE_KEY not set"); process.exit(1); }

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(pk, provider);
  const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, wallet);

  const before = Number(await contract.predictionCount());
  console.log(`Wallet: ${wallet.address}`);
  console.log(`Current count: ${before} — creating ${PREDICTIONS.length} predictions\n`);

  let ok = 0, fail = 0;
  for (const { q, deadline } of PREDICTIONS) {
    try {
      const tx = await contract.createPrediction(q, deadline);
      await tx.wait();
      console.log(`✓ [${before + ok}] ${q.slice(0, 65)}`);
      ok++;
    } catch (err) {
      console.error(`✗ ${q.slice(0, 65)} — ${err.reason || err.message}`);
      fail++;
    }
  }

  const after = Number(await contract.predictionCount());
  console.log(`\nDone. Created: ${ok}  Failed: ${fail}`);
  console.log(`Prediction count: ${before} → ${after}`);
}

main().catch(e => { console.error(e); process.exit(1); });
