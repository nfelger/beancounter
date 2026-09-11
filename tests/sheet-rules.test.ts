import { describe, expect, it } from 'vitest'
import { createClassifier, validateRulePack } from '../src/domain/rules'
import { readRules, ruleRows } from '../src/services/sheet-rules'
import { pack, raw } from './fixtures'

const settings = () => ruleRows(pack)[0]!
const simple = (
  order = 10,
  pattern = 'moonbean shop',
  payee = 'Edited payee',
  category = 'Travel',
) => ['simple_rule', order, true, '', pattern, payee, category]
const jsonRule = (order = 20) => ['rule', order, true, JSON.stringify(pack.rules[0]), '', '', '']

describe('spreadsheet rule authoring', () => {
  it('matches the complete normalized payee, ignoring case, with explicit wildcards for broader matching', () => {
    const loaded = readRules([settings(), ruleRows(pack)[1]!, simple()])!
    const classify = createClassifier(loaded)
    expect(classify(raw)).toMatchObject({ payee: 'Edited payee', category: 'Travel' })
    expect(classify({ ...raw, rawPayee: 'MOONBEAN SHOP EXTRA' }).matchedRule).toBe('')
    const broad = createClassifier(readRules([settings(), simple(10, 'moonbean.*')])!)
    expect(broad({ ...raw, rawPayee: 'MOONBEAN SHOP EXTRA' }).category).toBe('Travel')
    expect(broad({ ...raw, rawPayee: 'OTHER MOONBEAN SHOP' }).matchedRule).toBe('')
  })
  it('uses one shared numeric order and first-match behavior for simple and JSON rules', () => {
    const input = { ...raw, rawPayee: 'MOONBEAN SHOP' }
    expect(createClassifier(readRules([settings(), jsonRule(20), simple(10)])!)(input).payee).toBe(
      'Edited payee',
    )
    expect(createClassifier(readRules([settings(), simple(30), jsonRule(20)])!)(input).payee).toBe(
      'Moonbean',
    )
    const disabled = simple(10)
    disabled[2] = false
    expect(createClassifier(readRules([settings(), disabled, jsonRule(20)])!)(input).payee).toBe(
      'Moonbean',
    )
  })
  it('keeps normalized payees for category-only rules and uses the fallback for payee-only rules', () => {
    const input = { ...raw, rawPayee: 'MOONBEAN SHOP' }
    expect(
      createClassifier(readRules([settings(), simple(10, 'moonbean shop', '', 'Travel')])!)(input),
    ).toMatchObject({ payee: 'MOONBEAN SHOP', category: 'Travel' })
    expect(
      createClassifier(
        readRules([settings(), simple(10, 'moonbean shop', 'Edited', ''), jsonRule(20)])!,
      )(input),
    ).toMatchObject({ payee: 'Edited', category: pack.unknownCategory })
  })
  it('preserves simple rows through JSON backup validation and spreadsheet serialization', () => {
    const loaded = readRules([
      settings(),
      simple(10),
      jsonRule(20),
      simple(30, 'SECOND', '', 'Food'),
    ])!
    const restored = validateRulePack(JSON.parse(JSON.stringify(loaded)))
    const rows = ruleRows(restored)
    expect(rows[1]).toEqual(['simple_rule', 0, true, '', 'moonbean shop', 'Edited payee', 'Travel'])
    expect(rows[2]![0]).toBe('rule')
    expect(readRules(rows)).toEqual(loaded)
  })
  it('keeps full JSON search behavior and literal assignment text', () => {
    const rule = {
      ...pack.rules[0],
      conditions: [{ field: 'normalized', op: 'search', value: 'MOONBEAN' }],
    }
    const loaded = readRules([settings(), ['rule', 10, true, JSON.stringify(rule)]])!
    expect(createClassifier(loaded)({ ...raw, rawPayee: 'PREFIX MOONBEAN SUFFIX' }).payee).toBe(
      'Moonbean',
    )
    const literal = readRules([settings(), simple(10, '.*', '$1=literal', '')])!
    expect(createClassifier(literal)(raw).payee).toBe('$1=literal')
  })
  it('ignores blank rows while keeping spreadsheet cell addresses in errors', () => {
    expect(readRules([[], ['', '', '']])).toBeNull()
    expect(readRules([settings(), [], simple()])!.rules).toHaveLength(1)
    expect(() => readRules([settings(), [], simple(10, '[PRIVATE')])).toThrow(
      'Rules!E4: Ungültige Regex.',
    )
  })
  it.each([
    { column: 'B', row: simple(10.5) },
    { column: 'D', row: ['simple_rule', 10, true, '{}', '.*', '', 'Food'] },
    { column: 'E', row: simple(10, '') },
    { column: 'F', row: simple(10, '.*', '', '') },
    { column: 'G', row: simple(10, '.*', '', 'PRIVATE') },
    { column: 'C', row: ['simple_rule', 10, 'TRUE', '', '.*', '', 'Food'] },
  ])('reports invalid cells without disclosing their contents: $column', ({ column, row }) => {
    expect(() => readRules([settings(), row])).toThrow(`Rules!${column}3:`)
    try {
      readRules([settings(), row])
    } catch (error) {
      expect(String(error)).not.toContain('PRIVATE')
    }
  })
  it('rejects duplicate priorities across both rule types', () => {
    expect(() => readRules([settings(), simple(10), jsonRule(10)])).toThrow('Rules!B4:')
  })
  it('rejects a malformed simple representation in JSON instead of silently changing it on save', () => {
    const loaded = readRules([settings(), simple()])!
    loaded.rules[0]!.conditions[0]!.op = 'search'
    expect(() => validateRulePack(loaded)).toThrow()
  })
})
