const { ethers } = require('ethers');

const CONTRACT_ADDRESS    = "0xad1BDA8570C867A43e427ae2f6a9721Ac1b89975";
const WC_CONTRACT_ADDRESS = "0x24c2AD016280f847d49874Dd06635B4DFe85Ea6D";
const RPC_URL = "https://rpc.testnet.arc.network";

const PREDICT_ABI = [
  "event BetPlaced(uint256 indexed id, address indexed bettor, bool isYes, uint256 amount)",
  "event WinningsClaimed(uint256 indexed id, address indexed winner, uint256 amount)",
  "function predictionCount() view returns (uint256)",
  "function getPrediction(uint256 id) view returns (string question, uint256 deadline, bool resolved, bool result, uint256 totalYes, uint256 totalNo)",
  "function getUserBets(uint256 predictionId, address user) view returns (uint256 yesAmount, uint256 noAmount, bool claimed)",
  "function getProfile(address user) view returns (string username, uint256 totalBets, uint256 wins, uint256 losses, uint256 totalWinnings)"
];

const WC_ABI = [
  "event BetPlaced(uint256 indexed matchId, address indexed user, uint8 outcome, uint256 amount)",
  "event WinningsClaimed(uint256 indexed matchId, address indexed user, uint256 amount)",
  "function matchCount() view returns (uint256)",
  "function getMatch(uint256 matchId) view returns (string homeTeam, string awayTeam, uint256 kickoff, bool resolved, uint8 result, uint256 poolHome, uint256 poolDraw, uint256 poolAway)",
  "function getUserBet(uint256 matchId, address user) view returns (uint256 home, uint256 draw, uint256 away, bool claimed)"
];

async function safeQueryFilter(contract, filter) {
  try {
    // Try limited block range first (last 100k blocks)
    const provider = contract.runner?.provider || contract.provider;
    let toBlock = 'latest';
    let fromBlock = 0;
    if (provider) {
      try {
        const latest = await provider.getBlockNumber();
        fromBlock = Math.max(0, latest - 100000);
        toBlock = latest;
      } catch (_) {}
    }
    return await contract.queryFilter(filter, fromBlock, toBlock);
  } catch (err) {
    // Fallback: try from block 0 with no range
    try {
      return await contract.queryFilter(filter);
    } catch (_) {
      return [];
    }
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');

  try {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const contract   = new ethers.Contract(CONTRACT_ADDRESS,    PREDICT_ABI, provider);
    const wcContract = new ethers.Contract(WC_CONTRACT_ADDRESS, WC_ABI,      provider);

    // Collect unique bettors from events (with fallback)
    const [predictBets, wcBets, wcClaimed] = await Promise.all([
      safeQueryFilter(contract,   contract.filters.BetPlaced()),
      safeQueryFilter(wcContract, wcContract.filters.BetPlaced()),
      safeQueryFilter(wcContract, wcContract.filters.WinningsClaimed())
    ]);

    // WC winnings from WinningsClaimed events
    const wcWinningsMap = {};
    for (const e of wcClaimed) {
      const addr = e.args.user.toLowerCase();
      wcWinningsMap[addr] = (wcWinningsMap[addr] || 0n) + BigInt(e.args.amount);
    }

    // Unique addresses (case-insensitive dedup)
    const addrSet = new Map();
    for (const e of predictBets) {
      const a = e.args.bettor;
      addrSet.set(a.toLowerCase(), a);
    }
    for (const e of wcBets) {
      const a = e.args.user;
      addrSet.set(a.toLowerCase(), a);
    }

    const addresses = [...addrSet.values()];

    if (!addresses.length) {
      // No events found — return empty leaderboard gracefully
      return res.status(200).json({
        ok: true,
        leaderboard: [],
        note: `events: predict=${predictBets.length} wc=${wcBets.length}`
      });
    }

    // Fetch on-chain profiles
    const profiles = await Promise.all(
      addresses.map(async (addr) => {
        try {
          const p = await contract.getProfile(addr);
          const wcWon = wcWinningsMap[addr.toLowerCase()] || 0n;
          const totalWinnings = Number(BigInt(p[4]) + wcWon) / 1e18;
          const totalBets = Number(p[1]);
          const wins = Number(p[2]);
          const resolved = wins + Number(p[3]);
          const accuracy = resolved > 0 ? Math.round((wins / resolved) * 100) : 0;
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
      .filter(p => p.totalBets > 0 || p.totalWinnings > 0)
      .sort((a, b) => b.totalWinnings - a.totalWinnings)
      .slice(0, 20);

    return res.status(200).json({
      ok: true,
      leaderboard,
      note: `events: predict=${predictBets.length} wc=${wcBets.length}`
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message, stack: err.stack?.slice(0, 400) });
  }
};
