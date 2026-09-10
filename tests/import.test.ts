import { describe, it, expect } from 'vitest'
import { prepareImport } from '../src/domain/import'
import { raw, pack, source } from './fixtures'
describe('overlap reconciliation', () => {
  it('retains legitimately identical transactions and imports only additional occurrences', async () => {
    const first = await prepareImport(source([raw, raw]), pack, [])
    expect(first.transactions).toHaveLength(2)
    expect(new Set(first.transactions.map((t) => t.id)).size).toBe(2)
    const next = await prepareImport(source([raw, raw, raw]), pack, first.transactions)
    expect(next.transactions).toHaveLength(1)
    expect(next.duplicates).toBe(2)
    expect(next.transactions[0]?.occurrence).toBe(3)
  })
  it('ignores running balances, filenames, row order and classifications for identity', async () => {
    const other = { ...raw, purpose: 'TEST-REFERENCE-002' }
    const first = await prepareImport(source([raw, other]), pack, [])
    const second = await prepareImport(
      { ...source([{ ...other, rawBalance: '0,00' }, raw]), filename: 'renamed.csv' },
      pack,
      first.transactions,
    )
    expect(second.id).toBe(first.id)
    expect(second.transactions).toHaveLength(0)
  })
  it('keeps accounts distinct', async () => {
    const first = await prepareImport(source(), pack, [])
    const next = await prepareImport(
      source([{ ...raw, account: 'DE00000000000000000001' }]),
      pack,
      first.transactions,
    )
    expect(next.transactions).toHaveLength(1)
  })
  it('does not overwrite manual assignments on reimport', async () => {
    const first = await prepareImport(source(), pack, [])
    first.transactions[0]!.manualCategory = 'Travel'
    const second = await prepareImport(source(), pack, first.transactions)
    expect(second.transactions).toHaveLength(0)
    expect(first.transactions[0]!.manualCategory).toBe('Travel')
  })
})
