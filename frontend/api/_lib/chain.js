/**
 * Paylaşılan event tarama + in-memory cache modülü.
 * Aynı Lambda instance içinde tekrar çağrıldığında
 * TTL dolmamışsa RPC sorgusu yapmadan önbellekten döner.
 */
const { ethers } = require('ethers');

const CONTRACT_ADDRESS    = '0xad1BDA8570C867A43e427ae2f6a9721Ac1b89975';
const WC_CONTRACT_ADDRESS = '0x24c2AD016280f847d49874Dd06635B4DFe85Ea6D';
const RPC_URL      = 'https://rpc.testnet.arc.network';
const DEPLOY_BLOCK = 46186575;
const CHUNK        = 10000;
const BATCH        = 10; // leaderboard.js ile aynı
const CACHE_TTL    = 90_000; // 90 sn

const PRED_IFACE = new ethers.Interface([
  'event BetPlaced(uint256 indexed id, address indexed bettor, bool isYes, uint256 amount)'
]);
const WC_IFACE = new ethers.Interface([
  'event BetPlaced(uint256 indexed matchId, address indexed user, uint8 outcome, uint256 amount)'
]);

// Modül-level cache — aynı warm Lambda instance'ında paylaşılır
let _cache = null; // { ts, latestBlock, pred: [{id, bettor}], wc: [{matchId, user}] }

async function getAllLogs(provider, address, latest) {
  const ranges = [];
  for (let b = DEPLOY_BLOCK; b <= latest; b += CHUNK)
    ranges.push([b, Math.min(b + CHUNK - 1, latest)]);
  const logs = [];
  for (let i = 0; i < ranges.length; i += BATCH) {
    const results = await Promise.all(
      ranges.slice(i, i + BATCH).map(([f, t]) =>
        provider.getLogs({ address, fromBlock: f, toBlock: t }).catch(() => [])
      )
    );
    results.forEach(r => logs.push(...r));
  }
  return logs;
}

async function getEventCache() {
  if (_cache && Date.now() - _cache.ts < CACHE_TTL) return _cache;

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const latest = await provider.getBlockNumber();

  const [predLogs, wcLogs] = await Promise.all([
    getAllLogs(provider, CONTRACT_ADDRESS, latest),
    getAllLogs(provider, WC_CONTRACT_ADDRESS, latest)
  ]);

  const pred = [];
  for (const log of predLogs) {
    try {
      const p = PRED_IFACE.parseLog(log);
      if (p) pred.push({ id: Number(p.args.id), bettor: p.args.bettor.toLowerCase() });
    } catch {}
  }

  const wc = [];
  for (const log of wcLogs) {
    try {
      const p = WC_IFACE.parseLog(log);
      if (p) wc.push({ matchId: Number(p.args.matchId), user: p.args.user.toLowerCase() });
    } catch {}
  }

  _cache = { ts: Date.now(), latestBlock: latest, pred, wc };
  return _cache;
}

module.exports = { getEventCache, CONTRACT_ADDRESS, WC_CONTRACT_ADDRESS, RPC_URL };
