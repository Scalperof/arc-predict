const { JsonRpcProvider, Contract } = require('../node_modules/ethers');
const p = new JsonRpcProvider('https://rpc.testnet.arc.network');
const c = new Contract('0xad1BDA8570C867A43e427ae2f6a9721Ac1b89975', [
  'function getPrediction(uint256 id) view returns (string question, uint256 deadline, bool resolved, bool result, uint256 totalYes, uint256 totalNo)',
  'function predictionCount() view returns (uint256)'
], p);

async function main() {
  const total = Number(await c.predictionCount());
  const now = Math.floor(Date.now() / 1000);
  console.log('Total predictions:', total, '| now:', new Date().toISOString());

  let pending = 0, future = 0, resolved = 0;
  for (let id = 0; id < total; id++) {
    try {
      const [q, deadline, isResolved, result, yes, no] = await c.getPrediction(id);
      if (isResolved) { resolved++; continue; }
      if (Number(deadline) > now) { future++; continue; }
      pending++;
      const d = new Date(Number(deadline)*1000).toISOString().slice(0,16).replace('T',' ');
      const yesEth = (BigInt(yes) / BigInt(1e15)).toString().padStart(6);
      const noEth = (BigInt(no) / BigInt(1e15)).toString().padStart(6);
      console.log(`[${String(id).padStart(3)}] dl:${d} yes:${yesEth}m no:${noEth}m | ${q.slice(0,80)}`);
    } catch(e) { console.log(`[${id}] ERR: ${e.message}`); }
  }
  console.log(`\nSummary: ${resolved} resolved | ${pending} pending-past | ${future} future`);
}
main().catch(console.error);
