"""
CLAW Wallet Python SDK - Client
=================================

Main client for interacting with the Agent Wallet Service API.
"""

import os
from typing import Optional, List, Dict, Any
from urllib.parse import urljoin

import requests

from .exceptions import (
    CLAWWalletError,
    AuthenticationError,
    RateLimitError,
    WalletNotFoundError,
    ValidationError,
)
from .models import Wallet, Balance, Transaction, Identity, Policy


class WalletClient:
    """
    Client for the Agent Wallet Service API.
    
    Args:
        api_key: Your API key for authentication
        base_url: Base URL of the wallet service (default: http://localhost:3000)
        timeout: Request timeout in seconds (default: 30)
    
    Example:
        >>> from claw_wallet import WalletClient
        >>> client = WalletClient(api_key="sk_live_...")
        >>> wallet = client.create_wallet("MyAgent", chain="base-sepolia")
        >>> print(f"Created wallet: {wallet.address}")
    """
    
    # Supported chains
    SUPPORTED_CHAINS = [
        "ethereum",
        "base",
        "base-sepolia",
        "polygon",
        "polygon-zkevm",
        "arbitrum",
        "arbitrum-sepolia",
        "optimism",
        "solana",
        "aptos",
        "sui",
        "starknet",
        "zksync",
    ]
    
    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: str = "http://localhost:3000",
        timeout: int = 30,
        rpc_url: Optional[str] = None,
    ):
        self.api_key = api_key or os.environ.get("CLAW_WALLET_API_KEY")
        if not self.api_key:
            raise ValueError("api_key is required")
        
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.rpc_url = rpc_url or os.environ.get("CLAW_WALLET_RPC_URL")
        self._session = requests.Session()
        self._session.headers.update({
            "Content-Type": "application/json",
            "X-API-Key": self.api_key,
            "User-Agent": f"claw-wallet-python/{self._get_version()}",
        })
    
    def _get_version(self) -> str:
        """Get SDK version."""
        from . import __version__
        return __version__
    
    def _request(
        self,
        method: str,
        path: str,
        data: Optional[Dict[str, Any]] = None,
        params: Optional[Dict[str, Any]] = None,
        headers: Optional[Dict[str, str]] = None,
    ) -> Dict[str, Any]:
        """Make an HTTP request to the API."""
        url = urljoin(self.base_url + "/", path.lstrip("/"))
        
        try:
            response = self._session.request(
                method=method,
                url=url,
                json=data,
                params=params,
                headers=headers,
                timeout=self.timeout,
            )
        except requests.exceptions.RequestException as e:
            raise CLAWWalletError(f"Request failed: {e}")
        
        # Check for rate limiting
        if response.status_code == 429:
            raise RateLimitError(
                "Rate limit exceeded",
                retry_after=response.headers.get("Retry-After"),
            )
        
        # Check for authentication errors
        if response.status_code == 401:
            raise AuthenticationError("Invalid or missing API key")
        if response.status_code == 403:
            try:
                body = response.json()
                raise AuthenticationError(body.get("error", "Permission denied"))
            except ValueError:
                raise AuthenticationError("Permission denied")
        
        # Parse response
        try:
            body = response.json()
        except ValueError:
            if response.status_code >= 400:
                raise CLAWWalletError(f"API error: {response.text}")
            return {}
        
        if not response.ok:
            error_msg = body.get("error", "Unknown error")
            if body.get("error_code") == "WALLET_NOT_FOUND":
                raise WalletNotFoundError(error_msg)
            if "validation" in (body.get("error_code") or "").lower():
                raise ValidationError(error_msg)
            raise CLAWWalletError(error_msg)
        
        return body

    def _rpc_headers(self, rpc_url: Optional[str] = None) -> Optional[Dict[str, str]]:
        resolved = rpc_url or self.rpc_url
        if not resolved:
            return None
        return {"X-RPC-URL": resolved}
    
    def _get(
        self,
        path: str,
        params: Optional[Dict[str, Any]] = None,
        headers: Optional[Dict[str, str]] = None
    ) -> Dict[str, Any]:
        """Make a GET request."""
        return self._request("GET", path, params=params, headers=headers)
    
    def _post(
        self,
        path: str,
        data: Optional[Dict[str, Any]] = None,
        headers: Optional[Dict[str, str]] = None
    ) -> Dict[str, Any]:
        """Make a POST request."""
        return self._request("POST", path, data=data, headers=headers)
    
    def _delete(self, path: str, headers: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """Make a DELETE request."""
        return self._request("DELETE", path, headers=headers)
    
    # ========================================================================
    # Wallet Operations
    # ========================================================================
    
    def create_wallet(
        self,
        agent_name: str,
        chain: str = "base-sepolia",
    ) -> Wallet:
        """
        Create a new wallet for an AI agent.
        
        Args:
            agent_name: Name of the AI agent
            chain: Blockchain chain (default: base-sepolia)
        
        Returns:
            Wallet object with address and details
        
        Example:
            >>> wallet = client.create_wallet("MyAgent", "base-sepolia")
            >>> print(wallet.address)
        """
        if chain not in self.SUPPORTED_CHAINS:
            raise ValidationError(f"Unsupported chain: {chain}")
        
        data = {"agentName": agent_name, "chain": chain}
        response = self._post("/wallet/create", data=data)
        
        return Wallet(
            id=response["wallet"]["id"],
            address=response["wallet"]["address"],
            chain=response["wallet"]["chain"],
        )
    
    def get_wallet(self, address: str) -> Wallet:
        """
        Get wallet details by address.
        
        Args:
            address: Wallet address
        
        Returns:
            Wallet object
        """
        response = self._get(f"/wallet/{address}")
        w = response["wallet"]
        return Wallet(
            id=w.get("id"),
            address=w["address"],
            chain=w.get("chain"),
        )
    
    def get_balance(
        self,
        address: str,
        chain: Optional[str] = None,
        rpc_url: Optional[str] = None
    ) -> Balance:
        """
        Get wallet balance.
        
        Args:
            address: Wallet address
            chain: Optional chain override
        
        Returns:
            Balance object with ETH and token balances
        """
        params = {"chain": chain} if chain else {}
        if rpc_url:
            params["rpcUrl"] = rpc_url
        response = self._get(
            f"/wallet/{address}/balance",
            params=params or None,
            headers=self._rpc_headers(rpc_url)
        )
        
        b = response["balance"]
        return Balance(
            chain=b["chain"],
            eth=b.get("eth", "0"),
            rpc=b.get("rpc"),
            tokens=b.get("tokens", []),
        )
    
    def get_all_wallets(self) -> List[Wallet]:
        """
        Get all wallets for the current API key.
        
        Returns:
            List of Wallet objects
        """
        response = self._get("/wallet")
        return [
            Wallet(id=w["id"], address=w["address"], chain=w.get("chain"))
            for w in response.get("wallets", [])
        ]
    
    def send_transaction(
        self,
        from_address: str,
        to_address: str,
        value_eth: str,
        chain: str = "base-sepolia",
        rpc_url: Optional[str] = None
    ) -> Transaction:
        """
        Send a transaction from a wallet.
        
        Args:
            from_address: Sender wallet address
            to_address: Recipient wallet address
            value_eth: Amount in ETH to send
            chain: Blockchain chain
        
        Returns:
            Transaction object with hash
        """
        data = {
            "to": to_address,
            "value": value_eth,
            "chain": chain,
        }
        if rpc_url:
            data["rpcUrl"] = rpc_url
        response = self._post(
            f"/wallet/{from_address}/send",
            data=data,
            headers=self._rpc_headers(rpc_url)
        )
        
        return Transaction(
            hash=response["transaction"]["hash"],
            from_address=from_address,
            to_address=to_address,
            value=value_eth,
            chain=chain,
            status=response["transaction"].get("status"),
        )
    
    def import_wallet(
        self,
        agent_name: str,
        private_key: str,
        chain: str = "base-sepolia",
    ) -> Wallet:
        """
        Import an existing wallet using private key.
        
        Args:
            agent_name: Name of the AI agent
            private_key: Private key (will be encrypted)
            chain: Blockchain chain
        
        Returns:
            Wallet object
        """
        data = {"agentName": agent_name, "privateKey": private_key, "chain": chain}
        response = self._post("/wallet/import", data=data)
        
        return Wallet(
            id=response["wallet"]["id"],
            address=response["wallet"]["address"],
            chain=response["wallet"]["chain"],
        )
    
    def estimate_gas(
        self,
        from_address: str,
        to_address: str,
        value_eth: str,
        chain: str = "base-sepolia",
        rpc_url: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Estimate gas for a transaction.
        
        Args:
            from_address: Sender wallet address
            to_address: Recipient wallet address
            value_eth: Amount in ETH
            chain: Blockchain chain
        
        Returns:
            Gas estimate details
        """
        data = {
            "from": from_address,
            "to": to_address,
            "value": value_eth,
            "chain": chain,
        }
        if rpc_url:
            data["rpcUrl"] = rpc_url
        return self._post(
            "/wallet/estimate-gas",
            data=data,
            headers=self._rpc_headers(rpc_url)
        )
    
    # ========================================================================
    # Identity Operations
    # ========================================================================
    
    def create_identity(
        self,
        wallet_address: str,
        agent_name: str,
        description: str = "",
        agent_type: str = "assistant",
    ) -> Identity:
        """
        Create an ERC-8004 AI Agent Identity.
        
        Args:
            wallet_address: Wallet address to associate with identity
            agent_name: Name of the AI agent
            description: Agent description
            agent_type: Type of agent (assistant, agent, etc.)
        
        Returns:
            Identity object
        """
        data = {
            "walletAddress": wallet_address,
            "agentName": agent_name,
            "description": description,
            "agentType": agent_type,
        }
        response = self._post("/identity/create", data=data)
        
        return Identity(
            id=response["identity"]["id"],
            wallet_address=wallet_address,
            agent_name=agent_name,
            domain=response["identity"].get("domain"),
        )
    
    def get_identity(self, wallet_address: str) -> Identity:
        """
        Get identity for a wallet.
        
        Args:
            wallet_address: Wallet address
        
        Returns:
            Identity object
        """
        response = self._get(f"/identity/{wallet_address}")
        i = response["identity"]
        return Identity(
            id=i["id"],
            wallet_address=wallet_address,
            agent_name=i.get("agentName", ""),
            domain=i.get("domain"),
        )
    
    # ========================================================================
    # Policy Operations
    # ========================================================================
    
    def set_policy(
        self,
        wallet_address: str,
        daily_limit_eth: Optional[str] = None,
        per_tx_limit_eth: Optional[str] = None,
        allowed_recipients: Optional[List[str]] = None,
        blocked_recipients: Optional[List[str]] = None,
    ) -> Policy:
        """
        Set spending policy for a wallet.
        
        Args:
            wallet_address: Wallet address
            daily_limit_eth: Maximum ETH per day
            per_tx_limit_eth: Maximum ETH per transaction
            allowed_recipients: List of allowed recipient addresses
            blocked_recipients: List of blocked recipient addresses
        
        Returns:
            Policy object
        """
        data = {}
        if daily_limit_eth:
            data["dailyLimitEth"] = daily_limit_eth
        if per_tx_limit_eth:
            data["perTxLimitEth"] = per_tx_limit_eth
        if allowed_recipients:
            data["allowedRecipients"] = allowed_recipients
        if blocked_recipients:
            data["blockedRecipients"] = blocked_recipients
        
        response = self._post(f"/wallet/{wallet_address}/policy", data=data)
        
        return Policy(
            wallet_address=wallet_address,
            daily_limit=response["policy"].get("dailyLimitEth"),
            per_tx_limit=response["policy"].get("perTxLimitEth"),
        )
    
    def get_policy(self, wallet_address: str) -> Policy:
        """
        Get spending policy for a wallet.
        
        Args:
            wallet_address: Wallet address
        
        Returns:
            Policy object
        """
        response = self._get(f"/wallet/{wallet_address}/policy")
        p = response["policy"]
        return Policy(
            wallet_address=wallet_address,
            daily_limit=p.get("dailyLimitEth"),
            per_tx_limit=p.get("perTxLimitEth"),
        )
    
    # ========================================================================
    # API Key Operations
    # ========================================================================
    
    def create_api_key(
        self,
        name: str,
        permissions: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        """
        Create a new API key.
        
        Args:
            name: Name for the API key
            permissions: List of permissions (read, write, admin)
        
        Returns:
            Dictionary with key details
        """
        permissions = permissions or ["read", "write"]
        data = {"name": name, "permissions": permissions}
        response = self._post("/api-keys", data=data)
        return response["key"]
    
    def list_api_keys(self) -> List[Dict[str, Any]]:
        """
        List all API keys.
        
        Returns:
            List of API keys (masked)
        """
        response = self._get("/api-keys")
        return response.get("keys", [])
    
    # ========================================================================
    # Utility Methods
    # ========================================================================
    
    def health_check(self) -> Dict[str, Any]:
        """
        Check service health.
        
        Returns:
            Health status
        """
        return self._get("/health")
    
    def get_supported_chains(self) -> List[str]:
        """
        Get list of supported chains.
        
        Returns:
            List of chain names
        """
        response = self._get("/chains")
        return response.get("chains", [])
    
    def close(self):
        """Close the underlying HTTP session."""
        self._session.close()
    
    def __enter__(self):
        return self
    
    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()
