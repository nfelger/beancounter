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
    expect(body.requests[0].updateCells.rows[0].values[15].userEnteredValue.stringValue).toContain(
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
  it('writes corrections to the manual columns without shifting other fields', async () => {
    const transactions = (await prepareImport(source(), pack, [])).transactions
    const request = vi.fn().mockResolvedValue({})
    await new SheetsStore(request as Requester).correct(
      { ...snapshot(), transactions },
      transactions[0]!.id,
      'Manual name',
      'Travel',
    )
    const update = JSON.parse(request.mock.calls[0]![1].body).requests[0].updateCells
    expect(update.start).toEqual({ sheetId: 0, rowIndex: 1, columnIndex: 11 })
    expect(update.rows[0].values).toEqual([
      { userEnteredValue: { stringValue: 'Manual name' } },
      { userEnteredValue: { stringValue: 'Travel' } },
    ])
  })
  it.each([
    { version: '2', headers: TX_HEADERS, valid: true },
    { version: '1', headers: TX_HEADERS, valid: false },
    {
      version: '2',
      headers: [...TX_HEADERS.slice(0, 10), 'confidence', ...TX_HEADERS.slice(10)],
      valid: false,
    },
  ])(
    'validates headers and schema version before accepting data: $version / $valid',
    async ({ version, headers, valid }) => {
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
            { values: [headers] },
            { values: [RULE_HEADERS, ...ruleRows(pack)] },
            { values: [IMPORT_HEADERS] },
            { values: [META_HEADERS, ['schema_version', version]] },
          ],
        })
      const loading = new SheetsStore(request as Requester).load('test-sheet')
      if (!valid) {
        await expect(loading).rejects.toThrow(/Tabellenschema|Tabellenversion/)
        expect(request.mock.calls.every((args) => !args[1]?.method)).toBe(true)
        return
      }
      const result = await loading
      expect(result.rules).toEqual(pack)
      expect(result.transactionRows).toBe(1)
      expect(() => readTransaction(['secret'])).toThrow('ungültiges Format')
    },
  )
})
