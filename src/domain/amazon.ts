import { z } from 'zod'
import type { Transaction } from './model'

const amazonSchema = z.object({
  orders: z
    .array(
      z.object({
        orderId: z.string().trim().min(1).max(100),
        items: z
          .array(
            z.object({
              name: z.string().max(2000),
              context: z.string().max(4000),
            }),
          )
          .max(200),
      }),
    )
    .max(2000),
})
export type AmazonOrder = z.infer<typeof amazonSchema>['orders'][number]
export interface AmazonContext {
  exact: boolean
  orders: AmazonOrder[]
}
function bankText(t: Transaction) {
  return [t.raw.rawPayee, t.raw.purpose, t.raw.bookingText].join(' ')
}
export function isAmazon(t: Transaction): boolean {
  return /\b(?:amazon|amzn)(?=\b|\d)/i.test(bankText(t))
}
export function parseAmazon(text: string): AmazonOrder[] {
  try {
    if (text.length > 2_000_000) throw new Error()
    return amazonSchema.parse(JSON.parse(text)).orders
  } catch {
    throw new Error(
      'Amazon-Daten konnten nicht gelesen werden. Bitte JSON mit orders, orderId und items prüfen. Der CSV-Import bleibt möglich.',
    )
  }
}
export function amazonContext(t: Transaction, orders: AmazonOrder[]): AmazonContext | undefined {
  if (!isAmazon(t) || !orders.length) return undefined
  const text = bankText(t)
  const exact = orders.filter((order) => {
    const escaped = order.orderId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`).test(text)
  })
  return { exact: exact.length > 0, orders: exact.length ? exact : orders }
}
