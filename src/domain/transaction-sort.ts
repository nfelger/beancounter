import type { Transaction } from './model'

export type SortField = 'date' | 'payee' | 'category' | 'amount'
export type SortDirection = 'asc' | 'desc'
const collator = new Intl.Collator('de', { sensitivity: 'base', numeric: true })

export function compareTransactions(
  a: Transaction,
  b: Transaction,
  field: SortField,
  direction: SortDirection,
): number {
  const result =
    field === 'amount'
      ? a.amountMinor - b.amountMinor
      : field === 'date'
        ? a.bookingDate.localeCompare(b.bookingDate)
        : collator.compare(a.classification[field], b.classification[field])
  return direction === 'asc' ? result : -result
}
