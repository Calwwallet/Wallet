import Redis from 'ioredis';

let client = null;

export function getRedis() {
  if (client) return client;

  const url = process.env.REDIS_URL;
  if (!url) {
    throw new Error('REDIS_URL is required to use Redis-backed features.');
  }

  client = new Redis(url, {
    maxRetriesPerRequest: 2
  });

  return client;
}

