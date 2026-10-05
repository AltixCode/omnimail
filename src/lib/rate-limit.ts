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

function createInMemoryFailureLimiter(windowMs: number, maxFailuresPerWindow: number) {
  const hits = new Map<string, number[]>()
  function recent(key: string): number[] {
    const now = Date.now()
    const list = (hits.get(key) ?? []).filter((time) => now - time < windowMs)
    hits.set(key, list)
    if (hits.size > 5000) hits.clear()
    return list
  }
  return {
    isBlocked(key: string): boolean {
      return recent(key).length >= maxFailuresPerWindow
    },
    recordFailure(key: string): void {
      const list = recent(key)
      list.push(Date.now())
      hits.set(key, list)
    },
  }
}

/**
 * A failed-attempt limiter: only a failed credential check counts against the
 * budget, so a successful sign-in — however many times the provider's
 * `authorize()` happens to be invoked for it — never trips the limit. Call
 * `isBlocked` before attempting verification and `recordFailure` only after a
 * verification actually fails; never record on success.
 *
 * @param prefix Namespaces this limiter's keys in the shared Redis — must be
 *   unique per app *and* per call site (e.g. `"crashpatch-login"`), since
 *   one Redis instance serves every app in the portfolio.
 */
export function createFailureRateLimiter(
  windowMs: number,
  maxFailuresPerWindow: number,
  prefix: string,
) {
  const fallback = createInMemoryFailureLimiter(windowMs, maxFailuresPerWindow)

  return {
    async isBlocked(key: string): Promise<boolean> {
      if (!sharedRedis) return fallback.isBlocked(key)
      try {
        const now = Date.now()
        const redisKey = `ratelimit:${prefix}:${key}`
        const pipeline = sharedRedis.pipeline()
        pipeline.zremrangebyscore(redisKey, 0, now - windowMs)
        pipeline.zcard(redisKey)
        const results = await pipeline.exec()
        if (!results) return fallback.isBlocked(key)
        const [, countResult] = results
        const count = typeof countResult?.[1] === 'number' ? countResult[1] : 0
        return count >= maxFailuresPerWindow
      } catch {
        return fallback.isBlocked(key)
      }
    },

    async recordFailure(key: string): Promise<void> {
      if (!sharedRedis) {
        fallback.recordFailure(key)
        return
      }
      try {
        const now = Date.now()
        const redisKey = `ratelimit:${prefix}:${key}`
        const member = `${now}-${Math.random().toString(36).slice(2)}`
        const pipeline = sharedRedis.pipeline()
        pipeline.zadd(redisKey, now, member)
        pipeline.pexpire(redisKey, windowMs)
        await pipeline.exec()
      } catch {
        fallback.recordFailure(key)
      }
    },
  }
}
