import type { z } from 'zod'

export interface EventDefinition<P extends z.ZodType = z.ZodType> {
  name: string
  payload: P
}

export function defineEvent<P extends z.ZodType>(name: string, payload: P): EventDefinition<P> {
  return { name, payload }
}

export interface Subscriber<P extends z.ZodType = z.ZodType> {
  event: EventDefinition<P>
  /** The module that owns this subscriber, for inspect and error reports. */
  module: string
  handler: (payload: z.infer<P>) => Promise<void>
}

export interface EventBus {
  subscribe<P extends z.ZodType>(subscriber: Subscriber<P>): void
  emit<P extends z.ZodType>(event: EventDefinition<P>, payload: z.infer<P>): Promise<void>
  subscribers(eventName: string): { module: string }[]
}

export interface EventBusOptions {
  onError?: (error: unknown, info: { event: string; module: string }) => void
}

export function createEventBus(options: EventBusOptions = {}): EventBus {
  const byEvent = new Map<string, Subscriber[]>()

  return {
    subscribe(subscriber) {
      const list = byEvent.get(subscriber.event.name) ?? []
      list.push(subscriber)
      byEvent.set(subscriber.event.name, list)
    },

    async emit(event, payload) {
      const parsed = event.payload.safeParse(payload)
      if (!parsed.success) throw new Error(`Invalid payload for event "${event.name}"`)

      // One by one, in subscription order. A failing subscriber never stops the others.
      for (const subscriber of byEvent.get(event.name) ?? []) {
        try {
          await subscriber.handler(parsed.data)
        } catch (error) {
          options.onError?.(error, { event: event.name, module: subscriber.module })
        }
      }
    },

    subscribers: (eventName) => (byEvent.get(eventName) ?? []).map((s) => ({ module: s.module })),
  }
}
