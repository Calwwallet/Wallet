#!/usr/bin/env node

/**
 * 🦞 CLAW Agent Wallet CLI v0.5.0
 *
 * A rich, colorful command-line interface for managing
 * AI agent wallets, identities, and ENS names.
 */

// ============================================================
// ANSI STYLING — zero dependencies
// ============================================================
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
  underline: '\x1b[4m',
  // Colors
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
  // Bright
  brightRed: '\x1b[91m',
  brightGreen: '\x1b[92m',
  brightYellow: '\x1b[93m',
  brightCyan: '\x1b[96m',
  brightWhite: '\x1b[97m',
  // BG
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
  bgMagenta: '\x1b[45m',
  bgCyan: '\x1b[46m',
};

const ok = (msg) => console.log(`  ${c.green}✅ ${msg}${c.reset}`);
const err = (msg) => console.log(`  ${c.red}❌ ${msg}${c.reset}`);
const warn = (msg) => console.log(`  ${c.yellow}⚠️  ${msg}${c.reset}`);
const info = (msg) => console.log(`  ${c.cyan}ℹ  ${msg}${c.reset}`);
const dim = (msg) => console.log(`  ${c.gray}${msg}${c.reset}`);
const label = (key, val) => console.log(`  ${c.gray}${key}:${c.reset} ${c.brightWhite}${val}${c.reset}`);

// Spinner
async function withSpinner(text, fn) {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let i = 0;
  const id = setInterval(() => {
    process.stdout.write(`\r  ${c.cyan}${frames[i++ % frames.length]} ${text}${c.reset}`);
  }, 80);
  try {
    const result = await fn();
    clearInterval(id);
    process.stdout.write(`\r  ${c.green}✅ ${text}${c.reset}\n`);
    return result;
  } catch (e) {
    clearInterval(id);
    process.stdout.write(`\r  ${c.red}❌ ${text}${c.reset}\n`);
    throw e;
  }
}

// Box drawing
function drawBox(title, lines) {
  const maxLen = Math.max(title.length, ...lines.map(l => stripAnsi(l).length)) + 2;
  const pad = (s, len) => s + ' '.repeat(Math.max(0, len - stripAnsi(s).length));
  console.log(`  ${c.cyan}╭${'─'.repeat(maxLen + 2)}╮${c.reset}`);
  console.log(`  ${c.cyan}│${c.reset} ${c.bold}${c.brightWhite}${pad(title, maxLen)}${c.reset} ${c.cyan}│${c.reset}`);
  console.log(`  ${c.cyan}├${'─'.repeat(maxLen + 2)}┤${c.reset}`);
  lines.forEach(line => {
    console.log(`  ${c.cyan}│${c.reset} ${pad(line, maxLen)} ${c.cyan}│${c.reset}`);
  });
  console.log(`  ${c.cyan}╰${'─'.repeat(maxLen + 2)}╯${c.reset}`);
}

function stripAnsi(str) {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

// Table
function drawTable(headers, rows) {
  const colWidths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map(r => String(r[i] || '').length))
  );
  const line = `  ${c.gray}${'─'.repeat(colWidths.reduce((a, b) => a + b + 3, 1))}${c.reset}`;
  const headerRow = headers.map((h, i) => `${c.bold}${c.cyan}${h.padEnd(colWidths[i])}${c.reset}`).join(` ${c.gray}│${c.reset} `);
  console.log(line);
  console.log(`  ${c.gray} ${c.reset} ${headerRow}`);
  console.log(line);
  rows.forEach(row => {
    const rowStr = row.map((cell, i) => String(cell || '').padEnd(colWidths[i])).join(` ${c.gray}│${c.reset} `);
    console.log(`  ${c.gray} ${c.reset} ${rowStr}`);
  });
  console.log(line);
}

// ============================================================
// CONFIG & API HELPERS
// ============================================================
const API = process.env.CLAW_API_URL || 'http://localhost:3000';
const API_KEY = process.env.CLAW_API_KEY || '';

function headers(extra = {}) {
  const h = { 'Content-Type': 'application/json', ...extra };
  if (API_KEY) h['X-API-Key'] = API_KEY;
  return h;
}

async function api(path, opts = {}) {
  try {
    const res = await fetch(`${API}${path}`, { ...opts, headers: headers(opts.headers) });
    const data = await res.json();
    if (!res.ok && !data.error) data.error = `HTTP ${res.status}`;
    return data;
  } catch (e) {
    if (e.cause?.code === 'ECONNREFUSED') {
      return { error: `Cannot connect to ${API}. Is the server running? (npm start)` };
    }
    return { error: e.message };
  }
}

async function apiPost(path, body) {
  return api(path, { method: 'POST', body: JSON.stringify(body) });
}

// ============================================================
// BANNER
// ============================================================
function banner() {
  const gradient = [c.red, c.brightRed, c.yellow, c.brightYellow, c.green, c.brightGreen, c.cyan, c.brightCyan, c.blue, c.magenta];
  const art = [
    '   ██████╗██╗      █████╗ ██╗    ██╗',
    '  ██╔════╝██║     ██╔══██╗██║    ██║',
    '  ██║     ██║     ███████║██║ █╗ ██║',
    '  ██║     ██║     ██╔══██║██║███╗██║',
    '  ╚██████╗███████╗██║  ██║╚███╔███╔╝',
    '   ╚═════╝╚══════╝╚═╝  ╚═╝ ╚══╝╚══╝ ',
  ];
  console.log('');
  art.forEach((line, i) => {
    console.log(`  ${gradient[i % gradient.length]}${line}${c.reset}`);
  });
  console.log(`  ${c.gray}${'─'.repeat(38)}${c.reset}`);
  console.log(`  ${c.dim}Agent Wallet CLI${c.reset}  ${c.cyan}v0.5.0${c.reset}  ${c.gray}│${c.reset}  ${c.dim}Made with${c.reset} ${c.red}♥${c.reset} ${c.dim}by Mr. Claw${c.reset}`);
  console.log('');
}

// ============================================================
// COMMANDS
// ============================================================

async function cmdHelp() {
  banner();
  const section = (title) => console.log(`  ${c.bold}${c.brightCyan}${title}${c.reset}`);
  const cmd = (name, alias, desc) => {
    const aliasStr = alias ? `${c.yellow}${alias}${c.reset}` : '';
    console.log(`    ${c.green}${name.padEnd(30)}${c.reset} ${aliasStr.padEnd(alias ? 18 : 8)} ${c.gray}${desc}${c.reset}`);
  };

  console.log(`  ${c.dim}Command${' '.repeat(25)}Shortcut${' '.repeat(3)}Description${c.reset}`);
  console.log(`  ${c.gray}${'─'.repeat(70)}${c.reset}`);

  section('🪙  WALLET');
  cmd('create <name> [chain]', 'new', 'Create a new wallet');
  cmd('import <key> <name> [chain]', '', 'Import from private key');
  cmd('list', 'ls', 'List all wallets');
  cmd('balance <address> [chain]', 'bal', 'Check balance');
  cmd('balances <address>', 'bals', 'Balance across all chains');
  cmd('send <from> <to> <val> [chain]', 's', 'Send ETH');
  cmd('sweep <from> <to> [chain]', '', 'Transfer all funds');
  cmd('estimate <from> <to> [val]', 'gas', 'Estimate gas cost');
  cmd('tx <hash> [chain]', '', 'Transaction status');
  cmd('chains', 'c', 'List supported chains');
  console.log('');

  section('🤖  IDENTITY (ERC-8004)');
  cmd('identity create <w> <name>', 'id new', 'Create agent identity');
  cmd('identity list', 'id ls', 'List all identities');
  cmd('identity get <agentId>', 'id <id>', 'Get identity details');
  cmd('identity wallet <addr>', 'id w', 'Identities by wallet');
  console.log('');

  section('🌐  ENS');
  cmd('ens check <name>', '', 'Check name availability');
  cmd('ens price <name> [years]', '', 'Get registration price');
  cmd('ens list', '', 'List registrations');
  console.log('');

  section('🔧  TOOLS');
  cmd('demo', '', 'Run interactive demo');
  cmd('doctor', 'doc', 'Run diagnostics');
  cmd('help', 'h', 'Show this help');
  console.log('');

  console.log(`  ${c.dim}💡 Examples:${c.reset}`);
  console.log(`     ${c.cyan}claw new MyCoolBot${c.reset}          ${c.gray}Create a wallet${c.reset}`);
  console.log(`     ${c.cyan}claw ls${c.reset}                     ${c.gray}List all wallets${c.reset}`);
  console.log(`     ${c.cyan}claw bal 0x4CE...${c.reset}           ${c.gray}Check a balance${c.reset}`);
  console.log(`     ${c.cyan}claw id ls${c.reset}                  ${c.gray}List identities${c.reset}`);
  console.log('');

  if (!API_KEY) {
    console.log(`  ${c.bgYellow}${c.bold} TIP ${c.reset} ${c.yellow}Set your API key:${c.reset}`);
    console.log(`       ${c.dim}export CLAW_API_KEY=sk_live_your_key_here${c.reset}`);
    console.log('');
  }
}

async function cmdCreate(name, chain = 'base-sepolia') {
  if (!name) {
    err('Usage: create <name> [chain]');
    dim('Example: node cli.js create MrClaw base-sepolia');
    return;
  }
  const result = await withSpinner(`Creating wallet for ${c.bold}${name}${c.reset}${c.cyan} on ${chain}`, () =>
    apiPost('/wallet/create', { agentName: name, chain })
  );
  if (result.success) {
    drawBox('🎉 Wallet Created', [
      `${c.gray}Address:${c.reset}  ${c.brightGreen}${result.wallet.address}${c.reset}`,
      `${c.gray}ID:${c.reset}       ${result.wallet.id}`,
      `${c.gray}Chain:${c.reset}    ${chain}`,
    ]);
    console.log('');
    info(`Fund it → ${c.underline}https://faucet.circle.com/${c.reset}`);
  } else {
    err(result.error);
  }
}

async function cmdImport(privateKey, name, chain) {
  if (!privateKey || !name) {
    err('Usage: import <privateKey> <name> [chain]');
    return;
  }
  const result = await withSpinner('Importing wallet', () =>
    apiPost('/wallet/import', { privateKey, agentName: name, chain })
  );
  if (result.success) {
    drawBox('🔑 Wallet Imported', [
      `${c.gray}Address:${c.reset}  ${c.brightGreen}${result.wallet.address}${c.reset}`,
      `${c.gray}Imported:${c.reset} ${result.wallet.imported ? 'Yes (new)' : 'Already existed'}`,
    ]);
  } else {
    err(result.error);
  }
}

async function cmdList() {
  const result = await withSpinner('Fetching wallets', () => api('/wallet/list'));
  if (result.error) { err(result.error); return; }
  if (!result.wallets?.length) { warn('No wallets found. Create one with: create <name>'); return; }

  console.log(`\n  ${c.bold}Found ${c.brightCyan}${result.count}${c.reset}${c.bold} wallet(s)${c.reset}\n`);
  drawTable(
    ['#', 'Name', 'Address', 'Chain'],
    result.wallets.map((w, i) => [
      `${c.gray}${i + 1}${c.reset}`,
      `${c.brightWhite}${w.agentName}${c.reset}`,
      `${c.green}${w.address.slice(0, 6)}...${w.address.slice(-4)}${c.reset}`,
      `${c.cyan}${w.chain}${c.reset}`
    ])
  );
}

async function cmdBalance(address, chain) {
  if (!address) { err('Usage: balance <address> [chain]'); return; }
  const result = await withSpinner(`Checking balance on ${chain || 'default chain'}`, () =>
    api(`/wallet/${address}/balance${chain ? `?chain=${chain}` : ''}`)
  );
  if (result.error) { err(result.error); return; }
  const bal = result.balance;
  const ethNum = parseFloat(bal.eth);
  const color = ethNum > 0 ? c.brightGreen : c.yellow;
  drawBox('💰 Balance', [
    `${c.gray}Chain:${c.reset}    ${c.cyan}${bal.chain}${c.reset}`,
    `${c.gray}Balance:${c.reset}  ${color}${c.bold}${bal.eth} ETH${c.reset}`,
    `${c.gray}Wei:${c.reset}      ${c.dim}${bal.wei}${c.reset}`,
    `${c.gray}RPC:${c.reset}      ${c.dim}${bal.rpc}${c.reset}`,
  ]);
  if (ethNum === 0) {
    console.log('');
    info(`Looks empty! Fund it → ${c.underline}https://faucet.circle.com/${c.reset}`);
  }
}

async function cmdBalances(address) {
  if (!address) { err('Usage: balances <address>'); return; }
  console.log(`\n  ${c.bold}Multi-chain balance scan for ${c.cyan}${address.slice(0, 8)}...${c.reset}\n`);

  const result = await withSpinner('Scanning all chains', () =>
    api(`/wallet/${address}/balance/all`)
  );
  if (result.error) { err(result.error); return; }

  drawTable(
    ['Chain', 'Balance (ETH)', 'Status'],
    result.balances.map(b => [
      `${c.cyan}${b.chain}${c.reset}`,
      `${parseFloat(b.eth) > 0 ? c.brightGreen : c.gray}${b.eth}${c.reset}`,
      b.status === 'ok' ? `${c.green}●${c.reset}` : `${c.red}●${c.reset}`
    ])
  );
}

async function cmdSend(from, to, value, chain) {
  if (!from || !to || !value) { err('Usage: send <from> <to> <value> [chain]'); return; }
  console.log(`\n  ${c.yellow}⚡ Sending ${c.bold}${value} ETH${c.reset}${c.yellow} from ${from.slice(0, 8)}... → ${to.slice(0, 8)}...${c.reset}\n`);

  const result = await withSpinner('Broadcasting transaction', () =>
    apiPost(`/wallet/${from}/send`, { to, value, chain })
  );
  if (result.success) {
    drawBox('🚀 Transaction Sent', [
      `${c.gray}Hash:${c.reset}     ${c.brightGreen}${result.transaction.hash}${c.reset}`,
      `${c.gray}Value:${c.reset}    ${value} ETH`,
      `${c.gray}Chain:${c.reset}    ${c.cyan}${result.transaction.chain}${c.reset}`,
      `${c.gray}Explorer:${c.reset} ${c.underline}${result.transaction.explorer}${c.reset}`,
    ]);
  } else {
    err(result.error);
  }
}

async function cmdSweep(from, to, chain) {
  if (!from || !to) { err('Usage: sweep <from> <to> [chain]'); return; }
  console.log(`\n  ${c.yellow}💨 Sweeping all funds from ${from.slice(0, 8)}... → ${to.slice(0, 8)}...${c.reset}\n`);

  const result = await withSpinner('Sweeping wallet', () =>
    apiPost(`/wallet/${from}/sweep`, { to, chain })
  );
  if (result.success) {
    drawBox('💨 Sweep Complete', [
      `${c.gray}Sent:${c.reset}     ${c.brightGreen}${result.sweep.amountSent} ETH${c.reset}`,
      `${c.gray}Gas:${c.reset}      ${c.yellow}${result.sweep.gasCost} ETH${c.reset}`,
      `${c.gray}Hash:${c.reset}     ${result.sweep.hash}`,
      `${c.gray}Explorer:${c.reset} ${c.underline}${result.sweep.explorer}${c.reset}`,
    ]);
  } else {
    err(result.error);
  }
}

async function cmdEstimate(from, to, value, chain) {
  if (!from || !to) { err('Usage: estimate <from> <to> [value] [chain]'); return; }
  const result = await withSpinner('Estimating gas', () =>
    apiPost('/wallet/estimate-gas', { from, to, value, chain })
  );
  if (result.error) { err(result.error); return; }
  drawBox('⛽ Gas Estimate', [
    `${c.gray}Gas Units:${c.reset}  ${result.gasUnits}`,
    `${c.gray}Gas Price:${c.reset}  ${result.gasPrice}`,
    `${c.gray}Total:${c.reset}      ${c.brightYellow}${result.estimatedCost}${c.reset}`,
    `${c.gray}Chain:${c.reset}      ${c.cyan}${result.chain}${c.reset}`,
  ]);
}

async function cmdTx(hash, chain) {
  if (!hash) { err('Usage: tx <hash> [chain]'); return; }
  const result = await withSpinner('Fetching transaction', () =>
    api(`/wallet/tx/${hash}?chain=${chain || 'base-sepolia'}`)
  );
  const statusColor = result.status === 'success' ? c.brightGreen : result.status === 'failed' ? c.red : c.yellow;
  drawBox('📄 Transaction', [
    `${c.gray}Hash:${c.reset}    ${result.hash}`,
    `${c.gray}Status:${c.reset}  ${statusColor}${c.bold}${result.status?.toUpperCase()}${c.reset}`,
    ...(result.blockNumber ? [`${c.gray}Block:${c.reset}   ${result.blockNumber}`, `${c.gray}Gas:${c.reset}     ${result.gasUsed}`] : []),
    ...(result.explorer ? [`${c.gray}View:${c.reset}    ${c.underline}${result.explorer}${c.reset}`] : []),
  ]);
}

async function cmdChains() {
  const result = await withSpinner('Fetching chains', () => api('/wallet/chains'));
  if (result.error) { err(result.error); return; }

  console.log(`\n  ${c.bold}${c.brightCyan}${result.count}${c.reset}${c.bold} Supported Chains${c.reset}\n`);

  const testnets = result.chains.filter(ch => ch.testnet);
  const mainnets = result.chains.filter(ch => !ch.testnet);

  console.log(`  ${c.yellow}${c.bold}TESTNETS${c.reset}`);
  drawTable(['ID', 'Name', 'Currency'], testnets.map(ch => [
    `${c.cyan}${ch.id}${c.reset}`, ch.name, `${c.yellow}${ch.nativeCurrency.symbol}${c.reset}`
  ]));

  console.log(`\n  ${c.green}${c.bold}MAINNETS${c.reset}`);
  drawTable(['ID', 'Name', 'Currency'], mainnets.map(ch => [
    `${c.cyan}${ch.id}${c.reset}`, ch.name, `${c.green}${ch.nativeCurrency.symbol}${c.reset}`
  ]));
}

// Identity commands
async function cmdIdentityCreate(address, name, type = 'assistant') {
  if (!address || !name) {
    err('Usage: identity create <walletAddress> <name> [type]');
    dim('Types: assistant, autonomous, hybrid');
    return;
  }
  const result = await withSpinner(`Creating ERC-8004 identity for ${c.bold}${name}${c.reset}`, () =>
    apiPost('/identity/create', { walletAddress: address, agentName: name, agentType: type, capabilities: ['wallet', 'messaging'] })
  );
  if (result.success) {
    drawBox('🤖 Identity Created', [
      `${c.gray}ID:${c.reset}      ${c.brightGreen}${result.identity.id}${c.reset}`,
      `${c.gray}Name:${c.reset}    ${result.identity.name}`,
      `${c.gray}Type:${c.reset}    ${c.cyan}${result.identity.type}${c.reset}`,
      `${c.gray}Wallet:${c.reset}  ${result.identity.wallet}`,
    ]);
  } else {
    err(result.error);
  }
}

async function cmdIdentityList() {
  const result = await withSpinner('Fetching identities', () => api('/identity/list'));
  if (result.error) { err(result.error); return; }
  if (!result.identities?.length) { warn('No identities found.'); return; }

  console.log(`\n  ${c.bold}Found ${c.brightCyan}${result.count}${c.reset}${c.bold} identity(ies)${c.reset}\n`);
  drawTable(
    ['ID', 'Name', 'Type', 'Wallet'],
    result.identities.map(id => [
      `${c.gray}${id.id.slice(0, 20)}...${c.reset}`,
      `${c.brightWhite}${id.name}${c.reset}`,
      `${c.cyan}${id.type}${c.reset}`,
      `${c.green}${id.wallet?.slice(0, 10)}...${c.reset}`
    ])
  );
}

async function cmdIdentityGet(agentId) {
  if (!agentId) { err('Usage: identity get <agentId>'); return; }
  const result = await withSpinner('Fetching identity', () => api(`/identity/${agentId}`));
  if (result.error) { err(result.error); return; }
  drawBox(`🤖 ${result.name}`, [
    `${c.gray}ID:${c.reset}           ${result.id}`,
    `${c.gray}Type:${c.reset}         ${c.cyan}${result.type}${c.reset}`,
    `${c.gray}Wallet:${c.reset}       ${c.green}${result.wallet}${c.reset}`,
    `${c.gray}Capabilities:${c.reset} ${result.capabilities?.map(ca => ca.type).join(', ')}`,
    `${c.gray}Created:${c.reset}      ${result.metadata?.createdAt}`,
  ]);
}

async function cmdIdentityWallet(address) {
  if (!address) { err('Usage: identity wallet <address>'); return; }
  const result = await withSpinner('Fetching identities for wallet', () => api(`/identity/wallet/${address}`));
  if (result.error) { err(result.error); return; }
  if (!result.identities?.length) { warn(`No identities found for ${address}`); return; }
  result.identities.forEach(id => {
    label('  ID', id.id);
    label('  Name', id.name);
    console.log('');
  });
}

// ENS commands
async function cmdEnsCheck(name) {
  if (!name) { err('Usage: ens check <name>'); return; }
  const result = await withSpinner(`Checking ${name}.eth availability`, () => api(`/ens/check/${name}`));
  if (result.error) { err(result.error); return; }
  if (result.available) {
    ok(`${c.bold}${name}.eth${c.reset}${c.green} is available! 🎉`);
  } else {
    warn(`${c.bold}${name}.eth${c.reset}${c.yellow} is already taken.`);
  }
}

async function cmdEnsPrice(name, years = '1') {
  if (!name) { err('Usage: ens price <name> [years]'); return; }
  const result = await withSpinner(`Getting price for ${name}.eth`, () => api(`/ens/price/${name}?years=${years}`));
  if (result.error) { err(result.error); return; }
  drawBox(`💰 ${name}.eth Price`, [
    `${c.gray}Duration:${c.reset}    ${result.durationYears} year(s)`,
    `${c.gray}Price/Year:${c.reset}  ${c.brightGreen}$${result.pricePerYearUsd}${c.reset}`,
    `${c.gray}Total USD:${c.reset}   ${c.bold}$${result.totalUsd}${c.reset}`,
    `${c.gray}Total ETH:${c.reset}   ${c.brightCyan}${result.totalEth} ETH${c.reset}`,
    `${c.gray}ETH Price:${c.reset}   $${result.ethPriceUsd}`,
  ]);
}

async function cmdEnsList() {
  const result = await withSpinner('Fetching ENS registrations', () => api('/ens/list'));
  if (result.error) { err(result.error); return; }
  if (!result.registrations?.length) { warn('No ENS registrations found.'); return; }
  drawTable(
    ['Name', 'Owner', 'Status'],
    result.registrations.map(r => [r.name, r.owner?.slice(0, 10) + '...', r.status])
  );
}

// Demo
async function cmdDemo() {
  banner();
  console.log(`  ${c.bold}${c.brightCyan}🎬 Interactive Demo${c.reset}\n`);

  // 1. Chains
  info('Step 1: Fetching supported chains...');
  const chains = await api('/wallet/chains');
  if (chains.error) { err(chains.error); return; }
  ok(`${chains.count} chains available`);

  // 2. Create wallet
  info('Step 2: Creating a new wallet...');
  const wallet = await apiPost('/wallet/create', { agentName: 'DemoBot', chain: 'base-sepolia' });
  if (wallet.error) { err(wallet.error); return; }
  ok(`Wallet: ${c.green}${wallet.wallet.address}${c.reset}`);

  // 3. Balance
  info('Step 3: Checking balance...');
  const bal = await api(`/wallet/${wallet.wallet.address}/balance`);
  ok(`Balance: ${bal.balance?.eth || '0'} ETH`);

  // 4. Identity
  info('Step 4: Creating ERC-8004 identity...');
  const identity = await apiPost('/identity/create', {
    walletAddress: wallet.wallet.address, agentName: 'DemoBot', agentType: 'assistant', capabilities: ['wallet']
  });
  if (identity.error) { err(identity.error); return; }
  ok(`Identity: ${identity.identity.id}`);

  console.log(`\n  ${c.brightGreen}${c.bold}✨ Demo complete!${c.reset}\n`);
  drawBox('📌 Next Steps', [
    `${c.gray}1.${c.reset} Fund wallet → ${c.underline}https://faucet.circle.com/${c.reset}`,
    `${c.gray}2.${c.reset} Address: ${c.green}${wallet.wallet.address}${c.reset}`,
    `${c.gray}3.${c.reset} Send: ${c.cyan}node cli.js send ${wallet.wallet.address.slice(0, 10)}... <to> 0.001${c.reset}`,
  ]);
}

// ============================================================
// MAIN ROUTER
// ============================================================

async function main() {
  const [, , cmd, ...args] = process.argv;

  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') {
    return cmdHelp();
  }

  banner();

  switch (cmd) {
    // Wallet commands + aliases
    case 'create': case 'new': return cmdCreate(args[0], args[1]);
    case 'import': return cmdImport(args[0], args[1], args[2]);
    case 'list': case 'ls': return cmdList();
    case 'balance': case 'bal': return cmdBalance(args[0], args[1]);
    case 'balances': case 'bals': return cmdBalances(args[0]);
    case 'send': case 's': return cmdSend(args[0], args[1], args[2], args[3]);
    case 'sweep': return cmdSweep(args[0], args[1], args[2]);
    case 'estimate': case 'gas': return cmdEstimate(args[0], args[1], args[2], args[3]);
    case 'tx': return cmdTx(args[0], args[1]);
    case 'chains': case 'c': return cmdChains();
    case 'demo': return cmdDemo();
    case 'doctor': case 'doc': {
      const { execSync } = await import('child_process');
      execSync('node doctor.js', { cwd: import.meta.dirname || process.cwd(), stdio: 'inherit' });
      return;
    }

    // Identity commands + aliases
    case 'identity': case 'id': {
      const [sub, ...subArgs] = args;
      switch (sub) {
        case 'create': case 'new': return cmdIdentityCreate(subArgs[0], subArgs[1], subArgs[2]);
        case 'list': case 'ls': return cmdIdentityList();
        case 'get': return cmdIdentityGet(subArgs[0]);
        case 'wallet': case 'w': return cmdIdentityWallet(subArgs[0]);
        default:
          // If sub looks like an ID, treat it as `identity get <id>`
          if (sub && sub.startsWith('agent:')) return cmdIdentityGet(sub);
          err(`Unknown identity command: ${sub}`);
          dim('Try: id new | id ls | id <agentId> | id w <address>');
      }
      break;
    }

    // ENS commands
    case 'ens': {
      const [sub, ...subArgs] = args;
      switch (sub) {
        case 'check': return cmdEnsCheck(subArgs[0]);
        case 'price': return cmdEnsPrice(subArgs[0], subArgs[1]);
        case 'list': case 'ls': return cmdEnsList();
        default:
          err(`Unknown ENS command: ${sub}`);
          dim('Try: ens check | price | list');
      }
      break;
    }

    default:
      err(`Unknown command: ${cmd}`);
      dim('Run "claw help" for available commands.');
  }
}

main().catch(e => {
  err(e.message);
  process.exit(1);
});
