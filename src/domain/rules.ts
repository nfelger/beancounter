import { z } from 'zod'
import type { Classification, RawTransaction } from './model'
import { parseGermanAmount } from './csv'

const fieldSchema = z.enum(['normalized', 'bookingTextNorm', 'purposeNorm', 'foreign', 'key'])
const conditionSchema = z.object({
  field: fieldSchema,
  op: z.enum(['eq', 'search', 'full']),
  value: z.union([z.string().max(45000), z.boolean()]),
})
export const normalizerSchema = z.object({
  pattern: z.string().max(2000),
  value: z.string().max(1000),
  kind: z.enum(['replace', 'terminal']),
  full: z.boolean().default(false),
})
export const ruleSchema = z.object({
  id: z.string().min(1).max(100),
  enabled: z.boolean().default(true),
  conditions: z.array(conditionSchema).min(1).max(20),
  payee: z.string().max(1000).optional(),
  useNormalized: z.boolean().optional(),
  category: z.string().max(1000).optional(),
  confidence: z.enum(['high', 'medium', 'low']).default('high'),
  exclude: z.boolean().default(false),
})
export const settingsSchema = z.object({
  version: z.literal(1),
  categories: z.array(z.string().min(1).max(1000)).max(200),
  unknownPayee: z.string().max(1000),
  unknownCategory: z.string().max(1000),
  countryPattern: z.string().max(2000),
  domesticCountry: z.string().max(10),
})
export const rulePackSchema = settingsSchema.extend({
  normalizers: z.array(normalizerSchema).max(500),
  rules: z.array(ruleSchema).max(10000),
})
export type RulePack = z.infer<typeof rulePackSchema>
export type Rule = z.infer<typeof ruleSchema>

export function asciiUpper(value: string): string {
  return value.normalize('NFKD').replace(/\p{M}/gu, '').toUpperCase().replace(/\s+/g, ' ').trim()
}
export function transactionKey(raw: RawTransaction): string {
  const amount = parseGermanAmount(raw.rawAmount)
  return JSON.stringify(
    [
      raw.bookingDate,
      raw.valueDate,
      raw.rawPayee,
      raw.bookingText,
      raw.purpose,
      (amount / 100).toFixed(2),
      raw.currency,
    ].map((v) => v.trim()),
  )
}
function regex(pattern: string, full = false, global = false) {
  new RegExp(pattern, 'i') // Validate independently; a wrapper must not repair malformed syntax.
  // (?![\s\S]) enforces Python-style fullmatch, including a trailing newline.
  return new RegExp(full ? `^(?:${pattern})(?![\\s\\S])` : pattern, global ? 'gi' : 'i')
}
export function validateRulePack(value: unknown): RulePack {
  const result = rulePackSchema.safeParse(value)
  if (!result.success)
    throw new Error('Regeldatei hat ein ungültiges Format. Keine Regeln wurden übernommen.')
  const pack = result.data
  try {
    regex(pack.countryPattern)
    for (const n of pack.normalizers) regex(n.pattern, n.full)
    const ids = new Set<string>()
    for (const r of pack.rules) {
      if (ids.has(r.id)) throw new Error()
      ids.add(r.id)
      if (!r.exclude && (!r.category || !pack.categories.includes(r.category))) throw new Error()
      for (const c of r.conditions) {
        if (c.op !== 'eq') {
          if (typeof c.value !== 'string') throw new Error()
          regex(c.value, c.op === 'full')
        }
      }
    }
  } catch {
    throw new Error(
      'Regeln enthalten einen ungültigen Ausdruck, eine unbekannte Kategorie oder doppelte IDs.',
    )
  }
  return pack
}
export function createClassifier(pack: RulePack) {
  const normalizers = pack.normalizers.map((n) => ({
    ...n,
    re: regex(n.pattern, n.full, n.kind === 'replace'),
  }))
  const rules = pack.rules
    .filter((r) => r.enabled)
    .map((r) => ({
      ...r,
      conditions: r.conditions.map((c) => ({
        ...c,
        re: c.op === 'eq' ? undefined : regex(String(c.value), c.op === 'full'),
      })),
    }))
  const countryRe = regex(pack.countryPattern)
  return (raw: RawTransaction): Classification => {
    let normalized = asciiUpper(raw.rawPayee)
    for (const n of normalizers) {
      n.re.lastIndex = 0
      if (n.kind === 'terminal') {
        if (n.re.test(normalized)) {
          normalized = n.value
          break
        }
      } else normalized = normalized.replace(n.re, () => n.value).trim()
    }
    const country = countryRe.exec(asciiUpper(raw.purpose))?.[1]
    const fields = {
      normalized,
      bookingTextNorm: asciiUpper(raw.bookingText),
      purposeNorm: asciiUpper(raw.purpose),
      foreign: !!country && country !== pack.domesticCountry,
      key: transactionKey(raw),
    }
    const r = rules.find((rule) =>
      rule.conditions.every((c) =>
        c.re ? c.re.test(String(fields[c.field])) : fields[c.field] === c.value,
      ),
    )
    return {
      normalized,
      payee: r?.useNormalized
        ? normalized || pack.unknownPayee
        : r?.payee || normalized || pack.unknownPayee,
      category: r?.category || pack.unknownCategory,
      confidence: r?.confidence || 'low',
      matchedRule: r?.id || '',
      excluded: r?.exclude || false,
    }
  }
}
