import { describe, expect, it } from 'vitest'
import {
  applyAssignment,
  buildAssignmentRule,
  relatedAssignments,
} from '../src/services/assignment-rules'
import { createClassifier } from '../src/domain/rules'
import { prepareImport } from '../src/domain/import'
import { ruleRows } from '../src/services/sheet-rules'
import { pack, raw, source } from './fixtures'

async function transaction() {
  return (await prepareImport(source(), pack, [])).transactions[0]!
}
describe('rules from corrections', () => {
  it('creates an escaped whole-payee rule and gives it precedence over the old assignment', async () => {
    const t = await transaction()
    t.raw.rawPayee = 'CARD SHOP (A+B).*'
    const result = buildAssignmentRule(ruleRows(pack), t, 'New', 'Travel')
    const classify = createClassifier(result.pack)
    expect(classify(t.raw)).toMatchObject({ payee: 'New', category: 'Travel' })
    expect(classify({ ...t.raw, rawPayee: 'SHOP AAAB anything' }).matchedRule).toBe('')
    expect(result.cells.at(-1)![4]).toBe('SHOP \\(A\\+B\\)\\.\\*')
  })
  it('updates a repeated exact rule without duplicating it or discarding other sheet cells', async () => {
    const t = await transaction()
    const original = [...ruleRows(pack), []]
    const first = buildAssignmentRule(original, t, 'One', 'Travel')
    const next = buildAssignmentRule(first.cells, t, 'Two', 'Food')
    expect(next.cells).toHaveLength(first.cells.length)
    expect(original).toEqual([...ruleRows(pack), []])
    expect(next.cells.slice(0, original.length)).toEqual(original)
    expect(createClassifier(next.pack)(t.raw).payee).toBe('Two')
  })
  it('keeps conditional exclusions ahead of generated rules without changing existing rule behavior', async () => {
    const t = await transaction()
    const rules = structuredClone(pack)
    rules.rules.unshift({
      id: 'excluded',
      enabled: true,
      exclude: true,
      conditions: [{ field: 'purposeNorm', op: 'eq', value: 'EXCLUDED' }],
    })
    const rows = ruleRows(rules)
    const result = buildAssignmentRule(rows, t, 'New', 'Travel')
    expect(createClassifier(result.pack)(t.raw).payee).toBe('New')
    expect(createClassifier(result.pack)({ ...t.raw, purpose: 'EXCLUDED' }).excluded).toBe(true)
    expect(rows).toEqual(ruleRows(rules))
    rules.rules.reverse()
    expect(() => buildAssignmentRule(ruleRows(rules), t, 'New', 'Travel')).toThrow('Reihenfolge')
  })
  it('rejects excluded sources and missing assignments', async () => {
    const t = await transaction()
    expect(() => buildAssignmentRule(ruleRows(pack), t, '', 'Travel')).toThrow()
    expect(() => buildAssignmentRule(ruleRows(pack), t, 'New', 'Not a category')).toThrow()
    t.classification.excluded = true
    expect(() => buildAssignmentRule(ruleRows(pack), t, 'New', 'Travel')).toThrow('Ausgeschlossene')
  })
  it('applies to the whole preview, preserving explicit edits, exclusions, and unrelated payees', async () => {
    const preview = await prepareImport(source(Array.from({ length: 105 }, () => raw)), pack, [])
    const rows = preview.transactions
    const id = rows[0]!.id
    const edited = new Set([rows[1]!.id])
    rows[1]!.classification.payee = 'Manual'
    rows[2]!.classification.excluded = true
    rows[3]!.classification.normalized = 'OTHER'
    const rule = buildAssignmentRule(ruleRows(pack), rows[0]!, 'New', 'Travel')
    expect(relatedAssignments(rows, rows[0]!, edited)).toHaveLength(101)
    const next = applyAssignment(rows, id, 'New', 'Travel', edited, rule)
    expect(next[1]!.classification.payee).toBe('Manual')
    expect(next[2]).toEqual(rows[2])
    expect(next[3]).toEqual(rows[3])
    expect(next[104]!.classification.payee).toBe('New')
    const only = applyAssignment(rows, id, 'Only', 'Food', edited)
    expect(only[0]!.classification.payee).toBe('Only')
    expect(only[104]).toEqual(rows[104])
  })
})
