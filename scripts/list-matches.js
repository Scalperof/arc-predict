const { JsonRpcProvider, Contract } = require('../node_modules/ethers');

const RPC = 'https://rpc.testnet.arc.network';
const CONTRACT = '0x24c2AD016280f847d49874Dd06635B4DFe85Ea6D';
const ABI = [
  'function matchCount() external view returns (uint256)',
  'function getMatch(uint256 matchId) external view returns (string homeTeam, string awayTeam, uint256 kickoff, bool resolved, uint8 result, uint256 poolHome, uint256 poolDraw, uint256 poolAway)'
];

async function main() {
  const provider = new JsonRpcProvider(RPC);
  const contract = new Contract(CONTRACT, ABI, provider);

  const count = Number(await contract.matchCount());
  console.log(`Total matches: ${count}\n`);

  for (let i = 0; i < count; i++) {
    try {
      const [home, away, kickoff, resolved, result, pH, pD, pA] = await contract.getMatch(i);
      const date = new Date(Number(kickoff) * 1000).toISOString().slice(0, 16).replace('T', ' ');
      const status = resolved ? `RESOLVED(result=${result})` : (Date.now() / 1000 > Number(kickoff) ? 'PAST/UNRESOLVED' : 'UPCOMING');
      const pool = `${BigInt(pH) + BigInt(pD) + BigInt(pA)} wei`;
      console.log(`ID ${i}: ${home} vs ${away}`);
      console.log(`       Kickoff: ${date} UTC | ${status} | Pool: ${pool}`);
    } catch (e) {
      console.log(`ID ${i}: ERROR - ${e.message}`);
    }
  }
}

main().catch(console.error);
