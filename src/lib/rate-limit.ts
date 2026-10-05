import Redis from 'ioredis'

/**
 * Sliding-window rate limiting shared across every instance of every app via
 * one Redis (see `~/.secrets/saas_portfolio.env`'s `REDIS_URL` and the
 * `shared-redis` Coolify resource) — a per-process `Map` cannot coordinate
 * across replicas or survive a deploy, which matters once an app scales past
 * one instance.
 *
 * Falls back to an in-memory limiter, both when `REDIS_URL` is unset and when
 * Redis errors at request time: a brute-force limiter is a second line of
 * defense, not the only one (password hashing and timing-safe comparison
 * still apply), so a Redis outage should degrade it rather than lock out the
 * one admin.
 */

let sharedRedis: Redis | null = null
if (process.env.REDIS_URL) {
  sharedRedis = new Redis(process.env.REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
  })
  sharedRedis.on('error', () => {
    // Logged by ioredis itself; this handler only exists so an unhandled
    // 'error' event does not crash the process between requests.
  })
}

function createInMemoryLimiter(windowMs: number, maxPerWindow: number) {
  const hits = new Map<string, number[]>()
  return (key: string): boolean => {
    const now = Date.now()
    const recent = (hits.get(key) ?? []).filter((time) => now - time < windowMs)
    recent.push(now)
    hits.set(key, recent)
    if (hits.size > 5000) hits.clear()
    return recent.length > maxPerWindow
  }
}

/**
 * @param prefix Namespaces this limiter's keys in the shared Redis — must be
 *   unique per app *and* per call site (e.g. `"crashpatch-login"`), since
 *   one Redis instance serves every app in the portfolio.
 */
export function createRateLimiter(windowMs: number, maxPerWindow: number, prefix: string) {
  const fallback = createInMemoryLimiter(windowMs, maxPerWindow)

  return async function isRateLimited(key: string): Promise<boolean> {
    if (!sharedRedis) return fallback(key)

    try {
      const now = Date.now()
      const redisKey = `ratelimit:${prefix}:${key}`
      const member = `${now}-${Math.random().toString(36).slice(2)}`

      const pipeline = sharedRedis.pipeline()
      pipeline.zremrangebyscore(redisKey, 0, now - windowMs)
      pipeline.zadd(redisKey, now, member)
      pipeline.zcard(redisKey)
      pipeline.pexpire(redisKey, windowMs)
      const results = await pipeline.exec()

      if (!results) return fallback(key)
      const [, , countResult] = results
      const count = typeof countResult?.[1] === 'number' ? countResult[1] : 0
      return count > maxPerWindow
    } catch {
      return fallback(key)
    }
  }
}
