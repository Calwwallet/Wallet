"""
CLAW Wallet Python SDK - Exceptions
====================================

Custom exceptions for the wallet service.
"""


class CLAWWalletError(Exception):
    """Base exception for all CLAW Wallet errors."""
    pass


class AuthenticationError(CLAWWalletError):
    """Raised when authentication fails."""
    pass


class RateLimitError(CLAWWalletError):
    """Raised when rate limit is exceeded."""
    def __init__(self, message: str, retry_after: str = None):
        super().__init__(message)
        self.retry_after = retry_after


class WalletNotFoundError(CLAWWalletError):
    """Raised when a wallet is not found."""
    pass


class ValidationError(CLAWWalletError):
    """Raised when validation fails."""
    pass


class TransactionError(CLAWWalletError):
    """Raised when a transaction fails."""
    pass


class ChainNotSupportedError(CLAWWalletError):
    """Raised when a chain is not supported."""
    pass
