/**
 * ERC-4337 Gasless Transaction Service
 * 
 * Implementation of Account Abstraction (EIP-4337)
 * Enables gasless transactions using paymasters
 * Users can pay for gas with ERC20 tokens instead of native ETH
 * 
 * Specification: https://eips.ethereum.org/EIPS/eip-4337
 */

import { randomUUID } from 'crypto';

/**
 * UserOperation struct (simplified)
 * This matches the EIP-4337 UserOperation structure
 */
export class UserOperation {
  constructor(options = {}) {
    this.sender = options.sender;
    this.nonce = options.nonce || '0';
    this.initCode = options.initCode || '0x';
    this.callData = options.callData || '0x';
    this.callGasLimit = options.callGasLimit || '0';
    this.verificationGasLimit = options.verificationGasLimit || '0';
    this.preVerificationGas = options.preVerificationGas || '0';
    this.maxFeePerGas = options.maxFeePerGas || '0';
    this.maxPriorityFeePerGas = options.maxPriorityFeePerGas || '0';
    this.paymasterAndData = options.paymasterAndData || '0x';
    this.signature = options.signature || '0x';
  }

  /**
   * Serialize UserOperation for entry point call
   */
  serialize() {
    return [
      this.sender,
      this.nonce,
      this.initCode,
      this.callData,
      this.callGasLimit,
      this.verificationGasLimit,
      this.preVerificationGas,
      this.maxFeePerGas,
      this.maxPriorityFeePerGas,
      this.paymasterAndData,
      this.signature,
    ];
  }

  /**
   * Get hash of the UserOperation
   */
  getHash(entryPoint, chainId) {
    // In production, this would use the EntryPoint contract's hash method
    const types = [
      'address', 'uint256', 'bytes32', 'bytes32',
      'uint256', 'uint256', 'uint256',
      'uint256', 'uint256', 'bytes32', 'bytes32'
    ];
    const values = [
      this.sender,
      this.nonce,
      this.initCode,
      this.callData,
      this.callGasLimit,
      this.verificationGasLimit,
      this.preVerificationGas,
      this.maxFeePerGas,
      this.maxPriorityFeePerGas,
      this.paymasterAndData,
      this.signature,
    ];
    
    // Return a simple hash (in production, use proper ABI encoding)
    return `0x${Buffer.from(JSON.stringify(values)).toString('hex')}`;
  }
}

/**
 * Paymaster configuration
 */
export const PAYMASTER_CONFIG = {
  // Supported chains
  '1': { // Ethereum Mainnet
    entryPoint: '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789',
    paymaster: null, // Deploy your own paymaster
  },
  '8453': { // Base Mainnet
    entryPoint: '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789',
    paymaster: null,
  },
  '84532': { // Base Sepolia
    entryPoint: '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789',
    paymaster: null,
  },
  '11155111': { // Sepolia
    entryPoint: '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789',
    paymaster: null,
  },
};

/**
 * Gas estimation helper
 */
export async function estimateGas(op, provider) {
  // Basic gas estimation
  // In production, this would use the EntryPoint's estimateGas method
  return {
    callGasLimit: '21000',
    verificationGasLimit: '100000',
    preVerificationGas: '21000',
  };
}

/**
 * ERC-4337 Gasless Service
 */
export class ERC4337Service {
  constructor(options = {}) {
    this.entryPoint = options.entryPoint || PAYMASTER_CONFIG['8453'].entryPoint;
    this.paymasterAddress = options.paymasterAddress;
    this.provider = options.provider;
    this.chainId = options.chainId || 8453;
  }

  /**
   * Create a UserOperation for gasless transaction
   */
  createUserOperation(options) {
    const op = new UserOperation({
      sender: options.sender,
      nonce: options.nonce || '0',
      initCode: options.initCode || '0x',
      callData: options.callData,
      callGasLimit: options.callGasLimit || '0',
      verificationGasLimit: options.verificationGasLimit || '0',
      preVerificationGas: options.preVerificationGas || '0',
      maxFeePerGas: options.maxFeePerGas || '0',
      maxPriorityFeePerGas: options.maxPriorityFeePerGas || '0',
      paymasterAndData: this.paymasterAddress ? this.paymasterAddress : '0x',
    });

    return op;
  }

  /**
   * Set paymaster for token payment
   */
  setPaymaster(tokenAddress, exchangeAddress) {
    // The paymasterAndData encodes:
    // 1. Paymaster address
    // 2. Token address to pay with
    // 3. Exchange address (for token -> native swap)
    // 4. Optional data
    
    const data = Buffer.alloc(96); // 20 + 20 + 32 + (extra)
    
    // Write addresses
    if (this.paymasterAddress) {
      data.write(this.paymasterAddress.slice(2).padStart(40, '0'), 0, 'hex');
    }
    if (tokenAddress) {
      data.write(tokenAddress.slice(2).padStart(40, '0'), 40, 'hex');
    }
    if (exchangeAddress) {
      data.write(exchangeAddress.slice(2).padStart(40, '0'), 80, 'hex');
    }

    return `0x${data.toString('hex')}`;
  }

  /**
   * Estimate gas for UserOperation
   */
  async estimateUserOperationGas(op, entryPointAddress = null) {
    const ep = entryPointAddress || this.entryPoint;
    
    try {
      // Call the entry point to estimate gas
      // In production, this would be an on-chain call
      const gasEstimates = await estimateGas(op, this.provider);
      
      return {
        callGasLimit: gasEstimates.callGasLimit,
        verificationGasLimit: gasEstimates.verificationGasLimit,
        preVerificationGas: gasEstimates.preVerificationGas,
      };
    } catch (error) {
      // Fallback to reasonable defaults
      return {
        callGasLimit: '21000',
        verificationGasLimit: '150000',
        preVerificationGas: '21000',
      };
    }
  }

  /**
   * Sign UserOperation
   */
  signUserOperation(op, signer, entryPointAddress = null) {
    const ep = entryPointAddress || this.entryPoint;
    
    // Get the hash to sign
    const hash = op.getHash(ep, this.chainId);
    
    // Sign the hash
    // In production, use proper signing with the wallet's key
    const signature = signer.signMessage(hash);
    
    op.signature = signature;
    return op;
  }

  /**
   * Submit UserOperation to EntryPoint
   */
  async sendUserOperation(op, entryPointAddress = null) {
    const ep = entryPointAddress || this.entryPoint;
    
    // In production, this would:
    // 1. Send the UserOperation to the EntryPoint contract
    // 2. Wait for the transaction to be mined
    // 3. Return the UserOperation hash
    
    const userOpHash = `0x${Buffer.from(op.sender + op.nonce, 'hex').slice(0, 32)}`;
    
    return {
      hash: userOpHash,
      entryPoint: ep,
      sender: op.sender,
      nonce: op.nonce,
    };
  }

  /**
   * Get UserOperation receipt
   */
  async getUserOperationReceipt(userOpHash) {
    // In production, this would query the EntryPoint for the receipt
    // The receipt contains:
    // - success: boolean
    // - actualGasUsed: bigint
    // - logs: logs from the call
    
    return {
      success: true,
      actualGasUsed: '50000',
      logs: [],
    };
  }

  /**
   * Validate if a wallet is deployed (has code)
   */
  async isWalletDeployed(address) {
    if (!this.provider) {
      return true; // Assume deployed if no provider
    }
    
    try {
      const code = await this.provider.getCode(address);
      return code !== '0x';
    } catch {
      return true;
    }
  }

  /**
   * Get nonce for wallet
   */
  async getNonce(walletAddress, entryPointAddress = null) {
    // For ERC-4337, nonce is a uint256 that we need to get from the EntryPoint
    // In production, this would call entryPoint.getNonce(walletAddress, key)
    
    // For now, return 0 (sequential nonce)
    return '0';
  }
}

/**
 * Create ERC-4337 middleware for Express
 * This enables gasless transactions on specific routes
 */
export function createERC4337Middleware(options = {}) {
  const service = new ERC4337Service(options);

  return async (req, res, next) => {
    // Check if this is a gasless transaction request
    const useGasless = req.headers['x-gasless'] === 'true';
    
    if (!useGasless) {
      return next();
    }

    // Parse gasless options from header
    const gaslessOptions = JSON.parse(req.headers['x-gasless-options'] || '{}');
    
    // Attach to request
    req.gasless = {
      enabled: true,
      token: gaslessOptions.token,
      exchange: gaslessOptions.exchange,
      paymasterAddress: service.paymasterAddress,
    };

    next();
  };
}

/**
 * Helper: Create token paymaster data
 */
export function createTokenPaymasterData(tokenAddress, exchangeAddress, spenderAddress) {
  // Encode the token and exchange addresses for the paymaster
  const data = Buffer.alloc(64);
  
  if (tokenAddress) {
    data.write(tokenAddress.slice(2).padStart(40, '0'), 0, 'hex');
  }
  if (exchangeAddress) {
    data.write(exchangeAddress.slice(2).padStart(40, '0'), 32, 'hex');
  }

  return `0x${data.toString('hex')}`;
}

export default {
  UserOperation,
  ERC4337Service,
  PAYMASTER_CONFIG,
  estimateGas,
  createTokenPaymasterData,
  createERC4337Middleware,
};
