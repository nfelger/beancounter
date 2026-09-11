import { validateRulePack, type Rule, type RulePack } from '../domain/rules'

type Cell = string | number | boolean
export const RULE_HEADERS = [
  'kind',
  'order',
  'enabled',
  'spec_json',
  'pattern',
  'payee',
  'category',
]
const blank = (v: Cell | undefined) => v === undefined || v === ''
function fail(row: number, column: string, message: string): never {
  throw new Error(`Rules!${column}${row}: ${message}`)
}
export function ruleRows(pack: RulePack): Cell[][] {
  const { normalizers, rules, ...settings } = pack
  return [
    ['settings', 0, true, JSON.stringify(settings), '', '', ''],
    ...normalizers.map((r, i): Cell[] => ['normalize', i, true, JSON.stringify(r), '', '', '']),
    ...rules.map((r, i): Cell[] =>
      r.sheetFormat === 'simple_rule'
        ? [
            'simple_rule',
            i,
            r.enabled,
            '',
            String(r.conditions[0]!.value),
            r.payee ?? '',
            r.category ?? '',
          ]
        : ['rule', i, r.enabled, JSON.stringify(r), '', '', ''],
    ),
  ]
}
export function readRules(rows: Cell[][]): RulePack | null {
  const entries = rows
    .map((cells, i) => ({ cells, row: i + 2 }))
    .filter(({ cells }) => !cells.every(blank))
  if (!entries.length) return null
  const settingsRows = entries.filter(({ cells }) => cells[0] === 'settings')
  if (settingsRows.length !== 1) fail(1, 'A', 'Genau eine settings-Zeile erforderlich.')
  const json = (cells: Cell[], row: number): unknown => {
    try {
      return JSON.parse(String(cells[3]))
    } catch {
      fail(row, 'D', 'Ungültiges JSON.')
    }
  }
  const settingsRow = settingsRows[0]!
  let settings: RulePack
  try {
    const value = json(settingsRow.cells, settingsRow.row)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error()
    settings = validateRulePack({ ...value, rules: [], normalizers: [] })
  } catch {
    fail(settingsRow.row, 'D', 'Ungültige Einstellungen.')
  }
  const ordered = { normalize: new Map<number, number>(), rule: new Map<number, number>() }
  const normalizers: { order: number; value: RulePack['normalizers'][number] }[] = []
  const rules: { order: number; row: number; value: Rule }[] = []
  for (const { cells: c, row } of entries) {
    const kind = c[0],
      order = c[1],
      enabled = c[2]
    if (!['settings', 'normalize', 'rule', 'simple_rule'].includes(String(kind)))
      fail(row, 'A', 'Unbekannte Regelart.')
    if (typeof order !== 'number' || !Number.isSafeInteger(order))
      fail(row, 'B', 'Ganze Zahl erforderlich.')
    if (typeof enabled !== 'boolean') fail(row, 'C', 'Checkbox-Wert erforderlich.')
    if (kind === 'simple_rule') {
      if (!blank(c[3])) fail(row, 'D', 'Bei simple_rule leer lassen.')
    } else {
      for (const [i, column] of [
        [4, 'E'],
        [5, 'F'],
        [6, 'G'],
      ] as const)
        if (!blank(c[i])) fail(row, column, 'Nur bei simple_rule ausfüllen.')
    }
    if (kind === 'settings') {
      if (!enabled) fail(row, 'C', 'Einstellungen müssen aktiviert sein.')
      continue
    }
    const priorities = ordered[kind === 'normalize' ? 'normalize' : 'rule']
    if (priorities.has(order))
      fail(row, 'B', `Reihenfolge bereits in Zeile ${priorities.get(order)} verwendet.`)
    priorities.set(order, row)
    if (kind === 'normalize') {
      let value: RulePack['normalizers'][number]
      try {
        value = validateRulePack({ ...settings, normalizers: [json(c, row)] }).normalizers[0]!
      } catch {
        fail(row, 'D', 'Ungültige Normalisierung oder Regex.')
      }
      if (enabled) normalizers.push({ order, value })
      continue
    }
    let value: Rule
    if (kind === 'simple_rule') {
      const pattern = c[4],
        payee = c[5] ?? '',
        category = c[6] ?? ''
      if (typeof pattern !== 'string' || !pattern || pattern.length > 45000)
        fail(row, 'E', 'Regex erforderlich.')
      try {
        new RegExp(pattern, 'i')
      } catch {
        fail(row, 'E', 'Ungültige Regex.')
      }
      if (typeof payee !== 'string' || payee.length > 1000)
        fail(row, 'F', 'Text bis 1000 Zeichen erforderlich.')
      if (typeof category !== 'string' || (category && !settings.categories.includes(category)))
        fail(row, 'G', 'Unbekannte Kategorie.')
      if (!payee && !category) fail(row, 'F', 'Mindestens Empfänger oder Kategorie ausfüllen.')
      value = {
        id: '',
        sheetFormat: 'simple_rule',
        enabled,
        conditions: [{ field: 'normalized', op: 'full', value: pattern }],
        ...(payee ? { payee } : {}),
        ...(category ? { category } : {}),
        exclude: false,
      }
    } else {
      try {
        const spec = json(c, row)
        if (!spec || typeof spec !== 'object' || Array.isArray(spec)) throw new Error()
        value = validateRulePack({
          ...settings,
          rules: [{ ...spec, sheetFormat: undefined, enabled }],
        }).rules[0]!
      } catch {
        fail(row, 'D', 'Ungültige Regel, Kategorie oder Regex.')
      }
    }
    rules.push({ order, row, value })
  }
  const ids = new Set<string>()
  const sorted = rules
    .sort((a, b) => a.order - b.order)
    .map(({ value, row }, i) => {
      if (value.sheetFormat === 'simple_rule') value.id = `simple_rule:${i}`
      if (ids.has(value.id)) fail(row, 'D', 'Doppelte Regel-ID.')
      ids.add(value.id)
      return value
    })
  return validateRulePack({
    ...settings,
    normalizers: normalizers.sort((a, b) => a.order - b.order).map((n) => n.value),
    rules: sorted,
  })
}
