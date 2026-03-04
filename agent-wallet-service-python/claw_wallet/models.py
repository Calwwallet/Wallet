"""
CLAW Wallet Python SDK - Models
===============================

Data models for the wallet service.
"""

from dataclasses import dataclass
from typing import Optional, List, Dict, Any


@dataclass
class Wallet:
    """Wallet model."""
    address: str
    chain: str
    id: Optional[str] = None
    
    def __str__(self):
        return f"Wallet({self.address[:10]}... on {self.chain})"


@dataclass
class Balance:
    """Balance model."""
    chain: str
    eth: str
    rpc: Optional[str] = None
    tokens: Optional[List[Dict[str, Any]]] = None


@dataclass
class Transaction:
    """Transaction model."""
    hash: str
    from_address: str
    to_address: str
    value: str
    chain: str
    status: Optional[str] = None
    
    def __str__(self):
        return f"Transaction({self.hash[:10]}...)"


@dataclass
class Identity:
    """Identity model."""
    id: str
    wallet_address: str
    agent_name: str
    domain: Optional[str] = None
    description: Optional[str] = None
    agent_type: Optional[str] = None


@dataclass
class Policy:
    """Policy model."""
    wallet_address: str
    daily_limit: Optional[str] = None
    per_tx_limit: Optional[str] = None
    allowed_recipients: Optional[List[str]] = None
    blocked_recipients: Optional[List[str]] = None


@dataclass
class ApiKey:
    """API Key model."""
    key: str
    name: str
    permissions: List[str]
    created_at: Optional[str] = None
