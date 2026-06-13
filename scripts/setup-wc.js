#!/usr/bin/env node
// Resolves old WC matches, deploys new WCBetting contract, and populates it with real WC 2026 fixtures.
const fs = require('fs');
const path = require('path');
const { JsonRpcProvider, Wallet, Contract, ContractFactory } = require('../node_modules/ethers');

// Load .env
const envPath = path.join(__dirname, '../.env');
const envLines = fs.readFileSync(envPath, 'utf8').split('\n');
for (const line of envLines) {
  const m = line.match(/^([^=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim();
}

const PRIVATE_KEY = process.env.PRIVATE_KEY;
const FOOTBALL_TOKEN = process.env.FOOTBALL_API_TOKEN ||
  'd393bb1aa1184d4b8ef6145564909128'; // fallback from .env.local

if (!PRIVATE_KEY) { console.error('PRIVATE_KEY missing in .env'); process.exit(1); }

const RPC = 'https://rpc.testnet.arc.network';
const OLD_CONTRACT = '0x24c2AD016280f847d49874Dd06635B4DFe85Ea6D';

const OLD_ABI = [
  'function matchCount() external view returns (uint256)',
  'function getMatch(uint256) external view returns (string,string,uint256,bool,uint8,uint256,uint256,uint256)',
  'function resolveMatch(uint256 matchId, uint8 result) external'
];

// Results for old matches (all HOME=0: Mexico/USA won; 0-pool matches don't matter)
const OLD_RESULTS = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0 };

async function fetchUpcomingMatches() {
  console.log('Fetching upcoming WC 2026 matches from football-data.org...');
  const url = 'https://api.football-data.org/v4/competitions/WC/matches?status=SCHEDULED';
  const res = await fetch(url, { headers: { 'X-Auth-Token': FOOTBALL_TOKEN } });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`API error ${res.status}: ${txt.slice(0, 200)}`);
  }
  const data = await res.json();
  const now = Math.floor(Date.now() / 1000);
  const upcoming = (data.matches || [])
    .filter(m => {
      const kickoff = Math.floor(new Date(m.utcDate).getTime() / 1000);
      return kickoff > now;
    })
    .map(m => ({
      home: m.homeTeam.name,
      away: m.awayTeam.name,
      kickoff: Math.floor(new Date(m.utcDate).getTime() / 1000)
    }));
  console.log(`Found ${upcoming.length} upcoming matches.`);
  return upcoming;
}

async function compileContract() {
  console.log('Compiling WCBetting.sol...');
  const solc = require('../node_modules/solc');
  const source = fs.readFileSync(path.join(__dirname, '../contracts/WCBetting.sol'), 'utf8');
  const input = {
    language: 'Solidity',
    sources: { 'WCBetting.sol': { content: source } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode'] } }
    }
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  if (output.errors) {
    const errs = output.errors.filter(e => e.severity === 'error');
    if (errs.length) { console.error('Compile errors:', errs); process.exit(1); }
  }
  const c = output.contracts['WCBetting.sol']['WCBetting'];
  console.log('Compile OK.');
  return { abi: c.abi, bytecode: '0x' + c.evm.bytecode.object };
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const provider = new JsonRpcProvider(RPC);
  const wallet = new Wallet(PRIVATE_KEY, provider);
  const addr = await wallet.getAddress();
  console.log('Wallet:', addr);

  // ── STEP 1: Resolve old matches ──────────────────────────────────────────
  console.log('\n── Step 1: Resolving old matches ──');
  const oldContract = new Contract(OLD_CONTRACT, OLD_ABI, wallet);
  const count = Number(await oldContract.matchCount());
  console.log(`Old contract has ${count} matches.`);

  for (let id = 0; id < count; id++) {
    const [,,,resolved] = await oldContract.getMatch(id);
    if (resolved) {
      console.log(`  ID ${id}: already resolved, skip.`);
      continue;
    }
    const result = OLD_RESULTS[id] ?? 0;
    process.stdout.write(`  ID ${id}: resolving with result=${result}... `);
    try {
      const tx = await oldContract.resolveMatch(id, result);
      await tx.wait();
      console.log(`OK (${tx.hash.slice(0,10)}...)`);
    } catch (e) {
      console.log(`FAIL: ${e.message.slice(0, 80)}`);
    }
    await sleep(500);
  }

  // ── STEP 2: Compile ──────────────────────────────────────────────────────
  console.log('\n── Step 2: Compiling WCBetting.sol ──');
  const { abi, bytecode } = await compileContract();

  // ── STEP 3: Deploy new contract ──────────────────────────────────────────
  console.log('\n── Step 3: Deploying new WCBetting contract ──');
  const factory = new ContractFactory(abi, bytecode, wallet);
  const deployTx = await factory.deploy();
  await deployTx.waitForDeployment();
  const newAddress = await deployTx.getAddress();
  console.log('New contract deployed:', newAddress);

  // ── STEP 4: Add upcoming matches ─────────────────────────────────────────
  console.log('\n── Step 4: Fetching and adding upcoming matches ──');
  const matches = await fetchUpcomingMatches();
  const newContract = new Contract(newAddress, abi, wallet);

  if (matches.length === 0) {
    console.log('No upcoming matches to add!');
  }

  for (let i = 0; i < matches.length; i++) {
    const { home, away, kickoff } = matches[i];
    const date = new Date(kickoff * 1000).toISOString().slice(0, 16).replace('T', ' ');
    process.stdout.write(`  [${i+1}/${matches.length}] ${home} vs ${away} @ ${date} UTC... `);
    try {
      const tx = await newContract.addMatch(home, away, kickoff);
      await tx.wait();
      console.log('OK');
    } catch (e) {
      console.log(`FAIL: ${e.message.slice(0, 80)}`);
    }
    await sleep(400);
  }

  // ── STEP 5: Update contract address in source files ──────────────────────
  console.log('\n── Step 5: Updating contract address in source files ──');
  const files = [
    path.join(__dirname, '../frontend/index.html'),
    path.join(__dirname, '../frontend/api/leaderboard.js'),
    path.join(__dirname, '../frontend/api/resolve-wc.js'),
  ];

  for (const f of files) {
    if (!fs.existsSync(f)) { console.log(`  SKIP (not found): ${f}`); continue; }
    let content = fs.readFileSync(f, 'utf8');
    const updated = content.replace(/0x24c2AD016280f847d49874Dd06635B4DFe85Ea6D/g, newAddress);
    if (updated !== content) {
      fs.writeFileSync(f, updated, 'utf8');
      console.log(`  Updated: ${path.basename(f)}`);
    } else {
      console.log(`  No address found in: ${path.basename(f)}`);
    }
  }

  console.log('\n═══════════════════════════════════════');
  console.log('NEW CONTRACT ADDRESS:', newAddress);
  console.log('═══════════════════════════════════════');
  console.log('\nNext: commit the updated files and run `vercel --prod`');
}

main().catch(e => { console.error(e); process.exit(1); });
