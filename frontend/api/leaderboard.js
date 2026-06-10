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

// Arc testnet RPC eth_getLogs'u 10.000 blokluk aralikla sinirliyor —
// kontrat deploy blogundan itibaren parcali tarama yapiyoruz.
const DEPLOY_BLOCK = 46186575;
const CHUNK = 10000;
const BATCH = 10;

async function getAllLogs(provider, address, latest) {
  const ranges = [];
  for (let b = DEPLOY_BLOCK; b <= latest; b += CHUNK) {
    ranges.push([b, Math.min(b + CHUNK - 1, latest)]);
  }
  const logs = [];
  for (let i = 0; i < ranges.length; i += BATCH) {
    const results = await Promise.all(
      ranges.slice(i, i + BATCH).map(([fromBlock, toBlock]) =>
        provider.getLogs({ address, fromBlock, toBlock }).catch(() => [])
      )
    );
    results.forEach(r => logs.push(...r));
  }
  return logs;
}

function parseEvents(logs, iface, eventName) {
  const out = [];
  for (const log of logs) {
    try {
      const parsed = iface.parseLog(log);
      if (parsed && parsed.name === eventName) out.push(parsed);
    } catch { /* baska event, atla */ }
  }
  return out;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');

  try {
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const contract   = new ethers.Contract(CONTRACT_ADDRESS,    PREDICT_ABI, provider);
    const wcContract = new ethers.Contract(WC_CONTRACT_ADDRESS, WC_ABI,      provider);

    // Collect unique bettors from events (chunked log scan)
    const latest = await provider.getBlockNumber();
    const [predictLogs, wcLogs] = await Promise.all([
      getAllLogs(provider, CONTRACT_ADDRESS, latest),
      getAllLogs(provider, WC_CONTRACT_ADDRESS, latest)
    ]);
    const predictBets = parseEvents(predictLogs, contract.interface,   'BetPlaced');
    const wcBets      = parseEvents(wcLogs,      wcContract.interface, 'BetPlaced');
    const wcClaimed   = parseEvents(wcLogs,      wcContract.interface, 'WinningsClaimed');

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
