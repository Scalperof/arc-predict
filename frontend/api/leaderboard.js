const { ethers } = require('ethers');

const CONTRACT_ADDRESS = "0xad1BDA8570C867A43e427ae2f6a9721Ac1b89975";
const WC_CONTRACT_ADDRESS = "0x24c2AD016280f847d49874Dd06635B4DFe85Ea6D";
const RPC_URL = "https://rpc.testnet.arc.network";

const PREDICT_ABI = [
  "event BetPlaced(uint256 indexed id, address indexed bettor, bool isYes, uint256 amount)",
  "event WinningsClaimed(uint256 indexed id, address indexed winner, uint256 amount)",
  "function getProfile(address user) view returns (string username, uint256 totalBets, uint256 wins, uint256 losses, uint256 totalWinnings)"
];

const WC_ABI = [
  "event BetPlaced(uint256 indexed matchId, address indexed user, uint8 outcome, uint256 amount)",
  "event WinningsClaimed(uint256 indexed matchId, address indexed user, uint256 amount)"
];

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');

  try {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const contract = new ethers.Contract(CONTRACT_ADDRESS, PREDICT_ABI, provider);
    const wcContract = new ethers.Contract(WC_CONTRACT_ADDRESS, WC_ABI, provider);

    const [predictBets, wcBets, wcClaimed] = await Promise.all([
      contract.queryFilter(contract.filters.BetPlaced()),
      wcContract.queryFilter(wcContract.filters.BetPlaced()),
      wcContract.queryFilter(wcContract.filters.WinningsClaimed())
    ]);

    const addresses = new Set([
      ...predictBets.map(e => e.args.bettor),
      ...wcBets.map(e => e.args.user)
    ]);

    // WC kazanımlarını event'lerden hesapla
    const wcWinningsMap = {};
    for (const e of wcClaimed) {
      const addr = e.args.user.toLowerCase();
      wcWinningsMap[addr] = (wcWinningsMap[addr] || 0n) + BigInt(e.args.amount);
    }

    // WC bahis sayısı adres başına
    const wcBetCountMap = {};
    for (const e of wcBets) {
      const addr = e.args.user.toLowerCase();
      wcBetCountMap[addr] = (wcBetCountMap[addr] || 0) + 1;
    }

    const profiles = await Promise.all(
      [...addresses].map(async (addr) => {
        try {
          const p = await contract.getProfile(addr);
          const wcWon = wcWinningsMap[addr.toLowerCase()] || 0n;
          const totalWinnings = Number(BigInt(p[4]) + wcWon) / 1e18;
          const wcBetCount = wcBetCountMap[addr.toLowerCase()] || 0;
          const totalBets = Number(p[1]) + wcBetCount;
          const wins = Number(p[2]);
          const accuracy = totalBets > 0 ? Math.round((wins / totalBets) * 100) : 0;
          return {
            address: addr,
            username: p[0] || '',
            totalBets,
            wins,
            totalWinnings,
            accuracy
          };
        } catch {
          return null;
        }
      })
    );

    const leaderboard = profiles
      .filter(Boolean)
      .filter(p => p.totalBets > 0)
      .sort((a, b) => b.totalWinnings - a.totalWinnings)
      .slice(0, 20);

    return res.status(200).json({ ok: true, leaderboard });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
};
