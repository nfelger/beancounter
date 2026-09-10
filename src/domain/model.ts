import { z } from 'zod'

const text = z.string().max(45000)
export const rawSchema = z.object({
  bookingDate: text,
  valueDate: text,
  rawPayee: text,
  bookingText: text,
  purpose: text,
  rawAmount: text,
  currency: z.string().regex(/^[A-Z]{3}$/),
  rawBalance: z.string().optional(),
  balanceCurrency: z.string().optional(),
  account: text,
})
export type RawTransaction = z.infer<typeof rawSchema>
export const classificationSchema = z.object({
  normalized: text,
  payee: text,
  category: text,
  matchedRule: text,
  excluded: z.boolean(),
})
export type Classification = z.infer<typeof classificationSchema>
export const transactionSchema = z.object({
  id: z.string().regex(/^[a-f0-9]{64}$/),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  occurrence: z.number().int().positive(),
  bookingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amountMinor: z.number().int().safe(),
  raw: rawSchema,
  classification: classificationSchema,
  importId: text,
})
export type Transaction = z.infer<typeof transactionSchema>
export const importSchema = z.object({
  id: text,
  importedAt: text,
  filename: text,
  account: text,
  periodStart: text,
  periodEnd: text,
  parsed: z.number().int().nonnegative(),
  added: z.number().int().nonnegative(),
  duplicates: z.number().int().nonnegative(),
  excluded: z.number().int().nonnegative(),
  rulesDigest: text,
})
export type ImportReceipt = z.infer<typeof importSchema>
export interface ParsedImport {
  filename: string
  account: string
  periodStart: string
  periodEnd: string
  transactions: RawTransaction[]
  warnings: string[]
}
export interface ImportPreview {
  id: string
  source: ParsedImport
  transactions: Transaction[]
  duplicates: number
  repeated: number
  rulesDigest: string
}
export function needsReview(t: Transaction, unknownCategory: string): boolean {
  return (
    !t.classification.excluded &&
    !t.classification.matchedRule &&
    t.classification.category === unknownCategory
  )
}
export function money(minor: number, currency = 'EUR') {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency }).format(minor / 100)
}
export function displayDate(iso: string) {
  return iso.split('-').reverse().join('.')
}
