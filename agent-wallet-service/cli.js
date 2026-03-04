#!/usr/bin/env node

/**
 * Agent Wallet CLI
 * 
 * Complete CLI for wallet + identity management with enhanced UX
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';

// ============================================================
// CONFIGURATION
// ============================================================

const API = process.env.AGENT_WALLET_API || 'http://localhost:3000';
const CLI_API_KEY = process.env.AGENT_WALLET_API_KEY || process.env.API_KEY || '';
let VERBOSE = false;
let JSON_OUTPUT = false;
let QUIET = false;

// ============================================================
// COLORED OUTPUT HELPERS
// ============================================================

const colors = {
  success: chalk.green,
  error: chalk.red,
  warning: chalk.yellow,
  info: chalk.cyan,
  dim: chalk.dim,
  bold: chalk.bold,
  highlight: chalk.magenta
};

function printSuccess(msg) {
  if (!QUIET) console.log(colors.success('✓'), msg);
}

function printError(msg) {
  console.log(colors.error('✗'), msg);
}

function printWarning(msg) {
  if (!QUIET) console.log(colors.warning('⚠'), msg);
}

function printInfo(msg) {
  if (!QUIET) console.log(colors.info('ℹ'), msg);
}

function printDim(msg) {
  if (!QUIET) console.log(colors.dim(msg));
}

function output(data) {
  if (JSON_OUTPUT) {
    console.log(JSON.stringify(data, null, 2));
  }
}

// ============================================================
// ASCII ART BANNER
// ============================================================

const BANNER = `
${chalk.cyan('╔═══════════════════════════════════════════════════╗')}
${chalk.cyan('║')}   ${chalk.bold.magenta('🦞')}  ${chalk.bold.cyan('Agent Wallet CLI')} ${chalk.cyan('v0.3.1')}                    ${chalk.cyan('║')}
${chalk.cyan('║')}   ${chalk.dim('Stripe for AI Agent Wallets')}                   ${chalk.cyan('║')}
${chalk.cyan('╚═══════════════════════════════════════════════════╝')}
`;

// ============================================================
// SENSITIVE FIELD FILTERING
// ============================================================

function maskSensitive(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  
  const sensitiveFields = ['privateKey', 'key', 'apiKey', 'api_key', 'secret', 'password', 'token'];
  const masked = {};
  
  for (const [k, v] of Object.entries(obj)) {
    const isSensitive = sensitiveFields.some(field => k.toLowerCase().includes(field.toLowerCase()));
    if (isSensitive) {
      masked[k] = '[REDACTED]';
    } else if (typeof v === 'object' && v !== null) {
      masked[k] = maskSensitive(v);
    } else {
      masked[k] = v;
    }
  }
  
  return masked;
}

// ============================================================
// SHARED REQUEST HELPER
// ============================================================

function getCliApiKey() {
  return process.env.AGENT_WALLET_API_KEY || process.env.API_KEY || '';
}

function getCliRpcUrl() {
  return process.env.AGENT_WALLET_RPC_URL || process.env.CLAW_WALLET_RPC_URL || '';
}

async function cliRequest(path, { method = 'GET', body, auth = 'required', apiKey } = {}) {
  const headers = {};
  const resolvedApiKey = apiKey ?? getCliApiKey();

  if (auth !== 'none') {
    if (resolvedApiKey) {
      headers['X-API-Key'] = resolvedApiKey;
    } else if (auth === 'required') {
      return {
        ok: false,
        status: 401,
        data: {
          error: 'Missing API key. Set AGENT_WALLET_API_KEY (or API_KEY), or run: node cli.js setup --init'
        }
      };
    }
  }

  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const resolvedRpcUrl = getCliRpcUrl();
  if (resolvedRpcUrl) {
    headers['X-RPC-URL'] = resolvedRpcUrl;
  }

  try {
    const url = `${API}${path}`;
    if (VERBOSE) {
      console.log(colors.dim(`[http] ${method} ${url}`));
      if (body !== undefined) {
        const safeBody = maskSensitive(body);
        console.log(colors.dim('[http] body:', JSON.stringify(safeBody)));
      }
    }

    const res = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined
    });

    let data;
    try {
      data = await res.json();
    } catch {
      return {
        ok: false,
        status: res.status,
        data: {
          error: `Unexpected non-JSON response from ${method} ${path} (HTTP ${res.status})`
        }
      };
    }

    if (VERBOSE) {
      console.log(colors.dim(`[http] status: ${res.status}`));
      if (data) {
        const safeData = maskSensitive(data);
        console.log(colors.dim('[http] response:', JSON.stringify(safeData)));
      }
    }

    if (!res.ok && !data?.error) {
      data.error = `Request failed (HTTP ${res.status})`;
    }

    if (!res.ok && res.status === 401) {
      const hint = 'Missing API key. Set AGENT_WALLET_API_KEY (or API_KEY), or run: node cli.js setup --init';
      data.error = data?.error ? `${data.error}. ${hint}` : hint;
    }

    return { ok: res.ok, status: res.status, data };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      data: {
        error: `Could not reach ${API}. Start the service with: npm start`
      }
    };
  }
}

// ============================================================
// WALLET COMMANDS
// ============================================================

async function createWallet(name, chain = 'base-sepolia') {
  return cliRequest('/wallet/create', {
    method: 'POST',
    body: { agentName: name, chain }
  });
}

async function importWallet(privateKey, name, chain) {
  return cliRequest('/wallet/import', {
    method: 'POST',
    body: { privateKey, agentName: name, chain }
  });
}

async function getBalance(address, chain) {
  const path = chain
    ? `/wallet/${address}/balance?chain=${chain}`
    : `/wallet/${address}/balance`;
  return cliRequest(path);
}

async function getAllBalances(address) {
  return cliRequest(`/wallet/${address}/balance/all`);
}

async function sendTransaction(from, to, value, chain) {
  return cliRequest(`/wallet/${from}/send`, {
    method: 'POST',
    body: { to, value, chain }
  });
}

async function listWallets() {
  return cliRequest('/wallet/list');
}

async function sweepWallet(from, to, chain) {
  return cliRequest(`/wallet/${from}/sweep`, {
    method: 'POST',
    body: { to, chain }
  });
}

async function estimateGas(from, to, value, chain) {
  return cliRequest('/wallet/estimate-gas', {
    method: 'POST',
    body: { from, to, value, chain }
  });
}

async function listChains() {
  return cliRequest('/wallet/chains');
}

async function getTxStatus(hash, chain) {
  return cliRequest(`/wallet/tx/${hash}?chain=${chain || 'base-sepolia'}`);
}

// ============================================================
// IDENTITY COMMANDS
// ============================================================

async function createIdentity(walletAddress, name, type = 'assistant') {
  return cliRequest('/identity/create', {
    method: 'POST',
    body: {
      walletAddress,
      agentName: name,
      agentType: type,
      capabilities: ['wallet', 'messaging']
    }
  });
}

async function listIdentities() {
  return cliRequest('/identity/list');
}

async function getIdentity(agentId) {
  return cliRequest(`/identity/${agentId}`);
}

async function getIdentitiesByWallet(address) {
  return cliRequest(`/identity/wallet/${address}`);
}

// ============================================================
// ENS COMMANDS
// ============================================================

async function listEnsNames() {
  return cliRequest('/ens/list');
}

async function getEnsName(name) {
  return cliRequest(`/ens/${name}`);
}

async function checkEnsName(name) {
  return cliRequest(`/ens/check/${name}`);
}

async function getOnboarding() {
  return cliRequest('/onboarding', { auth: 'none' });
}

async function getHealth() {
  return cliRequest('/health', { auth: 'none' });
}

async function checkAuthStatus(apiKey = CLI_API_KEY) {
  return cliRequest('/wallet/list', { auth: 'optional', apiKey });
}

function readBootstrapAdminKey() {
  const apiKeysPath = join(process.cwd(), 'api-keys.json');
  if (!existsSync(apiKeysPath)) return null;

  try {
    const keys = JSON.parse(readFileSync(apiKeysPath, 'utf8'));
    return Array.isArray(keys) && keys.length > 0 ? keys[0].key : null;
  } catch {
    return null;
  }
}

async function createScopedApiKey(adminApiKey, name = 'cli-init', permissions = ['read', 'write']) {
  return cliRequest('/api-keys', {
    method: 'POST',
    apiKey: adminApiKey,
    body: { name, permissions }
  });
}

function writeEnvLocalTemplate(apiKey) {
  const envPath = join(process.cwd(), '.env.local');
  const lines = [
    `AGENT_WALLET_API=${API}`,
    `AGENT_WALLET_API_KEY=${apiKey || '<paste-api-key>'}`
  ];

  writeFileSync(envPath, `${lines.join('\n')}\n`, 'utf8');
  return envPath;
}

// ============================================================
// CONFIRMATION PROMPT
// ============================================================

async function confirmAction(message) {
  const answers = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirmed',
      message: message,
      default: false
    }
  ]);
  return answers.confirmed;
}

// ============================================================
// INTERACTIVE MODE
// ============================================================

async function runInteractiveMode() {
  console.clear();
  console.log(BANNER);
  console.log(colors.dim('Running in interactive mode...\n'));

  const mainMenu = await inquirer.prompt([
    {
      type: 'list',
      name: 'command',
      message: 'What would you like to do?',
      choices: [
        { name: '� wallet - Manage wallets', value: 'wallet' },
        { name: '🔑 identity - Manage identities', value: 'identity' },
        { name: '🌐 ens - ENS operations', value: 'ens' },
        { name: '⚙️ setup - Server setup', value: 'setup' },
        { name: '🎬 demo - Run demo', value: 'demo' },
        { name: '❌ Exit', value: 'exit' }
      ]
    }
  ]);

  if (mainMenu.command === 'exit') {
    console.log(colors.success('\nGoodbye! 👋'));
    process.exit(0);
  }

  switch (mainMenu.command) {
    case 'wallet': {
      const walletAction = await inquirer.prompt([
        {
          type: 'list',
          name: 'action',
          message: 'Wallet action:',
          choices: [
            { name: '➕ Create new wallet', value: 'create' },
            { name: '📥 Import wallet', value: 'import' },
            { name: '💰 Check balance', value: 'balance' },
            { name: '🌍 Check all balances', value: 'balances' },
            { name: '📤 Send ETH', value: 'send' },
            { name: '🧹 Sweep funds', value: 'sweep' },
            { name: '⛽ Estimate gas', value: 'estimate' },
            { name: '📋 List wallets', value: 'list' },
            { name: '🔗 List chains', value: 'chains' },
            { name: '⬅️ Back', value: 'back' }
          ]
        }
      ]);

      if (walletAction.action === 'back') {
        return runInteractiveMode();
      }

      const spinner = ora();

      switch (walletAction.action) {
        case 'create': {
          const answers = await inquirer.prompt([
            { type: 'input', name: 'name', message: 'Wallet name:', validate: v => v.length > 0 || 'Name is required' },
            { type: 'input', name: 'chain', message: 'Chain (default: base-sepolia):', default: 'base-sepolia' }
          ]);
          spinner.start('Creating wallet...');
          const { data: result } = await createWallet(answers.name, answers.chain || 'base-sepolia');
          spinner.stop();
          if (result.success) {
            console.log(colors.success('\n✅ Wallet created!'));
            console.log(`   Address: ${colors.highlight(result.wallet.address)}`);
            console.log(`   ID: ${result.wallet.id}`);
            console.log(`   Chain: ${result.wallet.chain}`);
            output(result);
          } else {
            printError(result.error);
            output({ error: result.error });
          }
          break;
        }

        case 'import': {
          const answers = await inquirer.prompt([
            { type: 'password', name: 'privateKey', message: 'Private key:', mask: '*', validate: v => v.length > 0 || 'Private key is required' },
            { type: 'input', name: 'name', message: 'Wallet name:', validate: v => v.length > 0 || 'Name is required' },
            { type: 'input', name: 'chain', message: 'Chain (default: base-sepolia):', default: 'base-sepolia' }
          ]);
          spinner.start('Importing wallet...');
          const { data: result } = await importWallet(answers.privateKey, answers.name, answers.chain || 'base-sepolia');
          spinner.stop();
          if (result.success) {
            console.log(colors.success('\n✅ Wallet imported!'));
            console.log(`   Address: ${colors.highlight(result.wallet.address)}`);
            output(result);
          } else {
            printError(result.error);
            output({ error: result.error });
          }
          break;
        }

        case 'balance': {
          const answers = await inquirer.prompt([
            { type: 'input', name: 'address', message: 'Wallet address:', validate: v => v.length > 0 || 'Address is required' },
            { type: 'input', name: 'chain', message: 'Chain (optional):' }
          ]);
          spinner.start('Checking balance...');
          const { data: result } = await getBalance(answers.address, answers.chain || undefined);
          spinner.stop();
          if (result.balance) {
            console.log(colors.success('\n💰 Balance:'), result.balance.eth, 'ETH');
            console.log(`   Chain: ${result.balance.chain}`);
            output(result);
          } else {
            printError(result.error);
            output({ error: result.error });
          }
          break;
        }

        case 'balances': {
          const answers = await inquirer.prompt([
            { type: 'input', name: 'address', message: 'Wallet address:', validate: v => v.length > 0 || 'Address is required' }
          ]);
          spinner.start('Checking balances across all chains...');
          const { data: result } = await getAllBalances(answers.address);
          spinner.stop();
          if (result.error) {
            printError(result.error);
            output({ error: result.error });
            break;
          }
          console.log(colors.success('\n🌍 Balances across chains:'));
          result.balances.forEach(b => {
            const status = b.status === 'ok' ? colors.success('✓') : colors.error('✗');
            console.log(`   ${status} ${b.chain}: ${b.eth} ETH`);
          });
          output(result);
          break;
        }

        case 'send': {
          const answers = await inquirer.prompt([
            { type: 'input', name: 'from', message: 'From address:', validate: v => v.length > 0 || 'Address is required' },
            { type: 'input', name: 'to', message: 'To address:', validate: v => v.length > 0 || 'Address is required' },
            { type: 'input', name: 'value', message: 'Amount (in ETH):', validate: v => v.length > 0 || 'Amount is required' },
            { type: 'input', name: 'chain', message: 'Chain (default: base-sepolia):', default: 'base-sepolia' }
          ]);
          
          const confirmed = await confirmAction(colors.warning(`⚠️  Send ${answers.value} ETH from ${answers.from.slice(0, 6)}... to ${answers.to.slice(0, 6)}...?`));
          if (!confirmed) {
            printInfo('Operation cancelled.');
            break;
          }
          
          spinner.start('Sending transaction...');
          const { data: result } = await sendTransaction(answers.from, answers.to, answers.value, answers.chain || 'base-sepolia');
          spinner.stop();
          if (result.success) {
            console.log(colors.success('\n✅ Transaction sent!'));
            console.log(`   Hash: ${colors.highlight(result.transaction.hash)}`);
            console.log(`   Chain: ${result.transaction.chain}`);
            output(result);
          } else {
            printError(result.error);
            output({ error: result.error });
          }
          break;
        }

        case 'sweep': {
          const answers = await inquirer.prompt([
            { type: 'input', name: 'from', message: 'From address:', validate: v => v.length > 0 || 'Address is required' },
            { type: 'input', name: 'to', message: 'To address:', validate: v => v.length > 0 || 'Address is required' },
            { type: 'input', name: 'chain', message: 'Chain (default: base-sepolia):', default: 'base-sepolia' }
          ]);
          
          const confirmed = await confirmAction(colors.warning(`⚠️  SWEEP ALL FUNDS from ${answers.from.slice(0, 6)}... to ${answers.to.slice(0, 6)}...?`));
          if (!confirmed) {
            printInfo('Operation cancelled.');
            break;
          }
          
          spinner.start('Sweeping funds...');
          const { data: result } = await sweepWallet(answers.from, answers.to, answers.chain || 'base-sepolia');
          spinner.stop();
          if (result.success) {
            console.log(colors.success('\n✅ Sweep complete!'));
            console.log(`   Sent: ${result.sweep.amountSent} ETH`);
            console.log(`   Gas: ${result.sweep.gasCost} ETH`);
            console.log(`   Hash: ${colors.highlight(result.sweep.hash)}`);
            output(result);
          } else {
            printError(result.error);
            output({ error: result.error });
          }
          break;
        }

        case 'estimate': {
          const answers = await inquirer.prompt([
            { type: 'input', name: 'from', message: 'From address:', validate: v => v.length > 0 || 'Address is required' },
            { type: 'input', name: 'to', message: 'To address:', validate: v => v.length > 0 || 'Address is required' },
            { type: 'input', name: 'value', message: 'Amount (optional):' },
            { type: 'input', name: 'chain', message: 'Chain (default: base-sepolia):', default: 'base-sepolia' }
          ]);
          spinner.start('Estimating gas...');
          const { data: result } = await estimateGas(answers.from, answers.to, answers.value || undefined, answers.chain || 'base-sepolia');
          spinner.stop();
          if (result.estimatedCost) {
            console.log(colors.success('\n⛽ Gas Estimate:'));
            console.log(`   Gas Units: ${result.gasUnits}`);
            console.log(`   Gas Price: ${result.gasPrice}`);
            console.log(`   Total Cost: ${result.estimatedCost}`);
            console.log(`   Chain: ${result.chain}`);
            output(result);
          } else {
            printError(result.error);
            output({ error: result.error });
          }
          break;
        }

        case 'list': {
          spinner.start('Loading wallets...');
          const { data: result } = await listWallets();
          spinner.stop();
          if (result.error) {
            printError(result.error);
            output({ error: result.error });
            break;
          }
          if (result.wallets?.length > 0) {
            console.log(colors.success(`\n📋 Found ${result.count} wallet(s):`));
            result.wallets.forEach(w => {
              console.log(`   ${colors.highlight(w.agentName)}: ${w.address} (${w.chain})`);
            });
            output(result);
          } else {
            console.log(colors.dim('\nNo wallets found.'));
            output({ wallets: [] });
          }
          break;
        }

        case 'chains': {
          spinner.start('Loading chains...');
          const { data: result } = await listChains();
          spinner.stop();
          if (result.error) {
            printError(result.error);
            output({ error: result.error });
            break;
          }
          console.log(colors.success(`\n🔗 Supported Chains (${result.count}):\n`));
          console.log(colors.bold('Testnets:'));
          result.chains.filter(c => c.testnet).forEach(c => {
            console.log(`   ${colors.info(c.id)}: ${c.name} (${c.nativeCurrency.symbol})`);
          });
          console.log(colors.bold('\nMainnets:'));
          result.chains.filter(c => !c.testnet).forEach(c => {
            console.log(`   ${colors.info(c.id)}: ${c.name} (${c.nativeCurrency.symbol})`);
          });
          output(result);
          break;
        }
      }
      break;
    }

    case 'identity': {
      const identityAction = await inquirer.prompt([
        {
          type: 'list',
          name: 'action',
          message: 'Identity action:',
          choices: [
            { name: '➕ Create identity', value: 'create' },
            { name: '📋 List identities', value: 'list' },
            { name: '🔍 Get identity', value: 'get' },
            { name: '👛 Get by wallet', value: 'wallet' },
            { name: '⬅️ Back', value: 'back' }
          ]
        }
      ]);

      if (identityAction.action === 'back') {
        return runInteractiveMode();
      }

      const spinner = ora();

      switch (identityAction.action) {
        case 'create': {
          const answers = await inquirer.prompt([
            { type: 'input', name: 'wallet', message: 'Wallet address:', validate: v => v.length > 0 || 'Address is required' },
            { type: 'input', name: 'name', message: 'Identity name:', validate: v => v.length > 0 || 'Name is required' },
            { type: 'input', name: 'type', message: 'Type (assistant/autonomous/hybrid, default: assistant):', default: 'assistant' }
          ]);
          spinner.start('Creating identity...');
          const { data: result } = await createIdentity(answers.wallet, answers.name, answers.type);
          spinner.stop();
          if (result.success) {
            console.log(colors.success('\n✅ Identity created!'));
            console.log(`   ID: ${colors.highlight(result.identity.id)}`);
            console.log(`   Name: ${result.identity.name}`);
            console.log(`   Type: ${result.identity.type}`);
            output(result);
          } else {
            printError(result.error);
            output({ error: result.error });
          }
          break;
        }

        case 'list': {
          spinner.start('Loading identities...');
          const { data: result } = await listIdentities();
          spinner.stop();
          if (result.error) {
            printError(result.error);
            output({ error: result.error });
            break;
          }
          if (result.identities?.length > 0) {
            console.log(colors.success(`\n📋 Found ${result.count} identity(ies):`));
            result.identities.forEach(id => {
              console.log(`   ${colors.highlight(id.id)}: ${id.name} (${id.type})`);
            });
            output(result);
          } else {
            console.log(colors.dim('\nNo identities found.'));
            output({ identities: [] });
          }
          break;
        }

        case 'get': {
          const answers = await inquirer.prompt([
            { type: 'input', name: 'agentId', message: 'Agent ID:', validate: v => v.length > 0 || 'Agent ID is required' }
          ]);
          spinner.start('Getting identity...');
          const { data: result } = await getIdentity(answers.agentId);
          spinner.stop();
          if (result.error) {
            printError(result.error);
            output({ error: result.error });
          } else {
            console.log(colors.success('\n👤 Identity:'), result.name);
            console.log(`   ID: ${colors.highlight(result.id)}`);
            console.log(`   Type: ${result.type}`);
            console.log(`   Wallet: ${result.wallet}`);
            output(result);
          }
          break;
        }

        case 'wallet': {
          const answers = await inquirer.prompt([
            { type: 'input', name: 'address', message: 'Wallet address:', validate: v => v.length > 0 || 'Address is required' }
          ]);
          spinner.start('Getting identities...');
          const { data: result } = await getIdentitiesByWallet(answers.address);
          spinner.stop();
          if (result.error) {
            printError(result.error);
            output({ error: result.error });
            break;
          }
          console.log(colors.success(`\n👤 Identities for ${answers.address}:`));
          result.identities.forEach(id => {
            console.log(`   ${colors.highlight(id.id)}: ${id.name}`);
          });
          output(result);
          break;
        }
      }
      break;
    }

    case 'ens': {
      const ensAction = await inquirer.prompt([
        {
          type: 'list',
          name: 'action',
          message: 'ENS action:',
          choices: [
            { name: '📋 List records', value: 'list' },
            { name: '🔍 Resolve name', value: 'get' },
            { name: '✅ Check availability', value: 'check' },
            { name: '⬅️ Back', value: 'back' }
          ]
        }
      ]);

      if (ensAction.action === 'back') {
        return runInteractiveMode();
      }

      const spinner = ora();

      switch (ensAction.action) {
        case 'list': {
          spinner.start('Loading ENS records...');
          const { data: result } = await listEnsNames();
          spinner.stop();
          if (result.error) {
            printError(result.error);
            output({ error: result.error });
            break;
          }
          console.log(colors.success(`\n🌐 ENS records (${result.count || 0}):`));
          (result.records || []).forEach(record => {
            console.log(`   ${colors.highlight(record.name)} -> ${record.address}`);
          });
          output(result);
          break;
        }

        case 'get': {
          const answers = await inquirer.prompt([
            { type: 'input', name: 'name', message: 'ENS name:', validate: v => v.length > 0 || 'Name is required' }
          ]);
          spinner.start('Resolving ENS...');
          const { data: result } = await getEnsName(answers.name);
          spinner.stop();
          if (result.error) {
            printError(result.error);
            output({ error: result.error });
          } else {
            console.log(colors.success(`\n🌐 ${result.name} -> ${result.address}`));
            output(result);
          }
          break;
        }

        case 'check': {
          const answers = await inquirer.prompt([
            { type: 'input', name: 'name', message: 'ENS name:', validate: v => v.length > 0 || 'Name is required' }
          ]);
          spinner.start('Checking availability...');
          const { data: result } = await checkEnsName(answers.name);
          spinner.stop();
          console.log(colors.success(`\n🌐 Name:`), answers.name);
          console.log(`   Available: ${result.available ? colors.success('Yes') : colors.warning('No')}`);
          if (result.price) {
            console.log(`   Price: ${result.price}`);
          }
          output(result);
          break;
        }
      }
      break;
    }

    case 'setup': {
      const setupAction = await inquirer.prompt([
        {
          type: 'list',
          name: 'action',
          message: 'Setup action:',
          choices: [
            { name: '🔧 Check server status', value: 'check' },
            { name: '🚀 Initialize (--init)', value: 'init' },
            { name: '⬅️ Back', value: 'back' }
          ]
        }
      ]);

      if (setupAction.action === 'back') {
        return runInteractiveMode();
      }

      const spinner = ora();

      if (setupAction.action === 'check' || setupAction.action === 'init') {
        spinner.start(`Checking server at ${API}...`);
        const healthRes = await getHealth();
        spinner.stop();
        
        if (!healthRes.ok) {
          if (healthRes.status === 0) {
            printError(healthRes.data.error);
            break;
          }
          printError(`Server reachable but unhealthy (HTTP ${healthRes.status})`);
          break;
        }
        
        const health = healthRes.data;
        printSuccess(`Server online: ${health.service} v${health.version}`);

        const onboarding = await getOnboarding();
        if (onboarding.ok) {
          printSuccess(`Onboarding endpoint available (${onboarding.status})`);
          console.log(`   API keys configured: ${onboarding.data.apiKeyCount}`);
        } else {
          printWarning(`Onboarding endpoint returned HTTP ${onboarding.status}`);
        }

        const auth = await checkAuthStatus();
        if (auth.ok) {
          printSuccess('Auth check passed (wallet/list accessible).');
        } else if (auth.status === 401) {
          printWarning('Auth required: set AGENT_WALLET_API_KEY and re-run setup.');
        } else if (auth.status === 403) {
          printWarning('Provided API key is invalid or lacks permissions.');
        } else {
          printWarning(`Auth check returned HTTP ${auth.status}`);
        }

        if (setupAction.action === 'init') {
          console.log(colors.bold('\n🚀 Running one-command onboarding...'));
          const adminKey = process.env.AGENT_WALLET_ADMIN_KEY || process.env.ADMIN_API_KEY || CLI_API_KEY || readBootstrapAdminKey();

          if (!adminKey) {
            const envPath = writeEnvLocalTemplate('');
            printWarning('Missing admin API key; cannot create scoped API key automatically.');
            console.log(`   Wrote template: ${envPath}`);
            break;
          }

          spinner.start('Creating scoped API key...');
          const keyName = `cli-init-${Date.now()}`;
          const created = await createScopedApiKey(adminKey, keyName, ['read', 'write']);
          spinner.stop();

          if (created.ok && created.data?.key?.key) {
            const scopedKey = created.data.key.key;
            const envPath = writeEnvLocalTemplate(scopedKey);
            printSuccess('Created scoped API key with read/write permissions.');
            console.log(`   Key name: ${created.data.key.name}`);
            console.log(`   Key preview: ${scopedKey.slice(0, 12)}...`);
            console.log(`   Saved env template: ${envPath}`);
          } else {
            const envPath = writeEnvLocalTemplate('');
            printWarning('Could not create scoped key.');
            console.log(`   Wrote template: ${envPath}`);
          }
        }
      }
      break;
    }

    case 'demo': {
      console.log(colors.bold('\n🎬 Running full demo...\n'));
      
      const spinner = ora();
      
      // 1. List chains
      console.log(colors.dim('1️⃣ Supported Chains:'));
      spinner.start('Loading chains...');
      const { data: chains } = await listChains();
      spinner.stop();
      if (chains.error) {
        printError(chains.error);
        break;
      }
      console.log(colors.success(`   ${chains.count} chains available\n`));
      
      // 2. Create wallet
      spinner.start('Creating wallet...');
      const { data: wallet } = await createWallet('DemoBot', 'base-sepolia');
      spinner.stop();
      if (wallet.success) {
        console.log(colors.success(`   ✅ ${wallet.wallet.address}\n`));
      } else {
        printError(wallet.error);
        break;
      }
      
      // 3. Check balance
      spinner.start('Checking balance...');
      const { data: bal } = await getBalance(wallet.wallet.address);
      spinner.stop();
      console.log(colors.dim('3️⃣ Checking balance...'));
      console.log(colors.success(`   Balance: ${bal.balance?.eth || 0} ETH\n`));
      
      // 4. Create identity
      spinner.start('Creating ERC-8004 identity...');
      const { data: identity } = await createIdentity(wallet.wallet.address, 'DemoBot', 'assistant');
      spinner.stop();
      if (identity.success) {
        console.log(colors.success(`   ✅ ${identity.identity.id}\n`));
      } else {
        printError(identity.error);
        break;
      }
      
      console.log(colors.bold('\n✅ Demo complete!'));
      console.log(colors.dim('\n📌 Next steps:'));
      console.log(`   1. Fund wallet: ${colors.info('https://faucet.circle.com/')}`);
      console.log(`   2. Address: ${colors.highlight(wallet.wallet.address)}`);
      output({ wallet: wallet.wallet, identity: identity.identity });
      break;
    }
  }

  // Continue interactive mode
  const continueInteractive = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'continue',
      message: '\nContinue in interactive mode?',
      default: true
    }
  ]);

  if (continueInteractive.continue) {
    return runInteractiveMode();
  } else {
    console.log(colors.success('\nGoodbye! 👋'));
    process.exit(0);
  }
}

// ============================================================
// MAIN CLI WITH COMMANDER
// ============================================================

const program = new Command();

// Global options - parse first to set flags
const args = process.argv.slice(2);
const globalOpts = args.filter(arg => arg.startsWith('-'));
QUIET = globalOpts.includes('-q') || globalOpts.includes('--quiet');
JSON_OUTPUT = globalOpts.includes('-j') || globalOpts.includes('--json');
VERBOSE = globalOpts.includes('-v') || globalOpts.includes('--verbose');

program
  .option('-v, --verbose', 'Enable verbose logging')
  .option('-q, --quiet', 'Suppress non-essential output')
  .option('-j, --json', 'Output results as JSON');

// Show banner on start (unless quiet or json)
if (!JSON_OUTPUT && !QUIET) {
  console.log(BANNER);
}

// Show banner on help
program.on('help', () => {
  console.log(BANNER);
});

// Main program
program
  .name('cli.js')
  .description('🦞 Agent Wallet CLI - Stripe for AI Agent Wallets')
  .version('0.3.1');

// ============================================================
// WALLET COMMANDS
// ============================================================

program
  .command('create')
  .description('Create a new wallet')
  .argument('<name>', 'Wallet name')
  .argument('[chain]', 'Blockchain chain (default: base-sepolia)', 'base-sepolia')
  .option('--chain=<chain>', 'Blockchain chain (named flag)')
  .action(async (name, chain, options) => {
    const finalChain = options.chain || chain;
    if (!QUIET) console.log(colors.dim(`Creating wallet for ${name} on ${finalChain}...`));
    const spinner = ora('Creating wallet...').start();
    const { data: result } = await createWallet(name, finalChain);
    spinner.stop();
    if (result.success) {
      if (!QUIET) {
        console.log(colors.success('\n✅ Wallet created!'));
        console.log(`   Address: ${colors.highlight(result.wallet.address)}`);
        console.log(`   ID: ${result.wallet.id}`);
        console.log(`   Chain: ${result.wallet.chain}`);
      }
      output(result);
    } else {
      printError(result.error);
      output({ error: result.error });
      process.exit(1);
    }
  });

// Alias for create
program.command('bal', ...createCommandAlias('bal', 'balance'));

function createCommandAlias(alias, original) {
  const originalCmd = program.commands.find(c => c.name() === original);
  if (!originalCmd) return [];
  return [alias, originalCmd.description];
}

program
  .command('import')
  .description('Import wallet from private key')
  .argument('<privateKey>', 'Private key (won\'t be stored)')
  .argument('<name>', 'Wallet name')
  .argument('[chain]', 'Blockchain chain (default: base-sepolia)', 'base-sepolia')
  .option('--chain=<chain>', 'Blockchain chain (named flag)')
  .action(async (privateKey, name, chain, options) => {
    const finalChain = options.chain || chain;
    if (!QUIET) console.log(colors.dim('Importing wallet...'));
    const spinner = ora('Importing wallet...').start();
    const { data: result } = await importWallet(privateKey, name, finalChain);
    spinner.stop();
    if (result.success) {
      if (!QUIET) {
        console.log(colors.success('\n✅ Wallet imported!'));
        console.log(`   Address: ${colors.highlight(result.wallet.address)}`);
        console.log(`   Imported: ${result.wallet.imported}`);
      }
      output(result);
    } else {
      printError(result.error);
      output({ error: result.error });
      process.exit(1);
    }
  });

program
  .command('balance')
  .description('Check wallet balance')
  .argument('<address>', 'Wallet address')
  .argument('[chain]', 'Blockchain chain')
  .option('--chain=<chain>', 'Blockchain chain (named flag)')
  .action(async (address, chain, options) => {
    const finalChain = options.chain || chain;
    const spinner = ora('Checking balance...').start();
    const { data: result } = await getBalance(address, finalChain);
    spinner.stop();
    if (result.balance) {
      if (!QUIET) {
        console.log(colors.success('\n💰 Balance:'), result.balance.eth, 'ETH');
        console.log(`   Chain: ${result.balance.chain}`);
        console.log(`   RPC: ${result.balance.rpc}`);
      }
      output(result);
    } else {
      printError(result.error);
      output({ error: result.error });
      process.exit(1);
    }
  });

program
  .command('balances')
  .alias('bals')
  .description('Check balance across all chains')
  .argument('<address>', 'Wallet address')
  .action(async (address) => {
    if (!QUIET) console.log(colors.dim('Checking balances across all chains...\n'));
    const spinner = ora('Checking balances...').start();
    const { data: result } = await getAllBalances(address);
    spinner.stop();
    if (result.error) {
      printError(result.error);
      output({ error: result.error });
      process.exit(1);
    }
    if (!QUIET) {
      result.balances.forEach(b => {
        const status = b.status === 'ok' ? colors.success('✓') : colors.error('✗');
        console.log(`${status} ${b.chain}: ${b.eth} ETH`);
      });
    }
    output(result);
  });

program
  .command('send')
  .description('Send ETH from one wallet to another')
  .argument('<from>', 'From address')
  .argument('<to>', 'To address')
  .argument('<value>', 'Amount in ETH')
  .argument('[chain]', 'Blockchain chain (default: base-sepolia)', 'base-sepolia')
  .option('--chain=<chain>', 'Blockchain chain (named flag)')
  .option('-y, --yes', 'Skip confirmation prompt')
  .action(async (from, to, value, chain, options) => {
    const finalChain = options.chain || chain;
    
    // Confirmation prompt
    if (!options.yes) {
      const confirmed = await confirmAction(colors.warning(`⚠️  Send ${value} ETH from ${from.slice(0, 6)}... to ${to.slice(0, 6)}...?`));
      if (!confirmed) {
        printInfo('Operation cancelled.');
        process.exit(0);
      }
    }
    
    if (!QUIET) console.log(colors.dim(`Sending ${value} ETH...`));
    const spinner = ora('Sending transaction...').start();
    const { data: result } = await sendTransaction(from, to, value, finalChain);
    spinner.stop();
    if (result.success) {
      if (!QUIET) {
        console.log(colors.success('\n✅ Transaction sent!'));
        console.log(`   Hash: ${colors.highlight(result.transaction.hash)}`);
        console.log(`   Chain: ${result.transaction.chain}`);
        console.log(`   View: ${result.transaction.explorer}`);
      }
      output(result);
    } else {
      printError(result.error);
      output({ error: result.error });
      process.exit(1);
    }
  });

program
  .command('sweep')
  .description('Send all funds from one wallet to another')
  .argument('<from>', 'From address')
  .argument('<to>', 'To address')
  .argument('[chain]', 'Blockchain chain (default: base-sepolia)', 'base-sepolia')
  .option('--chain=<chain>', 'Blockchain chain (named flag)')
  .option('-y, --yes', 'Skip confirmation prompt')
  .action(async (from, to, chain, options) => {
    const finalChain = options.chain || chain;
    
    // Confirmation prompt
    if (!options.yes) {
      const confirmed = await confirmAction(colors.warning(`⚠️  SWEEP ALL FUNDS from ${from.slice(0, 6)}... to ${to.slice(0, 6)}...?`));
      if (!confirmed) {
        printInfo('Operation cancelled.');
        process.exit(0);
      }
    }
    
    if (!QUIET) console.log(colors.dim(`Sweeping all funds from ${from} to ${to}...`));
    const spinner = ora('Sweeping funds...').start();
    const { data: result } = await sweepWallet(from, to, finalChain);
    spinner.stop();
    if (result.success) {
      if (!QUIET) {
        console.log(colors.success('\n✅ Sweep complete!'));
        console.log(`   Sent: ${result.sweep.amountSent} ETH`);
        console.log(`   Gas: ${result.sweep.gasCost} ETH`);
        console.log(`   Hash: ${colors.highlight(result.sweep.hash)}`);
      }
      output(result);
    } else {
      printError(result.error);
      output({ error: result.error });
      process.exit(1);
    }
  });

program
  .command('estimate')
  .description('Estimate gas cost for a transaction')
  .argument('<from>', 'From address')
  .argument('<to>', 'To address')
  .argument('[value]', 'Amount in ETH')
  .argument('[chain]', 'Blockchain chain (default: base-sepolia)', 'base-sepolia')
  .option('--chain=<chain>', 'Blockchain chain (named flag)')
  .action(async (from, to, value, chain, options) => {
    const finalChain = options.chain || chain;
    const spinner = ora('Estimating gas...').start();
    const { data: result } = await estimateGas(from, to, value, finalChain);
    spinner.stop();
    if (result.estimatedCost) {
      if (!QUIET) {
        console.log(colors.success('\n⛽ Gas Estimate:'));
        console.log(`   Gas Units: ${result.gasUnits}`);
        console.log(`   Gas Price: ${result.gasPrice}`);
        console.log(`   Total Cost: ${result.estimatedCost}`);
        console.log(`   Chain: ${result.chain}`);
      }
      output(result);
    } else {
      printError(result.error);
      output({ error: result.error });
      process.exit(1);
    }
  });

program
  .command('tx')
  .description('Get transaction status')
  .argument('<hash>', 'Transaction hash')
  .argument('[chain]', 'Blockchain chain (default: base-sepolia)', 'base-sepolia')
  .option('--chain=<chain>', 'Blockchain chain (named flag)')
  .action(async (hash, chain, options) => {
    const finalChain = options.chain || chain;
    const spinner = ora('Getting transaction status...').start();
    const { data: result } = await getTxStatus(hash, finalChain);
    spinner.stop();
    if (result.error) {
      printError(result.error);
      output({ error: result.error });
      process.exit(1);
    }
    if (!QUIET) {
      console.log(colors.success('\n📊 Transaction:'), result.hash);
      console.log(`   Status: ${result.status}`);
      if (result.blockNumber) {
        console.log(`   Block: ${result.blockNumber}`);
        console.log(`   Gas Used: ${result.gasUsed}`);
      }
      if (result.explorer) {
        console.log(`   View: ${result.explorer}`);
      }
    }
    output(result);
  });

program
  .command('list')
  .alias('ls')
  .description('List all wallets')
  .action(async () => {
    const spinner = ora('Loading wallets...').start();
    const { data: result } = await listWallets();
    spinner.stop();
    if (result.error) {
      printError(result.error);
      output({ error: result.error });
      process.exit(1);
    }
    if (result.wallets?.length > 0) {
      if (!QUIET) {
        console.log(colors.success(`\n📋 Found ${result.count} wallet(s):`));
        result.wallets.forEach(w => {
          console.log(`   ${colors.highlight(w.agentName)}: ${w.address} (${w.chain})`);
        });
      }
      output(result);
    } else {
      if (!QUIET) console.log(colors.dim('\nNo wallets found.'));
      output({ wallets: [], count: 0 });
    }
  });

program
  .command('chains')
  .description('List supported blockchain chains')
  .action(async () => {
    const spinner = ora('Loading chains...').start();
    const { data: result } = await listChains();
    spinner.stop();
    if (result.error) {
      printError(result.error);
      output({ error: result.error });
      process.exit(1);
    }
    if (!QUIET) {
      console.log(colors.success(`\n🔗 Supported Chains (${result.count}):\n`));
      console.log(colors.bold('Testnets:'));
      result.chains.filter(c => c.testnet).forEach(c => {
        console.log(`   ${colors.info(c.id)}: ${c.name} (${c.nativeCurrency.symbol})`);
      });
      console.log(colors.bold('\nMainnets:'));
      result.chains.filter(c => !c.testnet).forEach(c => {
        console.log(`   ${colors.info(c.id)}: ${c.name} (${c.nativeCurrency.symbol})`);
      });
    }
    output(result);
  });

// ============================================================
// IDENTITY COMMANDS
// ============================================================

const identityCmd = program
  .command('identity')
  .description('Manage ERC-8004 identities');

identityCmd
  .command('create')
  .description('Create an ERC-8004 identity')
  .argument('<wallet>', 'Wallet address')
  .argument('<name>', 'Identity name')
  .argument('[type]', 'Identity type (assistant, autonomous, hybrid)', 'assistant')
  .action(async (wallet, name, type) => {
    if (!QUIET) console.log(colors.dim(`Creating ERC-8004 identity for ${name}...`));
    const spinner = ora('Creating identity...').start();
    const { data: result } = await createIdentity(wallet, name, type);
    spinner.stop();
    if (result.success) {
      if (!QUIET) {
        console.log(colors.success('\n✅ Identity created!'));
        console.log(`   ID: ${colors.highlight(result.identity.id)}`);
        console.log(`   Name: ${result.identity.name}`);
        console.log(`   Type: ${result.identity.type}`);
        console.log(`   Wallet: ${result.identity.wallet}`);
      }
      output(result);
    } else {
      printError(result.error);
      output({ error: result.error });
      process.exit(1);
    }
  });

identityCmd
  .command('list')
  .description('List all identities')
  .action(async () => {
    const spinner = ora('Loading identities...').start();
    const { data: result } = await listIdentities();
    spinner.stop();
    if (result.error) {
      printError(result.error);
      output({ error: result.error });
      process.exit(1);
    }
    if (result.identities?.length > 0) {
      if (!QUIET) {
        console.log(colors.success(`\n👤 Found ${result.count} identity(ies):`));
        result.identities.forEach(id => {
          console.log(`   ${colors.highlight(id.id)}: ${id.name} (${id.type})`);
        });
      }
      output(result);
    } else {
      if (!QUIET) console.log(colors.dim('\nNo identities found.'));
      output({ identities: [], count: 0 });
    }
  });

identityCmd
  .command('get')
  .description('Get identity details')
  .argument('<agentId>', 'Agent ID')
  .action(async (agentId) => {
    const spinner = ora('Getting identity...').start();
    const { data: result } = await getIdentity(agentId);
    spinner.stop();
    if (result.error) {
      printError(result.error);
      output({ error: result.error });
      process.exit(1);
    }
    if (!QUIET) {
      console.log(colors.success('\n👤 Identity:'), result.name);
      console.log(`   ID: ${colors.highlight(result.id)}`);
      console.log(`   Type: ${result.type}`);
      console.log(`   Wallet: ${result.wallet}`);
      console.log(`   Capabilities: ${result.capabilities.map(c => c.type).join(', ')}`);
    }
    output(result);
  });

identityCmd
  .command('wallet')
  .description('Get identities by wallet address')
  .argument('<address>', 'Wallet address')
  .action(async (address) => {
    const spinner = ora('Getting identities...').start();
    const { data: result } = await getIdentitiesByWallet(address);
    spinner.stop();
    if (result.error) {
      printError(result.error);
      output({ error: result.error });
      process.exit(1);
    }
    if (!QUIET) {
      console.log(colors.success(`\n👤 Identities for ${address}:`));
      result.identities.forEach(id => {
        console.log(`   ${colors.highlight(id.id)}: ${id.name}`);
      });
    }
    output(result);
  });

// ============================================================
// ENS COMMANDS
// ============================================================

const ensCmd = program
  .command('ens')
  .description('Manage ENS records');

ensCmd
  .command('list')
  .description('List registered ENS records')
  .action(async () => {
    const spinner = ora('Loading ENS records...').start();
    const { data: result } = await listEnsNames();
    spinner.stop();
    if (result.error) {
      printError(result.error);
      output({ error: result.error });
      process.exit(1);
    }
    if (!QUIET) {
      console.log(colors.success(`\n🌐 ENS records (${result.count || 0}):`));
      (result.records || []).forEach(record => {
        console.log(`   ${colors.highlight(record.name)} -> ${record.address}`);
      });
    }
    output(result);
  });

ensCmd
  .command('get')
  .description('Resolve ENS record')
  .argument('<name>', 'ENS name')
  .action(async (name) => {
    const spinner = ora('Resolving ENS...').start();
    const { data: result } = await getEnsName(name);
    spinner.stop();
    if (result.error) {
      printError(result.error);
      output({ error: result.error });
      process.exit(1);
    }
    if (!QUIET) {
      console.log(colors.success(`\n🌐 ${result.name} -> ${result.address}`));
    }
    output(result);
  });

ensCmd
  .command('check')
  .description('Check ENS name availability')
  .argument('<name>', 'ENS name')
  .action(async (name) => {
    const spinner = ora('Checking availability...').start();
    const { data: result } = await checkEnsName(name);
    spinner.stop();
    if (result.error) {
      printError(result.error);
      output({ error: result.error });
      process.exit(1);
    }
    if (!QUIET) {
      console.log(colors.success(`\n🌐 Name:`), name);
      console.log(`   Available: ${result.available ? colors.success('Yes') : colors.warning('No')}`);
      if (result.price) {
        console.log(`   Price: ${result.price}`);
      }
    }
    output(result);
  });

// ============================================================
// SETUP & DEMO
// ============================================================

program
  .command('setup')
  .description('Check server status and optionally initialize')
  .option('--init', 'Initialize with a new API key')
  .action(async (options) => {
    if (!QUIET) console.log(colors.dim(`Checking server at ${API}...`));
    const spinner = ora('Checking server...').start();
    const healthRes = await getHealth();
    spinner.stop();
    
    if (!healthRes.ok) {
      if (healthRes.status === 0) {
        printError(healthRes.data.error);
        process.exit(1);
      }
      printError(`Server reachable but unhealthy (HTTP ${healthRes.status})`);
      process.exit(1);
    }
    
    const health = healthRes.data;
    printSuccess(`Server online: ${health.service} v${health.version}`);

    const onboarding = await getOnboarding();
    if (onboarding.ok) {
      printSuccess(`Onboarding endpoint available (${onboarding.status})`);
      if (!QUIET) {
        console.log(`   API keys configured: ${onboarding.data.apiKeyCount}`);
        if (onboarding.data.keyPreview) {
          console.log(`   First key preview: ${onboarding.data.keyPreview}...`);
        }
      }
    } else {
      printWarning(`Onboarding endpoint returned HTTP ${onboarding.status}`);
    }

    const auth = await checkAuthStatus();
    if (auth.ok) {
      printSuccess('Auth check passed (wallet/list accessible).');
    } else if (auth.status === 401) {
      printWarning('Auth required: set AGENT_WALLET_API_KEY and re-run setup.');
    } else if (auth.status === 403) {
      printWarning('Provided API key is invalid or lacks permissions.');
    } else {
      printWarning(`Auth check returned HTTP ${auth.status}`);
    }

    if (!options.init) {
      output({ health: healthRes.data, onboarding: onboarding.data, auth: auth });
      return;
    }

    console.log(colors.bold('\n🚀 Running one-command onboarding (--init)...'));
    const adminKey = process.env.AGENT_WALLET_ADMIN_KEY || process.env.ADMIN_API_KEY || CLI_API_KEY || readBootstrapAdminKey();

    if (!adminKey) {
      const envPath = writeEnvLocalTemplate('');
      printWarning('Missing admin API key; cannot create scoped API key automatically.');
      if (!QUIET) {
        console.log('   Provide one of: AGENT_WALLET_ADMIN_KEY, ADMIN_API_KEY, or AGENT_WALLET_API_KEY');
        console.log(`   Wrote template: ${envPath}`);
        console.log(colors.dim('\n📌 Next steps:'));
        console.log('   1. Export admin key from api-keys.json or service startup logs');
        console.log('   2. Re-run: node cli.js setup --init');
      }
      output({ error: 'Missing admin API key', envPath });
      return;
    }

    spinner.start('Creating scoped API key...');
    const keyName = `cli-init-${Date.now()}`;
    const created = await createScopedApiKey(adminKey, keyName, ['read', 'write']);
    spinner.stop();

    if (created.ok && created.data?.key?.key) {
      const scopedKey = created.data.key.key;
      const envPath = writeEnvLocalTemplate(scopedKey);
      printSuccess('Created scoped API key with read/write permissions.');
      if (!QUIET) {
        console.log(`   Key name: ${created.data.key.name}`);
        console.log(`   Key preview: ${scopedKey.slice(0, 12)}...`);
        console.log(`   Saved env template: ${envPath}`);
        console.log(colors.dim('\n📌 Next steps:'));
        console.log('   1. Load env vars: export $(cat .env.local | xargs)');
        console.log('   2. Verify auth: node cli.js setup');
        console.log('   3. Create wallet: node cli.js create MyBot base-sepolia');
      }
      output({ key: { name: created.data.key.name, preview: scopedKey.slice(0, 12) }, envPath });
    } else {
      const envPath = writeEnvLocalTemplate('');
      printWarning('Could not create scoped key.');
      if (created.status === 403) {
        printWarning('   Provided secret is not an admin key.');
      } else if (created.status === 401) {
        printWarning('   Missing or invalid admin key.');
      }
      if (created.data?.error) {
        printWarning(`   Server message: ${created.data.error}`);
      }
      if (!QUIET) {
        console.log(`   Wrote template: ${envPath}`);
        console.log(colors.dim('\n📌 Next steps:'));
        console.log('   1. Find the bootstrap admin key in api-keys.json or startup logs');
        console.log('   2. Set AGENT_WALLET_ADMIN_KEY=<bootstrap-or-admin-key>');
        console.log('   3. Re-run: node cli.js setup --init');
      }
      output({ error: created.data?.error, envPath });
    }
  });

program
  .command('demo')
  .description('Run interactive demo')
  .action(async () => {
    if (!QUIET) {
      console.log(colors.bold('\n🎬 Running full demo...\n'));
    }
    
    const spinner = ora();
    
    // 1. List chains
    if (!QUIET) console.log(colors.dim('1️⃣ Supported Chains:'));
    spinner.start('Loading chains...');
    const { data: chains } = await listChains();
    spinner.stop();
    if (chains.error) {
      printError(chains.error);
      output({ error: chains.error });
      process.exit(1);
    }
    if (!QUIET) console.log(colors.success(`   ${chains.count} chains available\n`));
    
    // 2. Create wallet
    spinner.start('Creating wallet...');
    const { data: wallet } = await createWallet('DemoBot', 'base-sepolia');
    spinner.stop();
    if (wallet.success) {
      if (!QUIET) console.log(colors.success(`2️⃣ Creating wallet...`) + colors.success(`   ✅ ${wallet.wallet.address}\n`));
    } else {
      printError(wallet.error);
      output({ error: wallet.error });
      process.exit(1);
    }
    
    // 3. Check balance
    spinner.start('Checking balance...');
    const { data: bal } = await getBalance(wallet.wallet.address);
    spinner.stop();
    if (!QUIET) {
      console.log(colors.dim('3️⃣ Checking balance...'));
      console.log(colors.success(`   Balance: ${bal.balance?.eth || 0} ETH\n`));
    }
    
    // 4. Create identity
    spinner.start('Creating ERC-8004 identity...');
    const { data: identity } = await createIdentity(wallet.wallet.address, 'DemoBot', 'assistant');
    spinner.stop();
    if (identity.success) {
      if (!QUIET) {
        console.log(colors.dim('4️⃣ Creating ERC-8004 identity...'));
        console.log(colors.success(`   ✅ ${identity.identity.id}\n`));
      }
    } else {
      printError(identity.error);
      output({ error: identity.error });
      process.exit(1);
    }
    
    if (!QUIET) {
      console.log(colors.bold('\n✅ Demo complete!'));
      console.log(colors.dim('\n📌 Next steps:'));
      console.log(`   1. Fund wallet: ${colors.info('https://faucet.circle.com/')}`);
      console.log(`   2. Address: ${colors.highlight(wallet.wallet.address)}`);
      console.log(`   3. Send: node cli.js send ${wallet.wallet.address} <to> 0.001`);
    }
    output({ wallet: wallet.wallet, identity: identity.identity, balance: bal.balance });
  });

// ============================================================
// INTERACTIVE MODE COMMAND
// ============================================================

program
  .command('interactive')
  .description('Start interactive mode with guided prompts')
  .action(() => {
    runInteractiveMode();
  });

// ============================================================
// PARSE & EXECUTE
// ============================================================

program.parse(process.argv);

// Show help if no command provided
if (process.argv.length === 2) {
  if (!JSON_OUTPUT && !QUIET) {
    console.log(colors.dim('Usage: node cli.js <command> [args]\n'));
    console.log(colors.dim(`API base: ${API}`));
    console.log(colors.dim('Env: set AGENT_WALLET_API and AGENT_WALLET_API_KEY to point at your service.\n'));
    console.log(colors.dim('Quickstart:\n'));
    console.log(colors.dim('  1) Start the server: npm start'));
    console.log(colors.dim('  2) Run onboarding: node cli.js setup --init'));
    console.log(colors.dim('  3) Create a wallet: node cli.js create MyBot base-sepolia'));
    console.log(colors.dim('  4) Enter interactive mode: node cli.js interactive\n'));
    console.log(colors.dim('Run with --help for more information.'));
  } else if (JSON_OUTPUT) {
    output({ error: 'No command provided', usage: 'node cli.js <command> [args]' });
  }
  process.exit(1);
}
