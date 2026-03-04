#!/usr/bin/env node

/**
 * 🩺 CLAW Doctor — Service Diagnostic Tool
 *
 * Checks every component of the Agent Wallet Service:
 * database, encryption, API keys, RPCs, env vars, and more.
 */

import Database from 'better-sqlite3';
import { join } from 'path';
import { existsSync, statSync } from 'fs';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

// ============================================================
// ANSI STYLING
// ============================================================
const c = {
    reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
    red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
    blue: '\x1b[34m', magenta: '\x1b[35m', cyan: '\x1b[36m',
    gray: '\x1b[90m', brightWhite: '\x1b[97m', brightCyan: '\x1b[96m',
    brightGreen: '\x1b[92m', brightRed: '\x1b[91m', brightYellow: '\x1b[93m',
};

let passCount = 0;
let failCount = 0;
let warnCount = 0;

function pass(test, detail = '') {
    passCount++;
    console.log(`  ${c.green}✅ PASS${c.reset}  ${c.brightWhite}${test}${c.reset}${detail ? `  ${c.gray}${detail}${c.reset}` : ''}`);
}
function fail(test, detail = '') {
    failCount++;
    console.log(`  ${c.red}❌ FAIL${c.reset}  ${c.brightWhite}${test}${c.reset}${detail ? `  ${c.brightRed}${detail}${c.reset}` : ''}`);
}
function warning(test, detail = '') {
    warnCount++;
    console.log(`  ${c.yellow}⚠️  WARN${c.reset}  ${c.brightWhite}${test}${c.reset}${detail ? `  ${c.yellow}${detail}${c.reset}` : ''}`);
}
function section(title) {
    console.log(`\n  ${c.bold}${c.brightCyan}━━ ${title} ━━${c.reset}`);
}

// ============================================================
// CHECKS
// ============================================================

const BASE_DIR = process.cwd();
const DB_PATH = join(BASE_DIR, 'database.sqlite');

function checkDatabase() {
    section('📦 Database');

    // File exists
    if (!existsSync(DB_PATH)) {
        fail('database.sqlite exists', 'File not found');
        return null;
    }

    const stats = statSync(DB_PATH);
    pass('database.sqlite exists', `${(stats.size / 1024).toFixed(1)} KB`);

    // Open and check tables
    let db;
    try {
        db = new Database(DB_PATH, { readonly: true });
        pass('Database opens successfully');
    } catch (e) {
        fail('Database opens successfully', e.message);
        return null;
    }

    const requiredTables = ['wallets', 'identities', 'api_keys', 'ens_registrations', 'transactions', 'erc8004_registrations', 'rate_limit_hits'];
    const existingTables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);

    for (const table of requiredTables) {
        if (existingTables.includes(table)) {
            const count = db.prepare(`SELECT COUNT(*) as cnt FROM ${table}`).get().cnt;
            pass(`Table: ${table}`, `${count} row(s)`);
        } else {
            fail(`Table: ${table}`, 'Missing');
        }
    }

    return db;
}

function checkApiKeys(db) {
    section('🔑 API Keys');

    if (!db) { fail('API key check', 'Database not available'); return; }

    const keys = db.prepare('SELECT * FROM api_keys').all();
    if (keys.length === 0) {
        fail('At least one API key exists');
        return;
    }
    pass(`${keys.length} API key(s) found`);

    // Check key format
    for (const key of keys) {
        if (key.key.startsWith('sk_live_') || key.key.startsWith('sk_')) {
            pass(`Key "${key.name}" format`, `${key.key.slice(0, 12)}...`);
        } else {
            warning(`Key "${key.name}" format`, 'Unexpected prefix');
        }

        // Check permissions parse
        try {
            const perms = JSON.parse(key.permissions);
            if (Array.isArray(perms) && perms.length > 0) {
                pass(`Key "${key.name}" permissions`, perms.join(', '));
            } else {
                warning(`Key "${key.name}" permissions`, 'Empty or invalid');
            }
        } catch {
            fail(`Key "${key.name}" permissions`, 'Invalid JSON');
        }
    }
}

function checkWallets(db) {
    section('👛 Wallets');

    if (!db) { fail('Wallet check', 'Database not available'); return; }

    const wallets = db.prepare('SELECT * FROM wallets').all();
    if (wallets.length === 0) {
        warning('Wallet storage', 'No wallets found');
        return;
    }
    pass(`${wallets.length} wallet(s) found`);

    // Check encrypted key format
    let validKeys = 0;
    let legacyKeys = 0;
    for (const w of wallets) {
        const parts = (w.encrypted_key || '').split(':');
        if (parts.length === 3 && parts[0].length === 32) {
            validKeys++;
        } else if (w.encrypted_key?.startsWith('0x')) {
            legacyKeys++;
        }
    }

    if (validKeys > 0) pass(`${validKeys} wallet(s) with AES-256-GCM encryption`);
    if (legacyKeys > 0) warning(`${legacyKeys} wallet(s) with plaintext keys`, 'Run a re-encryption cycle');
    if (validKeys === 0 && legacyKeys === 0) fail('Wallet key format', 'Unknown encryption format');
}

function checkEncryption() {
    section('🔒 Encryption');

    try {
        const key = process.env.WALLET_ENCRYPTION_KEY || 'test-key-fallback';
        const salt = process.env.WALLET_ENCRYPTION_SALT || 'agent-wallet-service-salt';
        const derivedKey = scryptSync(key, salt, 32);

        // Test encrypt
        const testData = '0xdeadbeef1234567890abcdef';
        const iv = randomBytes(16);
        const cipher = createCipheriv('aes-256-gcm', derivedKey, iv);
        let encrypted = cipher.update(testData, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        const authTag = cipher.getAuthTag();
        const encryptedStr = `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;

        // Test decrypt
        const [ivHex, authTagHex, encData] = encryptedStr.split(':');
        const decipher = createDecipheriv('aes-256-gcm', derivedKey, Buffer.from(ivHex, 'hex'));
        decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
        let decrypted = decipher.update(encData, 'hex', 'utf8');
        decrypted += decipher.final('utf8');

        if (decrypted === testData) {
            pass('Encrypt/decrypt roundtrip');
        } else {
            fail('Encrypt/decrypt roundtrip', 'Data mismatch');
        }
    } catch (e) {
        fail('Encryption', e.message);
    }

    if (process.env.WALLET_ENCRYPTION_KEY) {
        pass('WALLET_ENCRYPTION_KEY is set');
    } else {
        warning('WALLET_ENCRYPTION_KEY is set', 'Using fallback — set it for production');
    }
}

function checkEnvironment() {
    section('🌍 Environment');

    const vars = [
        { name: 'PORT', critical: false, default: '3000' },
        { name: 'WALLET_ENCRYPTION_KEY', critical: true },
        { name: 'ALCHEMY_API_KEY', critical: false },
        { name: 'TREASURY_ADDRESS', critical: false },
        { name: 'FEE_BASIS_POINTS', critical: false, default: '50' },
    ];

    for (const v of vars) {
        if (process.env[v.name]) {
            pass(v.name, `Set (${process.env[v.name].slice(0, 8)}...)`);
        } else if (v.critical) {
            warning(v.name, 'Not set — recommended for production');
        } else {
            pass(v.name, `Using default${v.default ? `: ${v.default}` : ''}`);
        }
    }
}

async function checkServerHealth() {
    section('🌐 Server Health');

    const url = `http://localhost:${process.env.PORT || 3000}`;
    try {
        const res = await fetch(`${url}/health`);
        const data = await res.json();
        if (data.status === 'ok') {
            pass('Server is running', `v${data.version} on ${url}`);
            pass(`Features: ${data.features.join(', ')}`);
        } else {
            fail('Server health', `Unexpected status: ${data.status}`);
        }
    } catch (e) {
        if (e.cause?.code === 'ECONNREFUSED') {
            warning('Server is running', `Not reachable at ${url} — start with: npm start`);
        } else {
            fail('Server health', e.message);
        }
    }
}

async function checkRPCConnectivity() {
    section('⛓️  RPC Connectivity');

    const rpcs = [
        { name: 'Base Sepolia', url: 'https://sepolia.base.org' },
        { name: 'Ethereum Sepolia', url: 'https://ethereum-sepolia.publicnode.com' },
        { name: 'Base Mainnet', url: 'https://mainnet.base.org' },
    ];

    for (const rpc of rpcs) {
        try {
            const res = await fetch(rpc.url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1 }),
                signal: AbortSignal.timeout(5000),
            });
            const data = await res.json();
            if (data.result) {
                const block = parseInt(data.result, 16);
                pass(rpc.name, `Block #${block.toLocaleString()}`);
            } else {
                warning(rpc.name, 'Unexpected response');
            }
        } catch (e) {
            fail(rpc.name, e.message?.includes('timeout') ? 'Timed out (5s)' : e.message);
        }
    }
}

function checkDependencies() {
    section('📦 Dependencies');

    const deps = ['better-sqlite3', 'viem', 'express', 'cors', 'dotenv'];
    for (const dep of deps) {
        const depPath = join(BASE_DIR, 'node_modules', dep);
        if (existsSync(depPath)) {
            try {
                const pkg = JSON.parse(require('fs').readFileSync(join(depPath, 'package.json'), 'utf-8'));
                pass(dep, `v${pkg.version}`);
            } catch {
                pass(dep, 'installed');
            }
        } else {
            fail(dep, 'Not installed — run: npm install');
        }
    }
}

function checkRateLimiting(db) {
    section('🛡️  Rate Limiting');

    if (!db) { fail('Rate limit check', 'Database not available'); return; }

    const count = db.prepare('SELECT COUNT(*) as cnt FROM rate_limit_hits').get().cnt;
    pass(`Rate limit entries: ${count}`);

    // Check for stale entries
    const staleThreshold = Date.now() - (5 * 60 * 1000); // 5 min ago
    const stale = db.prepare('SELECT COUNT(*) as cnt FROM rate_limit_hits WHERE timestamp < ?').get(staleThreshold).cnt;
    if (stale > 0) {
        warning(`${stale} stale rate limit entries`, 'Cleanup runs on next request');
    } else {
        pass('No stale rate limit entries');
    }
}

async function checkENSPricing() {
    section('💰 ENS Pricing (Coinbase API)');

    try {
        const res = await fetch('https://api.coinbase.com/v2/prices/ETH-USD/spot', {
            signal: AbortSignal.timeout(5000),
        });
        const data = await res.json();
        if (data.data?.amount) {
            pass('Coinbase ETH price API', `$${parseFloat(data.data.amount).toLocaleString()}`);
        } else {
            warning('Coinbase ETH price API', 'Unexpected response format');
        }
    } catch (e) {
        fail('Coinbase ETH price API', e.message?.includes('timeout') ? 'Timed out (5s)' : e.message);
    }
}

function checkLegacyFiles() {
    section('📂 Legacy Files');

    const legacyFiles = ['wallets.json', 'api-keys.json', 'agent-identities.json', 'ens-registrations.json', 'transactions.json'];
    const found = [];
    for (const file of legacyFiles) {
        const path = join(BASE_DIR, file);
        if (existsSync(path)) {
            found.push(file);
        }
    }

    if (found.length > 0) {
        warning(`${found.length} legacy JSON file(s) found`, found.join(', '));
        console.log(`  ${c.gray}        These can be safely removed after migration${c.reset}`);
    } else {
        pass('No legacy JSON files');
    }
}

// ============================================================
// MAIN
// ============================================================

async function main() {
    console.log('');
    console.log(`  ${c.bold}${c.brightCyan}🩺 CLAW Doctor${c.reset}  ${c.gray}— Service Diagnostic Tool${c.reset}`);
    console.log(`  ${c.gray}${'─'.repeat(45)}${c.reset}`);

    const db = checkDatabase();
    checkApiKeys(db);
    checkWallets(db);
    checkEncryption();
    checkEnvironment();
    checkDependencies();
    checkRateLimiting(db);
    checkLegacyFiles();
    await checkServerHealth();
    await checkRPCConnectivity();
    await checkENSPricing();

    if (db) db.close();

    // Summary
    console.log(`\n  ${c.gray}${'─'.repeat(45)}${c.reset}`);
    const total = passCount + failCount + warnCount;
    console.log(`  ${c.bold}Results:${c.reset} ${c.green}${passCount} passed${c.reset} · ${failCount > 0 ? c.red : c.gray}${failCount} failed${c.reset} · ${warnCount > 0 ? c.yellow : c.gray}${warnCount} warnings${c.reset} · ${total} total`);

    if (failCount === 0) {
        console.log(`\n  ${c.brightGreen}${c.bold}🎉 All critical checks passed! Your service is healthy.${c.reset}`);
    } else {
        console.log(`\n  ${c.brightRed}${c.bold}⚠️  ${failCount} check(s) failed. Review the issues above.${c.reset}`);
    }
    console.log('');

    process.exit(failCount > 0 ? 1 : 0);
}

main().catch(e => {
    console.error(`  ${c.red}Doctor crashed: ${e.message}${c.reset}`);
    process.exit(1);
});
