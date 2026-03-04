/**
 * IPFS Metadata Storage Service
 * 
 * Store and retrieve agent metadata, identities, and other data on IPFS
 * Supports: Pinata, Infura, Web3.Storage, or local IPFS nodes
 */

import { randomUUID } from 'crypto';

/**
 * IPFS Service
 */
export class IPFSService {
  constructor(options = {}) {
    this.provider = options.provider || 'pinata'; // pinata, infura, web3storage, local
    this.apiKey = options.apiKey || process.env.IPFS_API_KEY;
    this.apiSecret = options.apiSecret || process.env.IPFS_API_SECRET;
    this.projectId = options.projectId || process.env.IPFS_PROJECT_ID;
    this.projectSecret = options.projectSecret || process.env.IPFS_PROJECT_SECRET;
    this.gateway = options.gateway || process.env.IPFS_GATEWAY || 'https://gateway.pinata.cloud/ipfs/';
    this.localNode = options.localNode || process.env.IPFS_LOCAL_NODE || 'http://localhost:5001';
  }

  /**
   * Upload JSON to IPFS
   */
  async uploadJSON(data, options = {}) {
    const jsonString = JSON.stringify(data);
    return this.upload(Buffer.from(jsonString), {
      ...options,
      contentType: 'application/json',
    });
  }

  /**
   * Upload file to IPFS
   */
  async upload(fileBuffer, options = {}) {
    const { contentType = 'application/octet-stream', pin = true } = options;

    switch (this.provider) {
      case 'pinata':
        return this._uploadPinata(fileBuffer, contentType, pin);
      case 'infura':
        return this._uploadInfura(fileBuffer, contentType);
      case 'web3storage':
        return this._uploadWeb3Storage(fileBuffer);
      case 'local':
        return this._uploadLocal(fileBuffer);
      default:
        throw new Error(`Unknown IPFS provider: ${this.provider}`);
    }
  }

  /**
   * Upload to Pinata
   */
  async _uploadPinata(buffer, contentType, pin) {
    const FormData = require('form-data');
    const form = new FormData();
    
    form.append('file', buffer, {
      filename: `upload-${Date.now()}.json`,
      contentType,
    });

    if (pin) {
      form.append('pinataOptions', JSON.stringify({
        cidVersion: 1,
      }));
    }

    const response = await fetch('https://api.pinata.cloud/pinning/pinFileToIPFS', {
      method: 'POST',
      headers: {
        'pinata_api_key': this.apiKey,
        'pinata_secret_api_key': this.apiSecret,
        ...form.getHeaders(),
      },
      body: form,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Pinata upload failed: ${error}`);
    }

    const result = await response.json();
    return {
      cid: result.IpfsHash,
      size: result.PinSize,
      url: `${this.gateway}${result.IpfsHash}`,
    };
  }

  /**
   * Upload to Infura
   */
  async _uploadInfura(buffer, contentType) {
    const auth = Buffer.from(`${this.projectId}:${this.projectSecret}`).toString('base64');
    
    const response = await fetch(`https://ipfs.infura.io:5001/api/v0/add?pin=true`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': contentType,
      },
      body: buffer,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Infura upload failed: ${error}`);
    }

    const result = await response.json();
    return {
      cid: result.Hash,
      size: result.Size,
      url: `https://ipfs.io/ipfs/${result.Hash}`,
    };
  }

  /**
   * Upload to Web3.Storage
   */
  async _uploadWeb3Storage(buffer) {
    const response = await fetch('https://api.web3.storage/upload', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/x-empty',
      },
      body: buffer,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Web3.Storage upload failed: ${error}`);
    }

    const cid = await response.text();
    return {
      cid,
      size: buffer.length,
      url: `https://ipfs.io/ipfs/${cid}`,
    };
  }

  /**
   * Upload to local IPFS node
   */
  async _uploadLocal(buffer) {
    const FormData = require('form-data');
    const formData = new FormData();
    formData.append('file', buffer);

    const response = await fetch(`${this.localNode}/api/v0/add?pin=true`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Local IPFS upload failed: ${error}`);
    }

    const result = await response.json();
    return {
      cid: result.Hash,
      size: result.Size,
      url: `http://localhost:8080/ipfs/${result.Hash}`,
    };
  }

  /**
   * Get file from IPFS
   */
  async get(cid, options = {}) {
    const { timeout = 30000 } = options;
    
    // Try gateway first
    try {
      const response = await fetch(`${this.gateway}${cid}`, {
        signal: AbortSignal.timeout(timeout),
      });
      
      if (response.ok) {
        const contentType = response.headers.get('content-type');
        if (contentType?.includes('application/json')) {
          return await response.json();
        }
        return await response.text();
      }
    } catch (error) {
      console.warn(`Gateway fetch failed, trying direct: ${error.message}`);
    }

    // Fallback to direct IPFS
    try {
      const response = await fetch(`https://ipfs.io/ipfs/${cid}`, {
        signal: AbortSignal.timeout(timeout),
      });
      
      if (response.ok) {
        return await response.json();
      }
    } catch (error) {
      throw new Error(`Failed to fetch ${cid}: ${error.message}`);
    }

    throw new Error(`Could not retrieve ${cid} from any gateway`);
  }

  /**
   * Pin existing CID (ensure persistence)
   */
  async pin(cid) {
    switch (this.provider) {
      case 'pinata':
        return this._pinPinata(cid);
      case 'infura':
        return this._pinInfura(cid);
      default:
        console.warn(`Pin not supported for provider: ${this.provider}`);
        return { cid, pinned: false };
    }
  }

  /**
   * Pin on Pinata
   */
  async _pinPinata(cid) {
    const response = await fetch('https://api.pinata.cloud/pinning/pinByHash', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'pinata_api_key': this.apiKey,
        'pinata_secret_api_key': this.apiSecret,
      },
      body: JSON.stringify({
        hashToPin: cid,
        pinataOptions: {
          cidVersion: 1,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Pinata pin failed: ${await response.text()}`);
    }

    return { cid, pinned: true };
  }

  /**
   * Pin on Infura
   */
  async _pinInfura(cid) {
    const auth = Buffer.from(`${this.projectId}:${this.projectSecret}`).toString('base64');
    
    const response = await fetch(`https://ipfs.infura.io:5001/api/v0/pin/add?arg=${cid}`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Infura pin failed: ${await response.text()}`);
    }

    return { cid, pinned: true };
  }

  /**
   * Unpin CID
   */
  async unpin(cid) {
    switch (this.provider) {
      case 'pinata':
        return this._unpinPinata(cid);
      default:
        console.warn(`Unpin not supported for provider: ${this.provider}`);
        return { cid, unpinned: false };
    }
  }

  /**
   * Unpin on Pinata
   */
  async _unpinPinata(cid) {
    const response = await fetch('https://api.pinata.cloud/pinning/removePin', {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'pinata_api_key': this.apiKey,
        'pinata_secret_api_key': this.apiSecret,
      },
      body: JSON.stringify({
        ipfsPinHash: cid,
      }),
    });

    if (!response.ok) {
      throw new Error(`Pinata unpin failed: ${await response.text()}`);
    }

    return { cid, unpinned: true };
  }

  /**
   * Get IPFS gateway URL for a CID
   */
  getGatewayURL(cid) {
    return `${this.gateway}${cid}`;
  }
}

/**
 * Agent Metadata Storage
 * Uses IPFS for decentralized metadata storage
 */
export class AgentMetadataStore {
  constructor(ipfsService) {
    this.ipfs = ipfsService;
    this.cache = new Map(); // Simple in-memory cache
  }

  /**
   * Store agent metadata
   */
  async storeAgentMetadata(agentId, metadata) {
    const data = {
      agentId,
      metadata,
      timestamp: new Date().toISOString(),
      version: 1,
    };

    const result = await this.ipfs.uploadJSON(data);
    
    // Cache locally
    this.cache.set(agentId, {
      cid: result.cid,
      data,
    });

    return {
      cid: result.cid,
      url: result.url,
      agentId,
    };
  }

  /**
   * Get agent metadata
   */
  async getAgentMetadata(agentId, cid = null) {
    // Check cache first
    if (!cid && this.cache.has(agentId)) {
      return this.cache.get(agentId).data;
    }

    // Fetch from IPFS
    if (cid) {
      const data = await this.ipfs.get(cid);
      this.cache.set(agentId, { cid, data });
      return data;
    }

    throw new Error('CID required for new fetch');
  }

  /**
   * Update agent metadata (creates new version)
   */
  async updateAgentMetadata(agentId, updates, previousCid) {
    // Get previous version
    const previous = await this.getAgentMetadata(agentId, previousCid);
    
    const newData = {
      ...previous,
      ...updates,
      agentId,
      previousCid,
      timestamp: new Date().toISOString(),
      version: (previous.version || 0) + 1,
    };

    const result = await this.ipfs.uploadJSON(newData);
    
    return {
      cid: result.cid,
      url: result.url,
      version: newData.version,
    };
  }

  /**
   * Store identity document
   */
  async storeIdentity(identityId, identityData) {
    const data = {
      type: 'ERC-8004-Identity',
      identityId,
      ...identityData,
      timestamp: new Date().toISOString(),
    };

    const result = await this.ipfs.uploadJSON(data);
    return {
      cid: result.cid,
      url: result.url,
    };
  }

  /**
   * Store service listing
   */
  async storeServiceListing(serviceId, listingData) {
    const data = {
      type: 'ServiceListing',
      serviceId,
      ...listingData,
      timestamp: new Date().toISOString(),
    };

    const result = await this.ipfs.uploadJSON(data);
    return {
      cid: result.cid,
      url: result.url,
    };
  }

  /**
   * Clear cache
   */
  clearCache(agentId = null) {
    if (agentId) {
      this.cache.delete(agentId);
    } else {
      this.cache.clear();
    }
  }
}

/**
 * Singleton instances
 */
let ipfsService = null;
let metadataStore = null;

export function getIPFSService(options = {}) {
  if (!ipfsService) {
    ipfsService = new IPFSService(options);
  }
  return ipfsService;
}

export function getMetadataStore(options = {}) {
  if (!metadataStore) {
    const ipfs = getIPFSService(options);
    metadataStore = new AgentMetadataStore(ipfs);
  }
  return metadataStore;
}

export default {
  IPFSService,
  AgentMetadataStore,
  getIPFSService,
  getMetadataStore,
};
