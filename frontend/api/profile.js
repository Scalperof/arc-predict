const { ethers } = require('ethers');
const { getEventCache, CONTRACT_ADDRESS, WC_CONTRACT_ADDRESS, RPC_URL } = require('./_lib/chain');

const PRED_ABI = [
  'function getPrediction(uint256 id) view returns (string question, uint256 deadline, bool resolved, bool result, uint256 totalYes, uint256 totalNo)',
  'function getUserBets(uint256 predictionId, address user) view returns (uint256 yesAmount, uint256 noAmount, bool claimed)'
];
const WC_ABI = [
  'function getMatch(uint256 matchId) view returns (string homeTeam, string awayTeam, uint256 kickoff, bool resolved, uint8 result, uint256 poolHome, uint256 poolDraw, uint256 poolAway)',
  'function getUserBet(uint256 matchId, address user) view returns (uint256 home, uint256 draw, uint256 away, bool claimed)'
];

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=90, stale-while-revalidate=60');

  const address = req.query.address;
  if (!address || !ethers.isAddress(address)) {
    return res.status(400).json({ ok: false, error: 'Geçersiz adres' });
  }

  const addrLower = address.toLowerCase();

  try {
    const t0 = Date.now();
    const { pred, wc, latestBlock } = await getEventCache();
    const scanMs = Date.now() - t0;

    const predIds  = [...new Set(pred.filter(e => e.bettor === addrLower).map(e => e.id))];
    const matchIds = [...new Set(wc.filter(e => e.user === addrLower).map(e => e.matchId))];

    const provider   = new ethers.JsonRpcProvider(RPC_URL);
    const contract   = new ethers.Contract(CONTRACT_ADDRESS,    PRED_ABI, provider);
    const wcContract = new ethers.Contract(WC_CONTRACT_ADDRESS, WC_ABI,   provider);

    const [predItems, matchItems] = await Promise.all([
      Promise.all(predIds.map(async i => {
        try {
          const [[q, deadline, resolved, result, totalYes, totalNo], [yesAmt, noAmt, claimed]] =
            await Promise.all([contract.getPrediction(i), contract.getUserBets(i, address)]);
          const userYes = Number(BigInt(yesAmt));
          const userNo  = Number(BigInt(noAmt));
          if (userYes === 0 && userNo === 0) return null;
          const totalPool = Number(BigInt(totalYes)) + Number(BigInt(totalNo));
          let winnings = 0, status = 'pending';
          if (resolved) {
            const won = (result && userYes > 0) || (!result && userNo > 0);
            if (won) {
              const winPool = result ? Number(BigInt(totalYes)) : Number(BigInt(totalNo));
              const userBet = result ? userYes : userNo;
              winnings = (userBet * totalPool * 98) / (winPool * 100);
              status = 'win';
            } else { status = 'loss'; }
          }
          return {
            type: 'pred', id: i, q: String(q), deadline: Number(deadline),
            resolved, result, status,
            userBetTotal: (userYes + userNo) / 1e18,
            winnings: winnings / 1e18, claimed
          };
        } catch { return null; }
      })),
      Promise.all(matchIds.map(async i => {
        try {
          const [m, ub] = await Promise.all([
            wcContract.getMatch(i),
            wcContract.getUserBet(i, address)
          ]);
          const uHome = Number(ub[0]), uDraw = Number(ub[1]), uAway = Number(ub[2]);
          if (uHome === 0 && uDraw === 0 && uAway === 0) return null;
          const resolved = m[3], result = Number(m[4]);
          const totalPool = Number(m[5]) + Number(m[6]) + Number(m[7]);
          let winnings = 0, status = 'pending';
          if (resolved) {
            const userAmt = result === 0 ? uHome : result === 1 ? uDraw : uAway;
            const winPool = result === 0 ? Number(m[5]) : result === 1 ? Number(m[6]) : Number(m[7]);
            if (userAmt > 0) {
              winnings = (userAmt * totalPool * 98) / (winPool * 100);
              status = 'win';
            } else { status = 'loss'; }
          }
          return {
            type: 'match', id: i, q: `${m[0]} vs ${m[1]}`, kickoff: Number(m[2]),
            resolved, result, status,
            userBetTotal: (uHome + uDraw + uAway) / 1e18,
            winnings: winnings / 1e18, claimed: ub[3]
          };
        } catch { return null; }
      }))
    ]);

    const items = [...predItems, ...matchItems].filter(Boolean);
    return res.status(200).json({
      ok: true,
      items,
      meta: { scanMs, latestBlock, predIds: predIds.length, matchIds: matchIds.length }
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
};
