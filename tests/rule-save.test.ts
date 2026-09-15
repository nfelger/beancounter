import { describe, expect, it, vi } from 'vitest'
import {
  createCorrectionPlan,
  createRuleChange,
  createSavePlan,
  reconcile,
  saveBody,
  persistPending,
  restorePending,
} from '../src/services/sheets'
import { ruleRows } from '../src/services/sheet-rules'
import { prepareImport } from '../src/domain/import'
import { pack, snapshot, source } from './fixtures'

function changedRows() {
  return [...ruleRows(pack), ['simple_rule', 10, true, '', 'EXACT', 'Edited', 'Food']]
}
describe('atomic rule saves', () => {
  it('includes rules with the import and receipt in one repeatable request', async () => {
    const state = snapshot()
    const preview = await prepareImport(source(), pack, [])
    const change = createRuleChange(state, changedRows())
    const plan = createSavePlan(state, preview, change)
    const body = JSON.parse(saveBody(plan))
    expect(body.requests).toHaveLength(3)
    expect(body.requests[2].updateCells.range).toMatchObject({
      sheetId: 1,
      startRowIndex: 0,
      endColumnIndex: 7,
    })
    expect(reconcile(state, plan)).toBe('retry')
    expect(() => reconcile({ ...state, ruleCells: changedRows() }, plan)).toThrow('Regeln')
    expect(
      reconcile(
        {
          ...state,
          transactions: preview.transactions,
          receipts: [plan.receipt],
          ruleCells: changedRows(),
        },
        plan,
      ),
    ).toBe('saved')
    expect(saveBody(plan)).toBe(saveBody(plan))
  })
  it('saves a historical correction and rules atomically; detects success after a lost response', async () => {
    const state = {
      ...snapshot(),
      transactions: (await prepareImport(source(), pack, [])).transactions,
    }
    const tx = state.transactions[0]!
    const plan = createCorrectionPlan(
      state,
      tx.id,
      'Edited',
      'Travel',
      createRuleChange(state, changedRows()),
    )
    expect(JSON.parse(saveBody(plan)).requests).toHaveLength(2)
    expect(reconcile(state, plan)).toBe('retry')
    const saved = structuredClone(state)
    saved.transactions[0]!.classification.payee = 'Edited'
    saved.transactions[0]!.classification.category = 'Travel'
    saved.ruleCells = changedRows()
    expect(reconcile(saved, plan)).toBe('saved')
    expect(() => reconcile({ ...saved, ruleCells: state.ruleCells }, plan)).toThrow('verändert')
    const moved = { ...state, transactions: [{ ...tx, id: 'other' }, tx] }
    expect(() => reconcile(moved, plan)).toThrow('verändert')
    expect(() => reconcile({ ...state, ruleCells: changedRows() }, plan)).toThrow('verändert')
  })
  it('restores pending rule writes with their before/after checks across a reload', async () => {
    const memory = new Map<string, string>()
    vi.stubGlobal('sessionStorage', {
      setItem: (k: string, v: string) => memory.set(k, v),
      getItem: (k: string) => memory.get(k) ?? null,
    })
    try {
      const state = {
        ...snapshot(),
        transactions: (await prepareImport(source(), pack, [])).transactions,
      }
      const change = createRuleChange(state, changedRows())
      for (const plan of [
        createSavePlan(state, await prepareImport(source(), pack, []), change),
        createCorrectionPlan(state, state.transactions[0]!.id, 'Edited', 'Travel', change),
      ]) {
        persistPending(plan)
        expect(restorePending()).toEqual(plan)
        expect(saveBody(restorePending()!)).toBe(saveBody(plan))
      }
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
