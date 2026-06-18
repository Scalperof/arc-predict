// Run: PRIVATE_KEY=0x... node create-predictions-batch.js
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
  // ── Kripto ──────────────────────────────────────────────────────────────
  { q: "Bitcoin 2026 sonuna kadar $150,000'i aşacak mı?",             deadline: days(180) },
  { q: "Ethereum, 2026 Q4'te $10,000 seviyesini görecek mi?",          deadline: days(180) },
  { q: "Solana (SOL) 2026 sonunda $500 üzerinde kapanacak mı?",        deadline: days(180) },
  { q: "BTC ETF'lerinin toplam AUM'u 2026'da $100 milyarı geçecek mi?",deadline: days(150) },
  { q: "Ethereum, günlük işlem hacminde Solana'yı geçecek mi? (Q3 2026)", deadline: days(90) },
  { q: "Kripto piyasası toplam market cap'i 2026'da $5 trilyon görecek mi?", deadline: days(200) },

  // ── Ekonomi ─────────────────────────────────────────────────────────────
  { q: "Fed 2026 yılında faiz oranlarını toplam 3 kez düşürecek mi?",   deadline: days(180) },
  { q: "Türkiye enflasyonu Aralık 2026'da %30'un altına düşecek mi?",   deadline: days(195) },
  { q: "Altın fiyatı 2026 sonunda $3,500/oz üzerinde olacak mı?",       deadline: days(180) },
  { q: "Dolar/TL kuru 2026 sonunda 50 TL'yi geçecek mi?",               deadline: days(195) },
  { q: "BIST 100 endeksi 2026 yılında 15,000 puanı aşacak mı?",         deadline: days(180) },
  { q: "Petrol fiyatı (Brent) 2026 Q3'te $100/varil üzerine çıkacak mı?", deadline: days(90) },

  // ── Spor ────────────────────────────────────────────────────────────────
  { q: "Galatasaray 2025-26 Süper Lig şampiyonu olacak mı?",            deadline: days(30)  },
  { q: "Fenerbahçe 2025-26 sezonu Şampiyonlar Ligi'ne katılacak mı?",   deadline: days(30)  },
  { q: "2026 FIFA Dünya Kupası'nı Brezilya kazanacak mı?",              deadline: days(120) },
  { q: "Lionel Messi 2026 FIFA Dünya Kupası'nda oynayacak mı?",         deadline: days(60)  },
  { q: "Real Madrid 2025-26 UEFA Şampiyonlar Ligi şampiyonu olacak mı?",deadline: days(30)  },
  { q: "Türkiye Milli Takımı 2026 FIFA Dünya Kupası'nda çeyrek finale çıkacak mı?", deadline: days(120) },
  { q: "NBA 2025-26 şampiyonu Oklahoma City Thunder olacak mı?",         deadline: days(60)  },
  { q: "Formula 1 2026 Dünya Şampiyonu Max Verstappen olacak mı?",      deadline: days(180) },

  // ── Siyaset ─────────────────────────────────────────────────────────────
  { q: "Trump'ın onay oranı 2026 Q3'te %50'nin üzerine çıkacak mı?",    deadline: days(90)  },
  { q: "ABD Kongresi 2026'da kapsamlı bir kripto düzenleme yasası çıkaracak mı?", deadline: days(180) },
  { q: "Türkiye 2026'da IMF ile yeni bir stand-by anlaşması imzalayacak mı?", deadline: days(180) },
  { q: "İngiltere'de erken seçim 2026'da yapılacak mı?",                 deadline: days(180) },

  // ── Magazin/Teknoloji ────────────────────────────────────────────────────
  { q: "Apple Vision Pro 2 2026 yılı içinde piyasaya sürülecek mi?",    deadline: days(180) },
  { q: "Netflix abone sayısı 2026 sonunda 350 milyonu geçecek mi?",     deadline: days(195) },
  { q: "X (Twitter) kullanıcı sayısı 2026'da 1 milyarı aşacak mı?",    deadline: days(180) },
  { q: "OpenAI 2026'da halka arz (IPO) yapacak mı?",                    deadline: days(180) },
  { q: "Tesla hissesi (TSLA) 2026 sonunda $400 üzerinde kapanacak mı?", deadline: days(195) },
];

async function main() {
  const pk = process.env.PRIVATE_KEY;
  if (!pk) { console.error("PRIVATE_KEY env var not set"); process.exit(1); }

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(pk, provider);
  const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, wallet);

  const before = Number(await contract.predictionCount());
  console.log(`\nWallet: ${wallet.address}`);
  console.log(`Current prediction count: ${before}`);
  console.log(`Creating ${PREDICTIONS.length} predictions...\n`);

  let ok = 0, fail = 0;
  for (const { q, deadline } of PREDICTIONS) {
    try {
      const tx = await contract.createPrediction(q, deadline);
      await tx.wait();
      console.log(`✓ ${q.slice(0, 60)}...`);
      ok++;
    } catch (err) {
      console.error(`✗ ${q.slice(0, 60)}... — ${err.reason || err.message}`);
      fail++;
    }
  }

  const after = Number(await contract.predictionCount());
  console.log(`\nDone. Created: ${ok}  Failed: ${fail}`);
  console.log(`Prediction count: ${before} → ${after}`);
}

main().catch(e => { console.error(e); process.exit(1); });
