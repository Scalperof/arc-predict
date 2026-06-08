const hre = require('hardhat');

async function main() {
  const ArcPredict = await hre.ethers.getContractFactory('ArcPredict');
  const contract = await ArcPredict.deploy();
  await contract.waitForDeployment();
  console.log('ArcPredict deployed to:', await contract.getAddress());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});