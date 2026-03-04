async function test() {
    console.log('STARTING DYNAMIC IMPORT TEST');

    try {
        console.log('Testing dotenv...');
        await import('dotenv/config');
        console.log('dotenv OK');

        console.log('Testing express...');
        await import('express');
        console.log('express OK');

        console.log('Testing logger...');
        await import('./src/services/logger.js');
        console.log('logger OK');

        console.log('Testing db...');
        await import('./src/services/db.js');
        console.log('db OK');

        console.log('Testing viem-wallet...');
        await import('./src/services/viem-wallet.js');
        console.log('viem-wallet OK');

        console.log('Testing wallet routes...');
        await import('./src/routes/wallet.js');
        console.log('wallet routes OK');

        console.log('Testing ens routes...');
        await import('./src/routes/ens.js');
        console.log('ens routes OK');

        console.log('Testing social routes...');
        await import('./src/routes/social.js');
        console.log('social routes OK');

        console.log('ALL IMPORTS PASSED');
    } catch (err) {
        console.error('IMPORT FAILED:', err);
    }
}

test();
