import { expect, it, vi } from 'vitest'
import { simplifyRuleRows } from '../src/services/simplify-rules'
import { readRules, ruleRows } from '../src/services/sheet-rules'
import { createClassifier } from '../src/domain/rules'
import { SheetsStore, type Requester } from '../src/services/sheets'
import { pack, raw, snapshot } from './fixtures'

it('preserves classification, cell order, disabled rows and unrelated cells; is idempotent', () => {
  const rows = ruleRows(pack)
  rows.push([], ['normalize', 20, false, '{"kind":"replace","pattern":"UNCHANGED","value":"X"}'])
  rows[2]![1] = 45
  const before = structuredClone(rows)
  const result = simplifyRuleRows(rows)
  expect(result.changed).toEqual([2])
  expect(result.rows[2]).toEqual(['simple_rule', 45, true, '', 'MOONBEAN SHOP', 'Moonbean', 'Food'])
  expect(result.rows.slice(3)).toEqual(rows.slice(3))
  expect(rows).toEqual(before)
  const oldClassify = createClassifier(readRules(rows)!)
  const newClassify = createClassifier(readRules(result.rows)!)
  for (const rawPayee of ['CARD MOONBEAN SHOP', 'moonbean shop', 'OTHER', 'MOONBEAN SHOP ANNEX']) {
    const oldValue = oldClassify({ ...raw, rawPayee })
    const newValue = newClassify({ ...raw, rawPayee })
    expect({ ...newValue, matchedRule: '' }).toEqual({ ...oldValue, matchedRule: '' })
  }
  expect(simplifyRuleRows(result.rows).changed).toEqual([])
  rows[2]![2] = false
  expect(simplifyRuleRows(rows).rows[2]![2]).toBe(false)
})
it('leaves ambiguous and unsupported JSON rules byte-for-byte intact', () => {
  const full = pack.rules[0]!
  const variants = [
    { ...full, conditions: [{ field: 'normalized', op: 'eq', value: 'MOONBEAN SHOP' }] },
    { ...full, conditions: [{ field: 'normalized', op: 'search', value: '^MOONBEAN SHOP$' }] },
    { ...full, conditions: [{ field: 'purposeNorm', op: 'full', value: 'MOONBEAN SHOP' }] },
    { ...full, conditions: [...full.conditions, ...full.conditions] },
    { ...full, exclude: true },
    { ...full, useNormalized: true },
    { ...full, note: 'Retain unknown metadata' },
    { ...full, conditions: [{ ...full.conditions[0], flags: 'i' }] },
  ]
  for (const rule of variants) {
    const rows = ruleRows(pack)
    rows[2]![3] = JSON.stringify(rule, null, 2)
    expect(simplifyRuleRows(rows)).toEqual({ rows, changed: [], skipped: 1 })
  }
})
it('refuses invalid packs and generated-ID collisions before writing', () => {
  const rows = ruleRows(pack)
  rows.push([
    'rule',
    8,
    true,
    JSON.stringify({ ...pack.rules[0], id: 'simple_rule:0', exclude: true }),
  ])
  expect(() => simplifyRuleRows(rows)).toThrow()
  rows[2]![3] = '{broken'
  expect(() => simplifyRuleRows(rows)).toThrow()
})
it('writes only converted rows as literal cells and performs no write on repeat', async () => {
  const request = vi.fn().mockResolvedValue({})
  const store = new SheetsStore(request as Requester)
  const state = snapshot()
  const result = await store.simplifyRules(state)
  const body = JSON.parse(request.mock.calls[0]![1].body)
  expect(body.requests).toHaveLength(1)
  expect(body.requests[0].updateCells.start).toEqual({
    sheetId: state.ids.Rules,
    rowIndex: 3,
    columnIndex: 0,
  })
  expect(body.requests[0].updateCells.fields).toBe('userEnteredValue')
  expect(body.requests[0].updateCells.rows[0].values[3].userEnteredValue).toEqual({
    stringValue: '',
  })
  await store.simplifyRules({ ...state, ruleCells: result.rows })
  expect(request).toHaveBeenCalledOnce()
})
