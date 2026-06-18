// Runs auto-resolve locally against all expired unresolved predictions
// Usage: node resolve-all.js
require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const { ethers } = require('ethers');

const { detectCategory, resolveCrypto, resolveSports, resolveNews } = require('./frontend/api/auto-resolve');

const CONTRACT_ADDRESS = '0xad1BDA8570C867A43e427ae2f6a9721Ac1b89975';
const ABI = [
  'function getPrediction(uint256 id) view returns (string question, uint256 deadline, bool resolved, bool result, uint256 totalYes, uint256 totalNo)',
  'function predictionCount() view returns (uint256)',
  'function resolvePrediction(uint256 predictionId, bool result) external',
];
const RPC_URL = 'https://rpc.testnet.arc.network';

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, wallet);
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const total = Number(await contract.predictionCount());
  const now = Math.floor(Date.now() / 1000);
  console.log(`\nTotal predictions: ${total}`);

  // Fetch all in small batches
  const all = [];
  for (let i = 0; i < total; i += 5) {
    const ids = Array.from({ length: Math.min(5, total - i) }, (_, j) => i + j);
    const batch = await Promise.all(ids.map(id =>
      contract.getPrediction(id)
        .then(([question, deadline, isResolved, result, yes, no]) =>
          ({ id, question, deadline: Number(deadline), isResolved, yes: BigInt(yes), no: BigInt(no) }))
        .catch(() => null)
    ));
    all.push(...batch.filter(Boolean));
  }

  const pending = all
    .filter(p => !p.isResolved && p.deadline <= now)
    .sort((a, b) => {
      const aS = a.yes + a.no > 0n ? 1 : 0;
      const bS = b.yes + b.no > 0n ? 1 : 0;
      return bS !== aS ? bS - aS : a.deadline - b.deadline;
    });

  console.log(`Expired unresolved: ${pending.length}\n`);

  let resolved = 0, inconclusive = 0, errors = 0;
  const manual = [];

  for (const pred of pending) {
    const { id, question, deadline } = pred;
    const category = detectCategory(question);
    process.stdout.write(`[${id}] ${category.toUpperCase()} | ${question.slice(0, 65)}... `);

    let resolution;
    try {
      if (category === 'kripto') resolution = await resolveCrypto(question, deadline);
      else if (category === 'spor') resolution = await resolveSports(question, deadline, anthropic);
      else resolution = await resolveNews(question, category, anthropic);
    } catch (err) {
      console.log(`RESOLVER ERROR: ${err.message.slice(0, 80)}`);
      errors++;
      continue;
    }

    const { result, reason, source } = resolution;

    if (result === null) {
      console.log(`INCONCLUSIVE [${source}]`);
      console.log(`    ${reason.slice(0, 120)}`);
      inconclusive++;
      manual.push({ id, category, question: question.slice(0, 80) });
      continue;
    }

    try {
      const tx = await contract.resolvePrediction(id, result);
      await tx.wait();
      console.log(`${result ? 'YES ✅' : 'NO ❌'} [${source}]`);
      console.log(`    ${reason.slice(0, 120)}`);
      resolved++;
    } catch (err) {
      console.log(`TX ERROR: ${err.reason || err.message.slice(0, 80)}`);
      errors++;
    }
  }

  console.log('\n' + '═'.repeat(70));
  console.log(`DONE — Resolved: ${resolved} | Inconclusive: ${inconclusive} | Errors: ${errors}`);
  if (manual.length) {
    console.log('\nNeeds manual resolution:');
    manual.forEach(e => console.log(`  [${e.id}] ${e.category}: ${e.question}`));
  }
}

main().catch(console.error);
