import React, { useEffect, useState, useCallback } from 'react';

function useApiKey() {
  const [apiKey, setApiKey] = useState('');
  return [apiKey, setApiKey];
}

async function apiFetch(path, { method = 'GET', body, apiKey } = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (apiKey) headers['X-API-Key'] = apiKey;

  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });

  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!res.ok) {
    throw new Error(data?.error || `Request failed (${res.status})`);
  }

  return data;
}

function Section({ title, children, badge, icon }) {
  return (
    <section className="card">
      <div className="card-header">
        {icon && <span className="card-icon">{icon}</span>}
        <h2>{title}</h2>
        {badge != null && <span className="card-badge">{badge}</span>}
      </div>
      {children}
    </section>
  );
}

// Modal Component
function Modal({ isOpen, onClose, title, children }) {
  if (!isOpen) return null;
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{title}</h3>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

// Confirm Dialog Component
function ConfirmDialog({ isOpen, onConfirm, onCancel, title, message, confirmText = 'Confirm', danger = false }) {
  if (!isOpen) return null;
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-content confirm-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>{title}</h3>
        </div>
        <div className="modal-body">
          <p>{message}</p>
          <div className="confirm-actions">
            <button className="btn-secondary" onClick={onCancel}>Cancel</button>
            <button className={danger ? 'btn-danger' : 'btn-primary'} onClick={onConfirm}>{confirmText}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Toast Notification Component
function Toast({ message, type, onClose }) {
  useEffect(() => {
    const timer = setTimeout(onClose, 4000);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <div className={`toast toast-${type}`}>
      <span className="toast-icon">{type === 'success' ? '✓' : '✕'}</span>
      <span className="toast-message">{message}</span>
      <button className="toast-close" onClick={onClose}>×</button>
    </div>
  );
}

// Loading Spinner Component
function Spinner({ size = 'small' }) {
  return <div className={`spinner spinner-${size}`}></div>;
}

// Copy Button Component
function CopyButton({ text, label }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  return (
    <button className="copy-btn" onClick={handleCopy} title={label || 'Copy to clipboard'}>
      {copied ? '✓' : '📋'}
    </button>
  );
}

// Network Selector Component
function NetworkSelector({ value, onChange }) {
  const networks = [
    { value: 'base-sepolia', label: '🔵 Base Sepolia' },
    { value: 'base', label: '🔵 Base' },
    { value: 'ethereum', label: '⟠ Ethereum' },
    { value: 'ethereum-sepolia', label: '⟠ Ethereum Sepolia' },
    { value: 'optimism-sepolia', label: '🔴 Optimism Sepolia' },
    { value: 'arbitrum-sepolia', label: '🔷 Arbitrum Sepolia' }
  ];

  return (
    <select className="network-select" value={value} onChange={(e) => onChange(e.target.value)}>
      {networks.map((net) => (
        <option key={net.value} value={net.value}>{net.label}</option>
      ))}
    </select>
  );
}

// Stat Card Component
function StatCard({ label, value, icon, accent }) {
  return (
    <div className={`stat-card ${accent || ''}`}>
      <div className="stat-icon">{icon}</div>
      <div className="stat-info">
        <div className="stat-value">{value}</div>
        <div className="stat-label">{label}</div>
      </div>
    </div>
  );
}

// Explorer URL helper (BUG-4 fix)
function getExplorerUrl(chain, address) {
  const explorers = {
    'base': `https://basescan.org`,
    'base-sepolia': `https://sepolia.basescan.org`,
    'ethereum': `https://etherscan.io`,
    'ethereum-sepolia': `https://sepolia.etherscan.io`,
    'optimism-sepolia': `https://sepolia-optimism.etherscan.io`,
    'arbitrum-sepolia': `https://sepolia.arbiscan.io`
  };
  const base = explorers[chain] || `https://etherscan.io`;
  return `${base}/address/${address}`;
}

// Wallet Detail Panel Component
function WalletDetailPanel({ wallet, onClose, onExportKey, loadingBalance, balance }) {
  if (!wallet) return null;

  return (
    <div className="wallet-detail-panel">
      <div className="wallet-detail-header">
        <h3>{wallet.agentName || 'Wallet'}</h3>
        <button className="btn-icon" onClick={onClose}>×</button>
      </div>

      <div className="wallet-detail-content">
        <div className="detail-row">
          <label>Address</label>
          <div className="address-display">
            <span className="address-text">{wallet.address}</span>
            <CopyButton text={wallet.address} label="Copy address" />
          </div>
        </div>

        <div className="detail-row">
          <label>Network</label>
          <span className="network-badge">{wallet.chain}</span>
        </div>

        <div className="detail-row">
          <label>Balance</label>
          <div className="balance-display">
            {loadingBalance ? <Spinner size="small" /> : (
              <span className="balance-value">{balance !== null ? `${balance} ETH` : 'Unable to fetch'}</span>
            )}
          </div>
        </div>

        <div className="detail-row">
          <label>Explorer</label>
          <a
            href={getExplorerUrl(wallet.chain, wallet.address)}
            target="_blank"
            rel="noopener noreferrer"
            className="explorer-link"
          >
            View on Explorer ↗
          </a>
        </div>

        <div className="detail-actions">
          <button className="btn-danger" onClick={onExportKey} disabled={loadingBalance}>
            🔑 Export Private Key
          </button>
        </div>
      </div>
    </div>
  );
}

// Transaction Filter Component
function TransactionFilter({ filter, onChange }) {
  return (
    <div className="tx-filter">
      <select value={filter} onChange={(e) => onChange(e.target.value)}>
        <option value="all">All Transactions</option>
        <option value="sent">↑ Sent</option>
        <option value="received">↓ Received</option>
        <option value="contract">📄 Contract</option>
      </select>
    </div>
  );
}

export default function App() {
  const [apiKey, setApiKey] = useApiKey();
  const [health, setHealth] = useState(null);
  const [wallets, setWallets] = useState([]);
  const [identities, setIdentities] = useState([]);
  const [selectedWallet, setSelectedWallet] = useState(null);
  const [selectedIdentity, setSelectedIdentity] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingBalance, setLoadingBalance] = useState(false);
  const [error, setError] = useState('');
  const [toasts, setToasts] = useState([]);
  const [connected, setConnected] = useState(false);

  // Modal states
  const [showCreateWalletModal, setShowCreateWalletModal] = useState(false);
  const [showCreateIdentityModal, setShowCreateIdentityModal] = useState(false);
  const [showWalletDetail, setShowWalletDetail] = useState(false);
  const [showConfirmDelete, setShowConfirmDelete] = useState(false);
  const [showExportConfirm, setShowExportConfirm] = useState(false);
  const [showExportResult, setShowExportResult] = useState(false);
  const [exportedPrivateKey, setExportedPrivateKey] = useState('');
  const [revealPrivateKey, setRevealPrivateKey] = useState(false);
  const [keyClearCountdown, setKeyClearCountdown] = useState(0);

  // Form states
  const [walletName, setWalletName] = useState('');
  const [identityName, setIdentityName] = useState('');
  const [selectedNetwork, setSelectedNetwork] = useState('base-sepolia');
  const [walletBalance, setWalletBalance] = useState(null);

  // Filter state
  const [txFilter, setTxFilter] = useState('all');

  // Pending approvals state
  const [pendingApprovals, setPendingApprovals] = useState([]);
  const [loadingApprovals, setLoadingApprovals] = useState(false);

  // Helper to add toast
  const addToast = useCallback((message, type = 'success') => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, message, type }]);
  }, []);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const h = await apiFetch('/health');
        setHealth(h);
      } catch {
        // ignore; user may not have server running yet
      }
    })();
  }, []);

  async function refreshAll() {
    if (!apiKey) {
      setError('Set an API key to load data.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const [walletRes, idRes, histRes] = await Promise.all([
        apiFetch('/wallet/list', { apiKey }),
        apiFetch('/identity/list', { apiKey }),
        apiFetch('/wallet/history?limit=50', { apiKey })
      ]);
      setWallets(walletRes.wallets || []);
      setIdentities(idRes.identities || []);
      setHistory(histRes.transactions || []);
      setConnected(true);
      addToast('Connected successfully', 'success');
    } catch (e) {
      setError(e.message);
      setConnected(false);
    } finally {
      setLoading(false);
    }
  }

  async function fetchBalance(wallet) {
    if (!wallet) return;
    setLoadingBalance(true);
    try {
      const balanceRes = await apiFetch(`/wallet/${wallet.address}/balance`, { apiKey });
      setWalletBalance(balanceRes.balance || '0');
    } catch (e) {
      setWalletBalance(null);
    } finally {
      setLoadingBalance(false);
    }
  }

  function handleWalletClick(wallet) {
    setSelectedWallet(wallet);
    setShowWalletDetail(true);
    setWalletBalance(null);
    fetchBalance(wallet);
  }

  async function handleCreateWallet() {
    if (!walletName.trim()) {
      addToast('Please enter a wallet name', 'error');
      return;
    }
    try {
      setLoading(true);
      const res = await apiFetch('/wallet/create', {
        method: 'POST',
        body: { agentName: walletName, chain: selectedNetwork },
        apiKey
      });
      setWallets((prev) => [...prev, res.wallet]);
      setSelectedWallet(res.wallet);
      setShowCreateWalletModal(false);
      setWalletName('');
      addToast(`Wallet "${walletName}" created successfully!`, 'success');
    } catch (e) {
      setError(e.message);
      addToast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateIdentity() {
    if (!selectedWallet) {
      addToast('Select a wallet first.', 'error');
      return;
    }
    const name = identityName.trim() || selectedWallet.agentName || 'Agent';
    try {
      setLoading(true);
      const res = await apiFetch('/identity/create', {
        method: 'POST',
        body: {
          walletAddress: selectedWallet.address,
          agentName: name,
          agentType: 'assistant',
          capabilities: ['wallet', 'messaging']
        },
        apiKey
      });
      setIdentities((prev) => [...prev, res.identity]);
      setSelectedIdentity(res.identity);
      setShowCreateIdentityModal(false);
      setIdentityName('');
      addToast(`Identity "${name}" created successfully!`, 'success');
    } catch (e) {
      setError(e.message);
      addToast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  async function handleExportKey() {
    if (!selectedWallet) return;
    setLoadingBalance(true);
    try {
      const res = await apiFetch(`/wallet/${selectedWallet.address}/export`, {
        method: 'POST',
        apiKey
      });
      setShowExportConfirm(false);
      setShowWalletDetail(false);
      setExportedPrivateKey(res.privateKey || '');
      setRevealPrivateKey(false);
      setShowExportResult(true);
      addToast('Private key exported — reveal and copy it now', 'success');
    } catch (e) {
      addToast(e.message, 'error');
    } finally {
      setLoadingBalance(false);
    }
  }

  async function handleDeleteWallet() {
    if (!selectedWallet) return;
    try {
      setLoading(true);
      await apiFetch(`/wallet/${selectedWallet.id}`, {
        method: 'DELETE',
        apiKey
      });
      setWallets((prev) => prev.filter((w) => w.id !== selectedWallet.id));
      setSelectedWallet(null);
      setShowConfirmDelete(false);
      setShowWalletDetail(false);
      addToast('Wallet deleted successfully!', 'success');
    } catch (e) {
      addToast(e.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  // Fetch pending approvals
  async function fetchPendingApprovals() {
    if (!apiKey) return;
    setLoadingApprovals(true);
    try {
      const res = await apiFetch('/wallet/pending?status=pending&limit=20', { apiKey });
      setPendingApprovals(res.approvals || []);
    } catch (e) {
      console.error('Failed to fetch pending approvals:', e);
    } finally {
      setLoadingApprovals(false);
    }
  }

  // Approve a pending transaction
  async function handleApproveTransaction(approvalId) {
    try {
      setLoadingApprovals(true);
      await apiFetch(`/wallet/pending/${approvalId}/approve`, {
        method: 'POST',
        apiKey
      });
      addToast('Transaction approved successfully!', 'success');
      fetchPendingApprovals();
    } catch (e) {
      addToast(e.message, 'error');
    } finally {
      setLoadingApprovals(false);
    }
  }

  // Reject a pending transaction
  async function handleRejectTransaction(approvalId, reason) {
    try {
      setLoadingApprovals(true);
      await apiFetch(`/wallet/pending/${approvalId}/reject`, {
        method: 'POST',
        body: { reason },
        apiKey
      });
      addToast('Transaction rejected', 'success');
      fetchPendingApprovals();
    } catch (e) {
      addToast(e.message, 'error');
    } finally {
      setLoadingApprovals(false);
    }
  }

  // Poll for pending approvals when API key changes
  useEffect(() => {
    if (apiKey) {
      fetchPendingApprovals();
      const interval = setInterval(fetchPendingApprovals, 10000);
      return () => clearInterval(interval);
    }
  }, [apiKey]);

  useEffect(() => {
    if (!exportedPrivateKey) return;

    setKeyClearCountdown(30);
    const interval = setInterval(() => {
      setKeyClearCountdown((seconds) => {
        if (seconds <= 1) {
          clearInterval(interval);
          setExportedPrivateKey('');
          setRevealPrivateKey(false);
          setShowExportResult(false);
          addToast('Exported private key cleared from screen', 'success');
          return 0;
        }
        return seconds - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [addToast, exportedPrivateKey]);

  // Filter transactions
  const filteredHistory = history.filter((tx) => {
    if (!selectedWallet) return true;
    if (txFilter === 'all') return true;
    if (txFilter === 'sent') return tx.from?.toLowerCase() === selectedWallet.address?.toLowerCase();
    if (txFilter === 'received') return tx.to?.toLowerCase() === selectedWallet.address?.toLowerCase();
    if (txFilter === 'contract') return !tx.to;
    return true;
  });

  // Unique chains across wallets
  const uniqueChains = [...new Set(wallets.map(w => w.chain))];

  return (
    <div className="app">
      <header className="hero">
        <div className="hero-text">
          <div className="logo-row">
            <span className="logo-icon">🐾</span>
            <h1>CLAW <span className="gradient-text">Wallet</span></h1>
          </div>
          <p>First-gen agentic identity wallet — wallets, identities, policies, and history in one place.</p>
        </div>
        <div className="api-key">
          <label>API key</label>
          <div className="api-key-row">
            <input
              type="password"
              placeholder="sk_..."
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
            <button onClick={refreshAll} disabled={loading}>
              {loading ? <Spinner size="small" /> : connected ? '↻ Refresh' : '⚡ Connect'}
            </button>
          </div>
          {connected && (
            <div className="connected-indicator">
              <span className="status-dot"></span>
              Connected
            </div>
          )}
        </div>
      </header>

      {health && (
        <div className="health">
          <span className="badge badge-accent">
            <span className="status-dot"></span>
            {health.service}
          </span>
          <span className="badge">v{health.version}</span>
        </div>
      )}

      {/* Stat Cards */}
      {connected && (
        <div className="stats-row">
          <StatCard label="Wallets" value={wallets.length} icon="👛" accent="accent-blue" />
          <StatCard label="Identities" value={identities.length} icon="🤖" accent="accent-purple" />
          <StatCard label="Chains" value={uniqueChains.length} icon="⛓️" accent="accent-green" />
          <StatCard label="Pending" value={pendingApprovals.length} icon="⏳" accent={pendingApprovals.length > 0 ? 'accent-warning pulse' : 'accent-muted'} />
        </div>
      )}

      {/* Toast Notifications */}
      <div className="toast-container">
        {toasts.map((toast) => (
          <Toast
            key={toast.id}
            message={toast.message}
            type={toast.type}
            onClose={() => removeToast(toast.id)}
          />
        ))}
      </div>

      {error && <div className="error">{error}</div>}

      <main className="grid">
        <Section title="Wallets" badge={wallets.length} icon="👛">
          <div className="toolbar">
            <button onClick={() => setShowCreateWalletModal(true)}>+ New Wallet</button>
          </div>
          <ul className="list">
            {wallets.map((w) => (
              <li
                key={w.id}
                className={selectedWallet?.id === w.id ? 'selected' : ''}
                onClick={() => handleWalletClick(w)}
              >
                <div className="title">{w.agentName || 'Wallet'}</div>
                <div className="sub">
                  <span className="address-truncate">{w.address.slice(0, 6)}…{w.address.slice(-4)}</span>
                  <span className="network-tag">{w.chain}</span>
                </div>
              </li>
            ))}
            {wallets.length === 0 && (
              <li className="empty">
                <div className="empty-state">
                  <span className="empty-icon">👛</span>
                  <p>No wallets yet</p>
                  <button className="btn-primary btn-sm" onClick={() => setShowCreateWalletModal(true)}>
                    Create your first wallet
                  </button>
                </div>
              </li>
            )}
          </ul>
        </Section>

        <Section title="Identities" badge={identities.length} icon="🤖">
          <div className="toolbar">
            <button
              onClick={() => setShowCreateIdentityModal(true)}
              disabled={!selectedWallet}
              title={!selectedWallet ? 'Select a wallet first' : 'Create a new identity'}
            >
              + New Identity
            </button>
          </div>
          <ul className="list">
            {identities.map((id) => (
              <li
                key={id.id}
                className={selectedIdentity?.id === id.id ? 'selected' : ''}
                onClick={() => setSelectedIdentity(id)}
              >
                <div className="title">{id.name}</div>
                <div className="sub">
                  {id.type} · {id.wallet.slice(0, 6)}…{id.wallet.slice(-4)}
                </div>
              </li>
            ))}
            {identities.length === 0 && (
              <li className="empty">
                <div className="empty-state">
                  <span className="empty-icon">🤖</span>
                  <p>No identities yet</p>
                  <span className="empty-hint">Select a wallet, then create an identity</span>
                </div>
              </li>
            )}
          </ul>
        </Section>

        <Section title="Recent Activity" badge={filteredHistory.length} icon="📜">
          <div className="toolbar">
            <TransactionFilter filter={txFilter} onChange={setTxFilter} />
          </div>
          <ul className="history">
            {filteredHistory.map((tx, idx) => (
              <li key={tx.hash || idx}>
                <div className="row">
                  <span className="hash">
                    <CopyButton text={tx.hash} label="Copy tx hash" />
                    {tx.hash.slice(0, 8)}…
                  </span>
                  <span className="value">
                    {tx.value} ETH
                  </span>
                </div>
                <div className="row small">
                  <span className="tx-direction">
                    {tx.from?.slice(0, 6)}… → {tx.to ? `${tx.to.slice(0, 6)}…` : 'Contract'}
                  </span>
                  <span className="network-tag">{tx.chain}</span>
                </div>
                {tx.policy?.reason && <span className="pill pill-policy">policy: {tx.policy.reason}</span>}
                {tx.meta?.apiKeyName && <span className="pill">key: {tx.meta.apiKeyName}</span>}
              </li>
            ))}
            {filteredHistory.length === 0 && (
              <li className="empty">
                <div className="empty-state">
                  <span className="empty-icon">📜</span>
                  <p>No transactions yet</p>
                </div>
              </li>
            )}
          </ul>
        </Section>

        {/* Pending Approvals Section */}
        {pendingApprovals.length > 0 && (
          <Section title="Pending Approvals" badge={pendingApprovals.length} icon="⚠️">
            <ul className="history">
              {pendingApprovals.map((approval) => (
                <li key={approval.id} className="pending-approval">
                  <div className="row">
                    <span className="approval-type">
                      {approval.priority === 'high' || approval.priority === 'urgent' ? '🔴' : '🟡'}
                      {approval.priority?.toUpperCase()}
                    </span>
                    <span className="value">
                      {approval.value_eth} ETH
                      {approval.value_usd && ` ($${approval.value_usd})`}
                    </span>
                  </div>
                  <div className="row small">
                    <span className="tx-direction">
                      → {approval.to_address?.slice(0, 6)}…
                    </span>
                    <span className="network-tag">{approval.chain}</span>
                  </div>
                  <div className="row small">
                    <span className="timestamp">
                      {new Date(approval.created_at).toLocaleString()}
                    </span>
                  </div>
                  <div className="approval-actions">
                    <button
                      className="btn-primary"
                      onClick={() => handleApproveTransaction(approval.id)}
                      disabled={loadingApprovals}
                    >
                      ✓ Approve
                    </button>
                    <button
                      className="btn-danger"
                      onClick={() => {
                        const reason = prompt('Reason for rejection (optional):');
                        handleRejectTransaction(approval.id, reason);
                      }}
                      disabled={loadingApprovals}
                    >
                      ✕ Reject
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </Section>
        )}
      </main>

      {/* Create Wallet Modal */}
      <Modal
        isOpen={showCreateWalletModal}
        onClose={() => setShowCreateWalletModal(false)}
        title="Create New Wallet"
      >
        <div className="form-group">
          <label>Wallet Name</label>
          <input
            type="text"
            placeholder="Enter wallet name"
            value={walletName}
            onChange={(e) => setWalletName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreateWallet()}
          />
        </div>
        <div className="form-group">
          <label>Network</label>
          <NetworkSelector value={selectedNetwork} onChange={setSelectedNetwork} />
        </div>
        <div className="modal-actions">
          <button className="btn-secondary" onClick={() => setShowCreateWalletModal(false)}>Cancel</button>
          <button className="btn-primary" onClick={handleCreateWallet} disabled={loading}>
            {loading ? <Spinner size="small" /> : '⚡ Create Wallet'}
          </button>
        </div>
      </Modal>

      {/* Create Identity Modal */}
      <Modal
        isOpen={showCreateIdentityModal}
        onClose={() => setShowCreateIdentityModal(false)}
        title="Create New Identity"
      >
        <div className="form-group">
          <label>Identity Name</label>
          <input
            type="text"
            placeholder={selectedWallet?.agentName || 'Enter identity name'}
            value={identityName}
            onChange={(e) => setIdentityName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreateIdentity()}
          />
        </div>
        <div className="form-group">
          <label>Associated Wallet</label>
          <div className="wallet-preview">
            {selectedWallet ? (
              <span>{selectedWallet.agentName} ({selectedWallet.address.slice(0, 10)}…)</span>
            ) : (
              <span className="muted">No wallet selected</span>
            )}
          </div>
        </div>
        <div className="modal-actions">
          <button className="btn-secondary" onClick={() => setShowCreateIdentityModal(false)}>Cancel</button>
          <button className="btn-primary" onClick={handleCreateIdentity} disabled={loading || !selectedWallet}>
            {loading ? <Spinner size="small" /> : '🤖 Create Identity'}
          </button>
        </div>
      </Modal>

      {/* Wallet Detail Panel */}
      {showWalletDetail && selectedWallet && (
        <div className="detail-panel-overlay">
          <WalletDetailPanel
            wallet={selectedWallet}
            onClose={() => setShowWalletDetail(false)}
            onExportKey={() => setShowExportConfirm(true)}
            loadingBalance={loadingBalance}
            balance={walletBalance}
          />
        </div>
      )}

      {/* Confirm Delete Dialog */}
      <ConfirmDialog
        isOpen={showConfirmDelete}
        onConfirm={handleDeleteWallet}
        onCancel={() => setShowConfirmDelete(false)}
        title="Delete Wallet"
        message={`Are you sure you want to delete the wallet "${selectedWallet?.agentName}"? This action cannot be undone.`}
        confirmText="Delete"
        danger
      />

      {/* Export Key Confirmation */}
      <ConfirmDialog
        isOpen={showExportConfirm}
        onConfirm={handleExportKey}
        onCancel={() => setShowExportConfirm(false)}
        title="Export Private Key"
        message="Warning: Exposing your private key is dangerous. Anyone with this key can control your wallet. Are you sure you want to export it?"
        confirmText="Export Key"
        danger
      />

      <Modal
        isOpen={showExportResult}
        onClose={() => {
          setShowExportResult(false);
          setExportedPrivateKey('');
          setRevealPrivateKey(false);
        }}
        title="Private Key Export"
      >
        <div className="form-group">
          <label>Private Key (auto-clears in {keyClearCountdown}s)</label>
          <input
            type={revealPrivateKey ? 'text' : 'password'}
            value={exportedPrivateKey}
            readOnly
          />
        </div>
        <div className="modal-actions">
          <button className="btn-secondary" onClick={() => setRevealPrivateKey((show) => !show)}>
            {revealPrivateKey ? 'Hide' : 'Reveal'}
          </button>
          <CopyButton text={exportedPrivateKey} label="Copy private key" />
          <button
            className="btn-danger"
            onClick={() => {
              setShowExportResult(false);
              setExportedPrivateKey('');
              setRevealPrivateKey(false);
            }}
          >
            Clear
          </button>
        </div>
      </Modal>
    </div>
  );
}
