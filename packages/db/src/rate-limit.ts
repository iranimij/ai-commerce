import type { Database } from './client.js'

export interface RateLimitRule {
  limit: number
  windowSeconds: number
}

export interface RateLimiter {
  hit(key: string, rule: RateLimitRule): Promise<{ allowed: boolean; retryAfterSeconds: number }>
  /** Deletes windows older than an hour, which no rule reads. */
  prune(): Promise<void>
}

/**
 * Fixed-window counters in PostgreSQL, so every app process shares them (spec 5.7). Each hit
 * deletes the key's older windows; about one hit in a hundred also prunes every key's.
 */
export function createRateLimiter(database: Database): RateLimiter {
  const { client } = database
  const prune = async () => {
    await client`delete from rate_limit where window_start < now() - interval '1 hour'`
  }
  return {
    prune,
    async hit(key, { limit, windowSeconds }) {
      // shortcut: random pruning on the request path; move it to a scheduled job once one exists.
      if (Math.random() < 0.01) await prune()
      const [row] = await client`
        with bucket as (
          select to_timestamp(floor(extract(epoch from now()) / ${windowSeconds}) * ${windowSeconds}) as start
        ), cleared as (
          delete from rate_limit where key = ${key} and window_start < (select start from bucket)
        )
        insert into rate_limit (key, window_start, count)
        values (${key}, (select start from bucket), 1)
        on conflict (key, window_start) do update set count = rate_limit.count + 1
        returning count,
          ceil(extract(epoch from (window_start + make_interval(secs => ${windowSeconds}) - now())))::int as retry`
      const count = Number(row?.count)
      return {
        allowed: count <= limit,
        retryAfterSeconds: count <= limit ? 0 : Math.max(1, Number(row?.retry)),
      }
    },
  }
}
