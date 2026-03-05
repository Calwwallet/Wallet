# Self-Hosted Deployment Guide

This guide covers deploying the Agent Wallet Service in your own infrastructure.

## Prerequisites

- Node.js 18+
- Docker & Docker Compose (for containerized deployment)
- PostgreSQL 14+ (optional, for production)
- Redis 7+ (optional, for rate limiting)

## Quick Start with Docker

### 1. Clone and Configure

```bash
# Clone the repository
git clone https://github.com/mrclaw/agent-wallet-service.git
cd agent-wallet-service

# Copy environment file
cp .env.example .env
```

### 2. Configure Environment

Edit `.env` with your settings:

```bash
# Recommended managed RPC key for EVM chains
ALCHEMY_API_KEY=your-alchemy-api-key

# Optional Base Sepolia fallback override list
BASE_SEPOLIA_RPCS=https://base-sepolia.g.alchemy.com/v2/<key>,https://base-sepolia-public.nodies.app

# Required for production
NODE_ENV=production
WALLET_ENCRYPTION_KEY=your-64-char-hex-key
API_KEY_HASH_SECRET=your-hmac-secret

# Optional: Use PostgreSQL
STORAGE_BACKEND=db
DATABASE_URL=postgresql://user:pass@localhost:5432/agentwallet

# Optional: Use Redis for rate limiting
REDIS_URL=redis://localhost:6379
```

### 3. Start with Docker Compose

```bash
# Development
docker-compose up -d

# Production (with all features)
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

### 4. Verify

```bash
curl http://localhost:3000/health
```

## Manual Deployment

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Set required environment variables:

```bash
export WALLET_ENCRYPTION_KEY="your-64-char-hex-key"  # Required in production
export NODE_ENV=production
export PORT=3000
```

### 3. Start Server

```bash
npm start
```

## Production Checklist

### Security

- [ ] Set `WALLET_ENCRYPTION_KEY` to a random 64-character hex string
- [ ] Set `API_KEY_HASH_SECRET` for API key hashing
- [ ] Use PostgreSQL instead of JSON file storage
- [ ] Enable Redis for distributed rate limiting
- [ ] Use HTTPS (reverse proxy with TLS)
- [ ] Set `NODE_ENV=production`

### Monitoring

- [ ] Configure log aggregation (e.g., ELK, Datadog)
- [ ] Set up health check monitoring
- [ ] Configure alerts for errors

### Backups

- [ ] Regular PostgreSQL backups
- [ ] Backup encryption keys separately
- [ ] Test restore procedures

## Reverse Proxy (Nginx)

Example Nginx configuration:

```nginx
server {
    listen 443 ssl http2;
    server_name wallet.example.com;

    ssl_certificate /etc/ssl/certs/wallet.crt;
    ssl_certificate_key /etc/ssl/private/wallet.key;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## Kubernetes Deployment

A Helm chart and Kubernetes manifests are available in the `k8s/` directory.

```bash
# Deploy to Kubernetes
kubectl apply -f k8s/
```

## Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | Server port (default: 3000) |
| `NODE_ENV` | No | Environment (development/production) |
| `WALLET_ENCRYPTION_KEY` | Yes (prod) | 64-char hex key for encrypting wallets |
| `API_KEY_HASH_SECRET` | Yes (prod) | Secret for hashing API keys |
| `STORAGE_BACKEND` | No | `json` or `db` (default: json) |
| `DATABASE_URL` | No | PostgreSQL connection string |
| `REDIS_URL` | No | Redis connection string |
| `*_RPC` | No | RPC URLs for chains (see `.env.example`) |

## Support

- GitHub Issues: https://github.com/mrclaw/agent-wallet-service/issues
- Documentation: https://docs.clawwallet.dev
