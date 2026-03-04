"""
CLAW Wallet LangChain Agent
===========================

Factory functions for creating LangChain agents with wallet tools.
"""

from typing import List, Optional, Any, Callable

# Try to import LangChain components
try:
    from langchain.agents import AgentExecutor, initialize_agent
    from langchain.chains import LLMChain
    from langchain.agents import Tool
    from langchain.schema import BaseLanguageModel
    LANGCHAIN_AVAILABLE = True
except ImportError:
    LANGCHAIN_AVAILABLE = False
    BaseLanguageModel = object


def create_wallet_agent(
    llm: BaseLanguageModel,
    tools: List[Any],
    agent_name: str = "WalletAgent",
    verbose: bool = False,
    **agent_kwargs,
) -> AgentExecutor:
    """
    Create a LangChain agent with wallet tools.
    
    Args:
        llm: Language model to use (e.g., ChatOpenAI)
        tools: List of tools (can include WalletTools from this package)
        agent_name: Name for the agent
        verbose: Enable verbose output
        **agent_kwargs: Additional arguments for the agent
    
    Returns:
        AgentExecutor that can run the agent
    
    Example:
        from langchain.chat_models import ChatOpenAI
        from claw_wallet.langchain import WalletTools, create_wallet_agent
        
        llm = ChatOpenAI(temperature=0)
        wallet_tools = WalletTools(api_key="sk_...").get_tools()
        
        agent = create_wallet_agent(llm, wallet_tools)
        
        result = agent.run("Create a wallet named PaymentBot")
    """
    if not LANGCHAIN_AVAILABLE:
        raise ImportError(
            "LangChain is not installed. Install with: pip install langchain"
        )
    
    # Convert tools to LangChain Tool format if needed
    langchain_tools = []
    for tool in tools:
        if hasattr(tool, 'name'):  # Already a LangChain tool
            langchain_tools.append(tool)
        elif hasattr(tool, 'get_tools'):  # WalletTools instance
            langchain_tools.extend(tool.get_tools())
    
    # Initialize the agent
    agent = initialize_agent(
        tools=langchain_tools,
        llm=llm,
        agent="zero-shot-react-description",
        verbose=verbose,
        **agent_kwargs,
    )
    
    return agent


def create_wallet_chain(
    llm: BaseLanguageModel,
    wallet_tools: Any,
    prompt: Optional[str] = None,
) -> LLMChain:
    """
    Create a simple LLM chain with wallet tools.
    
    This is a simpler alternative to the full agent for cases where
    you just want the LLM to use tools without the full agent loop.
    
    Args:
        llm: Language model
        wallet_tools: WalletTools instance
        prompt: Optional custom prompt
    
    Returns:
        LLMChain with tools
    """
    if not LANGCHAIN_AVAILABLE:
        raise ImportError("LangChain is required for this feature")
    
    default_prompt = """You are a helpful AI agent with access to blockchain wallet tools.

Available tools:
- create_wallet: Create a new blockchain wallet
- get_balance: Get wallet balance
- send_transaction: Send ETH between wallets
- get_wallet: Get wallet details
- set_policy: Set spending limits on a wallet

Use these tools to help the user with their blockchain needs.
    
Question: {question}
    
Let me think about how to answer this step by step:
"""
    
    tools = wallet_tools.get_tools() if hasattr(wallet_tools, 'get_tools') else wallet_tools
    
    chain = LLMChain(
        llm=llm,
        prompt=prompt or default_prompt,
        tools=tools,
    )
    
    return chain


class CLAWWalletAgent:
    """
    Pre-configured wallet agent with common operations.
    
    This class provides a simpler interface for common wallet operations
    without needing to directly manage LangChain concepts.
    
    Example:
        from claw_wallet.langchain import CLAWWalletAgent
        
        agent = CLAWWalletAgent(
            llm=my_llm,
            api_key="sk_...",
            agent_name="PaymentBot"
        )
        
        # Create a wallet
        wallet = await agent.create_wallet("PaymentBot")
        
        # Get balance
        balance = await agent.get_balance(wallet.address)
        
        # Send payment
        tx = await agent.send(wallet.address, recipient, "0.01")
    """
    
    def __init__(
        self,
        llm: BaseLanguageModel,
        api_key: str,
        agent_name: str = "WalletAgent",
        base_url: str = "http://localhost:3000",
        default_chain: str = "base-sepolia",
    ):
        if not LANGCHAIN_AVAILABLE:
            raise ImportError("LangChain is required for this feature")
        
        from ..client import WalletClient
        from .tools import WalletTools
        
        self.llm = llm
        self.client = WalletClient(api_key=api_key, base_url=base_url)
        self.wallet_tools = WalletTools(
            api_key=api_key,
            base_url=base_url,
            default_chain=default_chain,
        )
        self.agent_name = agent_name
        self.default_chain = default_chain
        
        # Pre-configured wallet for this agent
        self._wallet = None
    
    def create_wallet(self, name: Optional[str] = None) -> Any:
        """Create a new wallet."""
        name = name or self.agent_name
        wallet = self.client.create_wallet(name, self.default_chain)
        self._wallet = wallet
        return wallet
    
    def get_wallet(self) -> Any:
        """Get the current wallet (creates one if doesn't exist)."""
        if not self._wallet:
            return self.create_wallet()
        return self._wallet
    
    def get_balance(self, address: Optional[str] = None) -> Any:
        """Get balance for a wallet."""
        address = address or self.get_wallet().address
        return self.client.get_balance(address, self.default_chain)
    
    def send(
        self,
        to_address: str,
        value_eth: str,
        from_address: Optional[str] = None,
    ) -> Any:
        """Send ETH from wallet."""
        from_address = from_address or self.get_wallet().address
        return self.client.send_transaction(
            from_address,
            to_address,
            value_eth,
            self.default_chain,
        )
    
    def set_policy(
        self,
        daily_limit_eth: Optional[str] = None,
        per_tx_limit_eth: Optional[str] = None,
    ) -> Any:
        """Set spending policy for the wallet."""
        wallet = self.get_wallet()
        return self.client.set_policy(
            wallet.address,
            daily_limit_eth,
            per_tx_limit_eth,
        )
