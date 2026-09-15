import { createClassifier, type RulePack } from '../domain/rules'
import type { Transaction } from '../domain/model'
import { readRules } from './sheet-rules'
import type { Cell } from './sheets'

export interface AssignmentRuleResult {
  cells: Cell[][]
  pack: RulePack
  normalized: string
  matchedRule: string
}
export function samePayee(a: string, b: string): boolean {
  // Escaped literal matching: no user-authored regex is evaluated on the UI thread.
  return new RegExp(`^(?:${escapePattern(a)})(?![\\s\\S])`, 'i').test(b)
}
function escapePattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
// Run in the worker, because existing normalization and exclusion rules are arbitrary regexes.
export function buildAssignmentRule(
  cells: Cell[][],
  transaction: Transaction,
  payee: string,
  category: string,
): AssignmentRuleResult {
  const before = readRules(cells)
  if (!before || !payee.trim() || payee.length > 1000 || !before.categories.includes(category))
    throw new Error('Für die Regel bitte Empfänger und eine gültige Kategorie angeben.')
  const original = createClassifier(before)(transaction.raw)
  if (transaction.classification.excluded || original.excluded)
    throw new Error('Ausgeschlossene Buchungen können keine Zuordnungsregel erzeugen.')
  if (!original.normalized) throw new Error('Der normalisierte Empfänger ist leer.')
  const pattern = escapePattern(original.normalized)
  const after = cells.map((r) => [...r])
  const existing = after.findIndex(
    (r) => r[0] === 'simple_rule' && String(r[4]).toLowerCase() === pattern.toLowerCase(),
  )
  const activeRows = after.filter(
    (r, i) => i !== existing && ['rule', 'simple_rule'].includes(String(r[0])),
  )
  const exclusions = activeRows.filter(
    (r) => r[0] === 'rule' && r[2] === true && JSON.parse(String(r[3])).exclude,
  )
  let priority: number
  if (!exclusions.length) priority = Math.min(0, ...activeRows.map((r) => Number(r[1]))) - 1
  else {
    priority = Math.max(...exclusions.map((r) => Number(r[1]))) + 1
    // Make a gap only where necessary, keeping relative ordering and all other cell values.
    if (activeRows.some((r) => r[1] === priority))
      activeRows
        .filter((r) => Number(r[1]) >= priority)
        .forEach((r) => {
          r[1] = Number(r[1]) + 1
        })
  }
  if (!Number.isSafeInteger(priority) || activeRows.some((r) => !Number.isSafeInteger(r[1])))
    throw new Error(
      'Regelreihenfolge außerhalb des unterstützten Bereichs. Bitte im Sheet anpassen.',
    )
  const row: Cell[] = ['simple_rule', priority, true, '', pattern, payee.trim(), category]
  if (existing >= 0) after[existing] = row
  else after.push(row)
  const pack = readRules(after)!
  const generated = pack.rules.find(
    (r) => r.sheetFormat === 'simple_rule' && r.conditions[0]!.value === pattern,
  )!
  const result = createClassifier(pack)(transaction.raw)
  if (result.matchedRule !== generated.id)
    throw new Error(
      'Eine frühere Zuordnungsregel blockiert die neue Regel vor den Ausschlüssen. Bitte die Reihenfolge im Sheet prüfen.',
    )
  return { cells: after, pack, normalized: original.normalized, matchedRule: generated.id }
}
export function relatedAssignments(
  transactions: Transaction[],
  source: Transaction,
  edited: ReadonlySet<string>,
): Transaction[] {
  return transactions.filter(
    (t) =>
      t.id !== source.id &&
      !t.classification.excluded &&
      !edited.has(t.id) &&
      samePayee(source.classification.normalized, t.classification.normalized),
  )
}
export function applyAssignment(
  transactions: Transaction[],
  sourceId: string,
  payee: string,
  category: string,
  edited: ReadonlySet<string>,
  rule?: Pick<AssignmentRuleResult, 'normalized' | 'matchedRule'>,
): Transaction[] {
  return transactions.map((t) => {
    const source = t.id === sourceId
    if (
      t.classification.excluded ||
      (!source &&
        (!rule || edited.has(t.id) || !samePayee(rule.normalized, t.classification.normalized)))
    )
      return t
    return {
      ...t,
      classification: {
        ...t.classification,
        payee,
        category,
        ...(rule ? { matchedRule: rule.matchedRule } : {}),
      },
    }
  })
}
