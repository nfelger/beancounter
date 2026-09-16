import { expect, it } from 'vitest'
import { compareTransactions, type SortField } from '../src/domain/transaction-sort'
import { prepareImport } from '../src/domain/import'
import { pack, source } from './fixtures'

it('sorts signed cents numerically, ISO dates chronologically, and displayed labels using German collation', async () => {
  const base = (await prepareImport(source(), pack, [])).transactions[0]!
  const first = {
    ...base,
    amountMinor: -10000,
    bookingDate: '2025-01-31',
    classification: { ...base.classification, payee: 'Äpfel', category: 'Bücher' },
  }
  const second = {
    ...base,
    amountMinor: -200,
    bookingDate: '2025-02-01',
    classification: { ...base.classification, payee: 'Zebra', category: 'Reisen' },
  }
  for (const field of ['amount', 'date', 'payee', 'category'] as SortField[]) {
    expect(compareTransactions(first, second, field, 'asc')).toBeLessThan(0)
    expect(compareTransactions(first, second, field, 'desc')).toBeGreaterThan(0)
    expect(compareTransactions(first, first, field, 'asc')).toBe(0)
  }
  expect(compareTransactions(second, { ...second, amountMinor: 0 }, 'amount', 'asc')).toBeLessThan(
    0,
  )
  expect(
    compareTransactions(
      { ...second, amountMinor: 0 },
      { ...second, amountMinor: 200 },
      'amount',
      'asc',
    ),
  ).toBeLessThan(0)
})
