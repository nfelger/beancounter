import { describe, expect, it, vi } from 'vitest'
import { SheetsStore, type Requester } from '../src/services/sheets'
import { readRules, ruleRows, RULE_HEADERS } from '../src/services/sheet-rules'
import { pack, snapshot } from './fixtures'

describe('rule sheet editing controls', () => {
  it('configures checkboxes, dropdowns and literal text without changing rule values', async () => {
    const request = vi.fn().mockResolvedValue({})
    await new SheetsStore(request as Requester).formatRules(snapshot())
    const { requests } = JSON.parse(request.mock.calls[0]![1].body)
    const validations = requests
      .filter((r: { setDataValidation?: unknown }) => r.setDataValidation)
      .map((r: { setDataValidation: unknown }) => r.setDataValidation)
    expect(validations[0].rule.condition.values).toContainEqual({ userEnteredValue: 'simple_rule' })
    expect(validations[1].range.startColumnIndex).toBe(2)
    expect(validations[1].rule.condition.type).toBe('BOOLEAN')
    expect(validations[2].rule.condition.values).toEqual(
      pack.categories.map((userEnteredValue) => ({ userEnteredValue })),
    )
    for (const r of requests) {
      if (r.updateCells) expect(r.updateCells.fields).toBe('note')
      if (r.repeatCell) {
        expect(r.repeatCell.fields).toBe('userEnteredFormat.numberFormat')
        expect(r.repeatCell.cell.userEnteredFormat.numberFormat.type).toBe('TEXT')
      }
    }
    expect(
      requests.find((r: { setBasicFilter?: unknown }) => r.setBasicFilter).setBasicFilter.filter
        .range.endColumnIndex,
    ).toBe(7)
  })
  it('saves simple rules as cells and refreshes controls in the same atomic batch', async () => {
    const request = vi.fn().mockResolvedValue({})
    const loaded = readRules([
      ruleRows(pack)[0]!,
      ['simple_rule', 10, true, '', '.*', '=literal', 'Travel'],
    ])!
    await new SheetsStore(request as Requester).replaceRules(snapshot(), loaded)
    const { requests } = JSON.parse(request.mock.calls[0]![1].body)
    const update = requests.find(
      (r: { updateCells?: { fields: string } }) => r.updateCells?.fields === 'userEnteredValue',
    ).updateCells
    expect(update.range.endColumnIndex).toBe(RULE_HEADERS.length)
    expect(update.rows[2].values[0].userEnteredValue).toEqual({ stringValue: 'simple_rule' })
    expect(update.rows[2].values[3].userEnteredValue).toEqual({ stringValue: '' })
    expect(update.rows[2].values[5].userEnteredValue).toEqual({ stringValue: '=literal' })
    expect(JSON.stringify(requests)).not.toContain('formulaValue')
    expect(request).toHaveBeenCalledTimes(1)
  })
})
