#!/usr/bin/env node

/**
 * Quick Start Demo
 * 
 * Run this to see the wallet service in action
 */

import AgentWallet from './sdk.js';

async function main() {
  console.log('🦞 Agent Wallet Service — Quick Start\n');
  console.log('=' .repeat(50));

  const wallet = new AgentWallet();

  // 1. Create wallets
  console.log('\n📦 Step 1: Create Wallets');
  console.log('Creating sender wallet...');
  const sender = await wallet.createWallet('Alice');
  console.log(`✅ Sender: ${sender.wallet.address}`);

  console.log('Creating receiver wallet...');
  const receiver = await wallet.createWallet('Bob');
  console.log(`✅ Receiver: ${receiver.wallet.address}`);

  // 2. Check balance
  console.log('\n💰 Step 2: Check Balance');
  const balance = await wallet.getBalance(sender.wallet.address);
  console.log(`Balance: ${balance.balance?.eth || 0} ETH`);

  // 3. Fee info
  console.log('\n📊 Step 3: Fee Configuration');
  const fees = await wallet.getFees();
  console.log(`Fee: ${fees.feePercent}`);
  console.log(`Treasury: ${fees.treasuryAddress}`);

  // 4. List all wallets
  console.log('\n📋 Step 4: All Wallets');
  const all = await wallet.listWallets();
  console.log(`Total wallets: ${all.wallets.length}`);

  // 5. Transaction instructions
  console.log('\n🚀 Step 5: Send a Transaction');
  console.log('To send a transaction:');
  console.log(`1. Fund the wallet: https://faucet.circle.com/`);
  console.log(`   Address: ${sender.wallet.address}`);
  console.log(`2. Run: node cli.js send ${sender.wallet.address} ${receiver.wallet.address} 0.0001`);

  console.log('\n' + '='.repeat(50));
  console.log('✅ Demo complete!');
  console.log('\nAPI running at: http://localhost:3000');
  console.log('Docs: https://github.com/your-repo/agent-wallet-service');
}

main().catch(console.error);
