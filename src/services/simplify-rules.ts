import { z } from 'zod'
import { ruleSchema } from '../domain/rules'
import { readRules } from './sheet-rules'
import type { Cell } from './sheets'

// Structural equivalence only: never guess whether a search/eq expression is a full match.
const convertible = ruleSchema
  .extend({
    conditions: z
      .array(
        z
          .object({
            field: z.literal('normalized'),
            op: z.literal('full'),
            value: z.string().min(1).max(45000),
          })
          .strict(),
      )
      .length(1),
    exclude: z.literal(false).optional(),
    useNormalized: z.literal(false).optional(),
    sheetFormat: z.undefined().optional(),
  })
  .strict()

export function simplifyRuleRows(original: Cell[][]) {
  readRules(original)
  const changed: number[] = []
  let skipped = 0
  const rows = original.map((row, index) => {
    if (row[0] !== 'rule') return [...row]
    const parsed = convertible.safeParse(JSON.parse(String(row[3])))
    if (!parsed.success || (!parsed.data.payee && !parsed.data.category)) {
      skipped++
      return [...row]
    }
    const rule = parsed.data
    changed.push(index)
    return [
      'simple_rule',
      row[1]!,
      row[2]!,
      '',
      rule.conditions[0]!.value,
      rule.payee ?? '',
      rule.category ?? '',
      ...row.slice(7),
    ]
  })
  // Also detects generated ID collisions before any sheet write.
  readRules(rows)
  return { rows, changed, skipped }
}
