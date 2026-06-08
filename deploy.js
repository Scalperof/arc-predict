const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("Deploying ArcPredict with account:", deployer.address);
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Account balance:", ethers.formatEther(balance), "USDC");

  const ArcPredict = await ethers.getContractFactory("ArcPredict");
  const arcPredict = await ArcPredict.deploy();
  await arcPredict.waitForDeployment();

  const address = await arcPredict.getAddress();
  console.log("ArcPredict deployed to:", address);
  console.log("Explorer:", `https://testnet.arcscan.app/address/${address}`);

  // Create a sample prediction
  console.log("\nCreating sample prediction...");
  const deadline = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60; // 7 days
  const tx = await arcPredict.createPrediction(
    "Will Arc mainnet launch before Q3 2026?",
    deadline
  );
  await tx.wait();
  console.log("Sample prediction created. Tx:", tx.hash);

  console.log("\n=== Deployment Complete ===");
  console.log("Contract address:", address);
  console.log("Update CONTRACT_ADDRESS in frontend/index.html with:", address);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
