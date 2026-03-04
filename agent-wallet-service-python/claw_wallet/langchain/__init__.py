"""
CLAW Wallet LangChain Integration
=================================

Tools for using CLAW Wallet with LangChain agents.

Usage:
    from claw_wallet.langchain import WalletTools, create_wallet_agent
    
    # Create wallet tools for an agent
    tools = WalletTools(api_key="sk_...")
    
    # Or use the agent factory
    agent = create_wallet_agent(
        api_key="sk_...",
        agent_name="PaymentAgent",
        tools=[...],
        llm=...
    )
"""

from .tools import WalletTools, get_wallet_tools
from .agent import create_wallet_agent, CLAWWalletAgent

__all__ = [
    "WalletTools",
    "get_wallet_tools",
    "create_wallet_agent",
    "CLAWWalletAgent",
]
