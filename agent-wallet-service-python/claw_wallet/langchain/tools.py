"""
CLAW Wallet LangChain Tools
============================

LangChain tools for wallet operations.
"""

from typing import Optional, List, Type
from pydantic import BaseModel, Field

from ..client import WalletClient
from ..exceptions import CLAWWalletError

# Try to import LangChain components
try:
    from langchain.tools import BaseTool
    from langchain.schema import HumanMessage
    LANGCHAIN_AVAILABLE = True
except ImportError:
    LANGCHAIN_AVAILABLE = False
    BaseTool = object


# ========================================================================
# Tool Input Models
# ========================================================================

class CreateWalletInput(BaseModel):
    """Input for create_wallet tool."""
    agent_name: str = Field(description="Name of the AI agent")
    chain: str = Field(default="base-sepolia", description="Blockchain chain")


class GetBalanceInput(BaseModel):
    """Input for get_balance tool."""
    address: str = Field(description="Wallet address")
    chain: Optional[str] = Field(default=None, description="Blockchain chain (optional)")


class SendTransactionInput(BaseModel):
    """Input for send_transaction tool."""
    from_address: str = Field(description="Sender wallet address")
    to_address: str = Field(description="Recipient wallet address")
    value_eth: str = Field(description="Amount in ETH to send")
    chain: str = Field(default="base-sepolia", description="Blockchain chain")


class GetWalletInput(BaseModel):
    """Input for get_wallet tool."""
    address: str = Field(description="Wallet address")


class SetPolicyInput(BaseModel):
    """Input for set_policy tool."""
    wallet_address: str = Field(description="Wallet address")
    daily_limit_eth: Optional[str] = Field(default=None, description="Maximum ETH per day")
    per_tx_limit_eth: Optional[str] = Field(default=None, description="Maximum ETH per transaction")
    allowed_recipients: Optional[List[str]] = Field(default=None, description="List of allowed recipients")


# ========================================================================
# Wallet Tools
# ========================================================================

class WalletTools:
    """
    Collection of LangChain tools for wallet operations.
    
    Usage:
        from langchain.agents import AgentExecutor
        from claw_wallet.langchain import WalletTools
        
        tools = WalletTools(api_key="sk_...").get_tools()
        
        agent = create_agent(llm, tools)
        result = agent.run("Create a wallet for my agent")
    """
    
    def __init__(
        self,
        api_key: str,
        base_url: str = "http://localhost:3000",
        default_chain: str = "base-sepolia",
    ):
        self.client = WalletClient(api_key=api_key, base_url=base_url)
        self.default_chain = default_chain
        
        if not LANGCHAIN_AVAILABLE:
            raise ImportError(
                "LangChain is not installed. Install with: pip install langchain"
            )
    
    def _create_tool(
        self,
        name: str,
        description: str,
        args_schema: Type[BaseModel],
        func,
    ):
        """Create a LangChain tool."""
        
        class _Tool(BaseTool):
            name = name
            description = description
            args_schema = args_schema
            
            def _run(self, **kwargs):
                return func(**kwargs)
        
        return _Tool()
    
    def create_wallet_tool(self):
        """Create a tool for creating wallets."""
        
        def create_wallet(agent_name: str, chain: str = None):
            """Create a new wallet for an AI agent."""
            chain = chain or self.default_chain
            wallet = self.client.create_wallet(agent_name, chain)
            return f"Wallet created: {wallet.address} on {wallet.chain}"
        
        return self._create_tool(
            name="create_wallet",
            description="Create a new blockchain wallet for an AI agent. Use this when you need to create a new wallet for an agent.",
            args_schema=CreateWalletInput,
            func=create_wallet,
        )
    
    def get_balance_tool(self):
        """Create a tool for getting wallet balance."""
        
        def get_balance(address: str, chain: str = None):
            """Get the balance of a wallet."""
            chain = chain or self.default_chain
            balance = self.client.get_balance(address, chain)
            return f"Balance for {address}: {balance.eth} ETH on {balance.chain}"
        
        return self._create_tool(
            name="get_balance",
            description="Get the ETH balance of a blockchain wallet. Returns the balance in ETH.",
            args_schema=GetBalanceInput,
            func=get_balance,
        )
    
    def send_transaction_tool(self):
        """Create a tool for sending transactions."""
        
        def send_transaction(
            from_address: str,
            to_address: str,
            value_eth: str,
            chain: str = None,
        ):
            """Send ETH from one wallet to another."""
            chain = chain or self.default_chain
            tx = self.client.send_transaction(
                from_address, to_address, value_eth, chain
            )
            return f"Transaction sent: {tx.hash}"
        
        return self._create_tool(
            name="send_transaction",
            description="Send ETH from one wallet to another. Requires from_address, to_address, and value_eth.",
            args_schema=SendTransactionInput,
            func=send_transaction,
        )
    
    def get_wallet_tool(self):
        """Create a tool for getting wallet details."""
        
        def get_wallet(address: str):
            """Get details about a wallet."""
            wallet = self.client.get_wallet(address)
            return f"Wallet: {wallet.address} on {wallet.chain} (ID: {wallet.id})"
        
        return self._create_tool(
            name="get_wallet",
            description="Get details about a wallet by its address.",
            args_schema=GetWalletInput,
            func=get_wallet,
        )
    
    def set_policy_tool(self):
        """Create a tool for setting spending policies."""
        
        def set_policy(
            wallet_address: str,
            daily_limit_eth: str = None,
            per_tx_limit_eth: str = None,
            allowed_recipients: List[str] = None,
        ):
            """Set spending policy for a wallet."""
            policy = self.client.set_policy(
                wallet_address,
                daily_limit_eth,
                per_tx_limit_eth,
                allowed_recipients,
            )
            return f"Policy set for {wallet_address}: daily limit {policy.daily_limit}, per-tx limit {policy.per_tx_limit}"
        
        return self._create_tool(
            name="set_policy",
            description="Set spending limits and restrictions on a wallet.",
            args_schema=SetPolicyInput,
            func=set_policy,
        )
    
    def get_tools(self) -> List[BaseTool]:
        """Get all wallet tools as a list."""
        return [
            self.create_wallet_tool(),
            self.get_balance_tool(),
            self.send_transaction_tool(),
            self.get_wallet_tool(),
            self.set_policy_tool(),
        ]


def get_wallet_tools(api_key: str, **kwargs) -> List[BaseTool]:
    """
    Convenience function to get all wallet tools.
    
    Args:
        api_key: API key for authentication
        **kwargs: Additional arguments for WalletTools
    
    Returns:
        List of LangChain tools
    """
    return WalletTools(api_key=api_key, **kwargs).get_tools()
