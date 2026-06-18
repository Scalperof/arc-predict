'use strict';
// Dry-run test: fetch predictions #16, #42, #67 from chain and run resolvers.
// No blockchain writes — just logs what each resolver would decide.
// Usage: node scripts/test-resolvers.js
const path = require('path');
const fs = require('fs');

// Load .env
const envPath = path.join(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([^=#][^=]*)=(.*)$/);
    if (m) process.env[m[1].trim()] = m[2].trim();
  }
}

const { JsonRpcProvider, Contract } = require('ethers');
const Anthropic = require('@anthropic-ai/sdk');
const { detectCategory, resolveCrypto, resolveSports, resolveNews } = require('../frontend/api/auto-resolve');

const CONTRACT_ADDRESS = '0xad1BDA8570C867A43e427ae2f6a9721Ac1b89975';
const ABI = [
  'function getPrediction(uint256 id) view returns (string question, uint256 deadline, bool resolved, bool result, uint256 totalYes, uint256 totalNo)',
];

async function runTest(id, question, deadline, alreadyResolved, actualResult) {
  const category = detectCategory(question);
  const label = alreadyResolved
    ? `(already resolved → ${actualResult ? 'true ✅' : 'false ❌'})`
    : '(unresolved — pending)';

  console.log('\n' + '═'.repeat(72));
  console.log(`[${id}] ${label}`);
  console.log(`Q: ${question}`);
  console.log(`CATEGORY: ${category.toUpperCase()} | deadline: ${new Date(deadline * 1000).toISOString().slice(0, 16)}`);
  console.log('─'.repeat(72));

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  let resolution;

  const t0 = Date.now();
  if (category === 'kripto') {
    resolution = await resolveCrypto(question, deadline);
  } else if (category === 'spor') {
    resolution = await resolveSports(question, deadline, anthropic);
  } else {
    resolution = await resolveNews(question, category, anthropic);
  }
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  const { result, reason, source } = resolution;
  const decision = result === null ? 'INCONCLUSIVE' : result ? 'YES ✅' : 'NO ❌';
  console.log(`RESOLVER: ${source} (${elapsed}s)`);
  console.log(`DECISION: ${decision}`);
  console.log(`REASON:   ${reason}`);

  if (alreadyResolved && result !== null) {
    const match = result === actualResult;
    console.log(`VALIDATE: ${match ? '✅ CORRECT (matches on-chain result)' : '❌ WRONG — resolver says ' + result + ' but chain says ' + actualResult}`);
  }
}

async function main() {
  const provider = new JsonRpcProvider('https://rpc.testnet.arc.network');
  const contract = new Contract(CONTRACT_ADDRESS, ABI, provider);

  console.log('Fetching predictions #16, #42, #67 from Arc testnet...');
  const ids = [16, 42, 67];
  const preds = await Promise.all(ids.map(id =>
    contract.getPrediction(id)
      .then(([question, deadline, isResolved, result]) => ({
        id, question, deadline: Number(deadline), isResolved, result,
      }))
  ));

  for (const p of preds) {
    await runTest(p.id, p.question, p.deadline, p.isResolved, p.result);
  }

  console.log('\n' + '═'.repeat(72));
  console.log('Done. No blockchain writes were made.');
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
