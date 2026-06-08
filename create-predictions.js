const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  const CONTRACT_ADDRESS = "0x564e247bB1faB36fa6b75DEfbB2DDbAa1B6cec45";

  console.log("Creating predictions with:", deployer.address);
  const contract = await ethers.getContractAt("ArcPredict", CONTRACT_ADDRESS);

  const now = Math.floor(Date.now() / 1000);
  const predictions = [
    { question: "Bitcoin 2026 sonuna kadar $200,000'i geçecek mi?",   days: 30 },
    { question: "Ethereum 2.0 sonraki hard fork'u Temmuz 2026'da mı?", days: 21 },
    { question: "Arc Network 2026 Q3'te mainnet'e geçecek mi?",        days: 60 },
  ];

  for (const p of predictions) {
    const deadline = now + p.days * 24 * 60 * 60;
    const tx = await contract.createPrediction(p.question, deadline);
    await tx.wait();
    console.log(`✓ "${p.question}"`);
  }

  const count = await contract.predictionCount();
  console.log(`\nToplam tahmin sayısı: ${count}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
