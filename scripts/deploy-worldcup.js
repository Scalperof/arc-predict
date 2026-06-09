const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying WorldCupBet with:", deployer.address);
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Balance:", ethers.formatEther(balance), "USDC");

  const WorldCupBet = await ethers.getContractFactory("WorldCupBet");
  const contract = await WorldCupBet.deploy();
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log("\nWorldCupBet deployed to:", address);
  console.log("Explorer:", `https://testnet.arcscan.app/address/${address}`);
  console.log("\nSonraki adim: create-wc-matches.js icindeki WC_CONTRACT_ADDRESS'i guncelle.");
}

main().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
