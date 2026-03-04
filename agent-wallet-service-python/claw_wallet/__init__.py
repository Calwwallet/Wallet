"""
CLAW Wallet Python SDK
======================

Stripe for AI Agent Wallets - Python client library.

Add wallet functionality to any AI agent in seconds.

Usage:
    from claw_wallet import WalletClient
    
    client = WalletClient(api_key="sk_...")
    wallet = client.create_wallet(agent_name="MyAgent", chain="base-sepolia")
    balance = client.get_balance(wallet.address)
"""

__version__ = "0.1.0"
__author__ = "Mr. Claw"

from .client import WalletClient
from .exceptions import (
    CLAWWalletError,
    AuthenticationError,
    RateLimitError,
    WalletNotFoundError,
    ValidationError,
)
from .models import (
    Wallet,
    Balance,
    Transaction,
    Identity,
    Policy,
)

__all__ = [
    "WalletClient",
    "CLAWWalletError",
    "AuthenticationError",
    "RateLimitError",
    "WalletNotFoundError",
    "ValidationError",
    "Wallet",
    "Balance",
    "Transaction",
    "Identity",
    "Policy",
]
