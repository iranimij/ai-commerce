import type { Database } from './client.js'

export interface RateLimitRule {
  limit: number
  windowSeconds: number
}

export interface RateLimiter {
  hit(key: string, rule: RateLimitRule): Promise<{ allowed: boolean; retryAfterSeconds: number }>
}

/**
 * Fixed-window counters in PostgreSQL, so every app process shares them (spec 5.7). Each hit
 * also deletes the key's older windows, which keeps the table as small as the set of active keys.
 */
export function createRateLimiter(database: Database): RateLimiter {
  const { client } = database
  return {
    async hit(key, { limit, windowSeconds }) {
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
