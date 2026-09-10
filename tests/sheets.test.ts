import { describe, it, expect, vi } from 'vitest'
import { persistPending, restorePending, clearPending } from '../src/services/sheets'
import {
  SheetsStore,
  createSavePlan,
  reconcile,
  readTransaction,
  transactionRow,
  TX_HEADERS,
  RULE_HEADERS,
  IMPORT_HEADERS,
  META_HEADERS,
  ruleRows,
} from '../src/services/sheets'
import type { Requester, Snapshot } from '../src/services/sheets'
import { prepareImport } from '../src/domain/import'
import { raw, pack, source, snapshot } from './fixtures'

describe('safe Sheets writes', () => {
  it('retains a plan across reload and clears it after confirmation without storing a token', async () => {
    const memory = new Map<string, string>()
    vi.stubGlobal('sessionStorage', {
      setItem: (k: string, v: string) => memory.set(k, v),
      getItem: (k: string) => memory.get(k) ?? null,
      removeItem: (k: string) => memory.delete(k),
    })
    try {
      const plan = createSavePlan(snapshot(), await prepareImport(source(), pack, []))
      persistPending(plan)
      expect(restorePending()).toEqual(plan)
      expect([...memory.values()][0]).not.toContain('access_token')
      clearPending()
      expect(restorePending()).toBeNull()
    } finally {
      vi.unstubAllGlobals()
    }
  })
  it('validates oversized fields before persisting or locking an import', async () => {
    const setItem = vi.fn()
    vi.stubGlobal('sessionStorage', { setItem })
    try {
      const plan = createSavePlan(snapshot(), await prepareImport(source(), pack, []))
      plan.transactions[0]!.raw.purpose = 'x'.repeat(46000)
      expect(() => persistPending(plan)).toThrow('zu lang')
      expect(setItem).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })
  it('saves transactions and receipt in one atomic fixed-range request', async () => {
    const preview = await prepareImport(
      source([{ ...raw, purpose: '=IMPORTXML("https://example.invalid","x")' }]),
      pack,
      [],
    )
    const plan = createSavePlan(snapshot(), preview),
      request = vi.fn().mockResolvedValue({})
    const store = new SheetsStore(request as Requester)
    await store.save(plan)
    const body = JSON.parse(request.mock.calls[0]![1].body)
    expect(body.requests).toHaveLength(2)
    expect(body.requests[0].updateCells.start.rowIndex).toBe(1)
    expect(body.requests[0].updateCells.rows[0].values[16].userEnteredValue.stringValue).toContain(
      'IMPORTXML',
    )
    expect(JSON.stringify(body)).not.toContain('formulaValue')
    await store.save(plan)
    expect(request.mock.calls[1]![1].body).toBe(request.mock.calls[0]![1].body)
  })
  it('recognizes success after the response is lost, without appending again', async () => {
    const preview = await prepareImport(source(), pack, []),
      plan = createSavePlan(snapshot(), preview)
    let persisted: Snapshot = snapshot()
    const request: Requester = async () => {
      persisted = {
        ...persisted,
        transactions: plan.transactions,
        receipts: [plan.receipt],
        transactionRows: 2,
        receiptRows: 2,
      }
      throw new Error('lost response')
    }
    await expect(new SheetsStore(request).save(plan)).rejects.toThrow('lost')
    expect(reconcile(persisted, plan)).toBe('saved')
  })
  it('retries only the original unoccupied ranges', async () => {
    const plan = createSavePlan(snapshot(), await prepareImport(source(), pack, []))
    expect(reconcile(snapshot(), plan)).toBe('retry')
    expect(() => reconcile({ ...snapshot(), transactionRows: 2 }, plan)).toThrow('verändert')
    expect(() => reconcile({ ...snapshot(), spreadsheetId: 'another' }, plan)).toThrow('andere')
  })
  it('refuses a receipt with missing transactions', async () => {
    const plan = createSavePlan(snapshot(), await prepareImport(source(), pack, []))
    expect(() => reconcile({ ...snapshot(), receipts: [plan.receipt] }, plan)).toThrow(
      'widersprechen',
    )
  })
  it('round-trips transaction cells preserving original strings and corrections', async () => {
    const t = (await prepareImport(source(), pack, [])).transactions[0]!
    t.manualPayee = 'Manual name'
    expect(readTransaction(transactionRow(t))).toEqual(t)
  })
  it('loads the typed schema and refuses malformed stored data', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        properties: { title: 'Test' },
        sheets: ['Transactions', 'Rules', 'Imports', 'Meta'].map((title, sheetId) => ({
          properties: { title, sheetId },
        })),
      })
      .mockResolvedValueOnce({
        valueRanges: [
          { values: [TX_HEADERS] },
          { values: [RULE_HEADERS, ...ruleRows(pack)] },
          { values: [IMPORT_HEADERS] },
          { values: [META_HEADERS, ['schema_version', '1']] },
        ],
      })
    const result = await new SheetsStore(request as Requester).load('test-sheet')
    expect(result.rules).toEqual(pack)
    expect(result.transactionRows).toBe(1)
    expect(() => readTransaction(['secret'])).toThrow('ungültiges Format')
  })
})
