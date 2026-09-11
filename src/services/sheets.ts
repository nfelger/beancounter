import { z } from 'zod'
import {
  transactionSchema,
  importSchema,
  type Transaction,
  type ImportReceipt,
  type ImportPreview,
} from '../domain/model'
import { validateRulePack, type RulePack } from '../domain/rules'
import {
  amountValue,
  sheetAmountMinor,
  dateSerial,
  timestampSerial,
  sheetDate,
  sheetInteger,
  sheetTimestamp,
} from './sheet-values'
import { receiptFor } from '../domain/import'
import { ruleSheetControls } from './rule-sheet-controls'

export const TX_HEADERS = [
  'id',
  'fingerprint',
  'occurrence',
  'booking_date',
  'amount',
  'currency',
  'raw_payee',
  'normalized_payee',
  'payee',
  'category',
  'excluded',
  'import_id',
  'matched_rule',
  'raw_json',
]
import { RULE_HEADERS, readRules, ruleRows } from './sheet-rules'
export { RULE_HEADERS, ruleRows } from './sheet-rules'
export const IMPORT_HEADERS = [
  'id',
  'imported_at',
  'filename',
  'account',
  'period_start',
  'period_end',
  'parsed',
  'added',
  'duplicates',
  'excluded',
  'rules_digest',
]
export const META_HEADERS = ['key', 'value']
const tabs = {
  Transactions: TX_HEADERS,
  Rules: RULE_HEADERS,
  Imports: IMPORT_HEADERS,
  Meta: META_HEADERS,
}
type Tab = keyof typeof tabs
type Cell = string | number | boolean
export interface Snapshot {
  spreadsheetId: string
  title: string
  ids: Record<Tab, number>
  transactions: Transaction[]
  receipts: ImportReceipt[]
  rules: RulePack | null
  transactionRows: number
  receiptRows: number
  ruleRows: number
}
const planSchema = z.object({
  spreadsheetId: z.string().regex(/^[\w-]+$/),
  transactionSheetId: z.number().int(),
  importSheetId: z.number().int(),
  transactionStart: z.number().int().min(1),
  importStart: z.number().int().min(1),
  transactions: z.array(transactionSchema),
  receipt: importSchema,
})
export type SavePlan = z.infer<typeof planSchema>
export class GoogleError extends Error {
  constructor(public status: number) {
    super(
      status === 401
        ? 'Google-Verbindung abgelaufen. Bitte erneut verbinden; deine Vorschau bleibt erhalten.'
        : status === 403
          ? 'Kein Zugriff auf diese Tabelle. Freigabe und Google-Berechtigungen prüfen.'
          : status === 429
            ? 'Google-Limit erreicht. Bitte kurz warten und erneut versuchen.'
            : 'Google-Anfrage fehlgeschlagen. Bitte Verbindung prüfen und erneut versuchen.',
    )
  }
}
export type Requester = <T>(path: string, init?: RequestInit) => Promise<T>
export function googleRequester(token: () => string): Requester {
  return async <T>(path: string, init: RequestInit = {}) => {
    if (!token()) throw new GoogleError(401)
    let response: Response
    try {
      response = await fetch('https://sheets.googleapis.com/v4/spreadsheets' + path, {
        ...init,
        headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
        cache: 'no-store',
      })
    } catch {
      throw new Error('Verbindung unterbrochen. Der Speicherstatus muss geprüft werden.')
    }
    if (!response.ok) throw new GoogleError(response.status)
    return response.json() as Promise<T>
  }
}
type NumberFormat = { type: 'DATE' | 'DATE_TIME' | 'NUMBER'; pattern: string }
const DATE_FORMAT: NumberFormat = { type: 'DATE', pattern: 'dd.mm.yyyy' }
// Sheets interprets these format tokens using the spreadsheet locale (default de_DE).
const EURO_FORMAT: NumberFormat = { type: 'NUMBER', pattern: '#,##0.00 "€"' }
const INTEGER_FORMAT: NumberFormat = { type: 'NUMBER', pattern: '0' }
const TX_FORMATS: Record<number, NumberFormat> = {
  2: INTEGER_FORMAT,
  3: DATE_FORMAT,
  4: EURO_FORMAT,
}
const IMPORT_FORMATS: Record<number, NumberFormat> = {
  1: { type: 'DATE_TIME', pattern: 'dd.mm.yyyy hh:mm:ss "UTC"' },
  4: DATE_FORMAT,
  5: DATE_FORMAT,
  6: INTEGER_FORMAT,
  7: INTEGER_FORMAT,
  8: INTEGER_FORMAT,
  9: INTEGER_FORMAT,
}
function rowData(values: Cell[], formats: Record<number, NumberFormat> = {}) {
  if (values.some((v) => typeof v === 'string' && v.length > 45000))
    throw new Error('Ein Feld ist zu lang für Google Sheets.')
  return {
    values: values.map((value, index) => ({
      ...(formats[index] ? { userEnteredFormat: { numberFormat: formats[index] } } : {}),
      userEnteredValue:
        typeof value === 'number'
          ? { numberValue: value }
          : typeof value === 'boolean'
            ? { boolValue: value }
            : { stringValue: value },
    })),
  }
}
function putRows(
  sheetId: number,
  startRowIndex: number,
  rows: Cell[][],
  formats: Record<number, NumberFormat> = {},
) {
  return {
    updateCells: {
      start: { sheetId, rowIndex: startRowIndex, columnIndex: 0 },
      rows: rows.map((r) => rowData(r, formats)),
      fields: Object.keys(formats).length
        ? 'userEnteredValue,userEnteredFormat.numberFormat'
        : 'userEnteredValue',
    },
  }
}
export function transactionRow(t: Transaction): Cell[] {
  return [
    t.id,
    t.fingerprint,
    t.occurrence,
    dateSerial(t.bookingDate),
    amountValue(t.amountMinor),
    t.raw.currency,
    t.raw.rawPayee,
    t.classification.normalized,
    t.classification.payee,
    t.classification.category,
    t.classification.excluded,
    t.importId,
    t.classification.matchedRule,
    JSON.stringify(t.raw),
  ]
}
export function readTransaction(r: Cell[]): Transaction {
  try {
    const raw = JSON.parse(String(r[13]))
    return transactionSchema.parse({
      id: r[0],
      fingerprint: r[1],
      occurrence: sheetInteger(r[2]),
      bookingDate: sheetDate(r[3]),
      amountMinor: sheetAmountMinor(r[4]),
      raw,
      classification: {
        normalized: r[7],
        payee: r[8],
        category: r[9],
        excluded: r[10],
        matchedRule: r[12] ?? '',
      },
      importId: r[11],
    })
  } catch {
    throw new Error(
      'Eine gespeicherte Buchung hat ein ungültiges Format. Tabelle prüfen; nichts wurde überschrieben.',
    )
  }
}
function receiptRow(r: ImportReceipt): Cell[] {
  return [
    r.id,
    timestampSerial(r.importedAt),
    r.filename,
    r.account,
    dateSerial(r.periodStart),
    dateSerial(r.periodEnd),
    r.parsed,
    r.added,
    r.duplicates,
    r.excluded,
    r.rulesDigest,
  ]
}
function readReceipt(r: Cell[]): ImportReceipt {
  const result = importSchema.safeParse({
    id: r[0],
    importedAt: sheetTimestamp(r[1]),
    filename: r[2],
    account: r[3],
    periodStart: sheetDate(r[4]),
    periodEnd: sheetDate(r[5]),
    parsed: sheetInteger(r[6]),
    added: sheetInteger(r[7]),
    duplicates: sheetInteger(r[8]),
    excluded: sheetInteger(r[9]),
    rulesDigest: r[10],
  })
  if (!result.success) throw new Error('Importverlauf hat ein ungültiges Format.')
  return result.data
}
function checkRows(rows: Cell[][], header: string[], allowBlank = false): Cell[][] {
  if (JSON.stringify(rows[0]) !== JSON.stringify(header))
    throw new Error(
      'Tabellenschema stimmt nicht überein. Bitte eine Beancounter-Tabelle verwenden.',
    )
  const data = rows.slice(1)
  if (!allowBlank && data.some((r) => !r.length || r.every((c) => c === '')))
    throw new Error('Leere Zwischenzeilen in der Tabelle. Bitte Tabelle prüfen.')
  return data
}
export class SheetsStore {
  constructor(private request: Requester) {}
  async create(): Promise<string> {
    const result = await this.request<{ spreadsheetId: string }>('', {
      method: 'POST',
      body: JSON.stringify({
        properties: { title: 'Beancounter', locale: 'de_DE', timeZone: 'Europe/Berlin' },
        sheets: Object.entries(tabs).map(([title, headers], sheetId) => ({
          properties: {
            sheetId,
            title,
            gridProperties: {
              rowCount: 30000,
              columnCount: Math.max(headers.length, 4),
              frozenRowCount: 1,
            },
          },
          data: [
            {
              startRow: 0,
              startColumn: 0,
              rowData: [
                rowData(headers),
                ...(title === 'Meta' ? [rowData(['schema_version', '4'])] : []),
              ],
            },
          ],
        })),
      }),
    })
    return result.spreadsheetId
  }
  async load(spreadsheetId: string): Promise<Snapshot> {
    if (!/^[\w-]+$/.test(spreadsheetId)) throw new Error('Ungültige Tabellenkennung.')
    const meta = await this.request<{
      properties: { title: string }
      sheets: {
        properties: { title: string; sheetId: number }
      }[]
    }>(`/${spreadsheetId}?fields=properties.title,sheets.properties(sheetId,title)`)
    const ids = {} as Record<Tab, number>
    for (const name of Object.keys(tabs) as Tab[]) {
      const sheet = meta.sheets.find((s) => s.properties.title === name)
      if (!sheet)
        throw new Error(
          'Dies ist keine eingerichtete Beancounter-Tabelle. Bitte eine neue Tabelle anlegen.',
        )
      ids[name] = sheet.properties.sheetId
    }
    const ranges = ['Transactions!A:N', 'Rules!A:G', 'Imports!A:K', 'Meta!A:B']
    const values = await this.request<{ valueRanges: { values?: Cell[][] }[] }>(
      `/${spreadsheetId}/values:batchGet?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER&${ranges.map((r) => 'ranges=' + encodeURIComponent(r)).join('&')}`,
    )
    const settings = checkRows(values.valueRanges[3]?.values ?? [], META_HEADERS)
    if (String(settings.find((r) => r[0] === 'schema_version')?.[1]) !== '4')
      throw new Error('Nicht unterstützte Tabellenversion.')
    const [tx, rules, imports] = (['Transactions', 'Rules', 'Imports'] as const).map((name, i) =>
      checkRows(values.valueRanges[i]?.values ?? [], tabs[name], name === 'Rules'),
    )
    const transactions = tx!.map(readTransaction),
      receipts = imports!.map(readReceipt)
    if (new Set(transactions.map((t) => t.id)).size !== transactions.length)
      throw new Error('Doppelte Buchungskennungen in der Tabelle. Bitte vor dem Import prüfen.')
    return {
      spreadsheetId,
      title: meta.properties.title,
      ids,
      transactions,
      receipts,
      rules: readRules(rules!),
      transactionRows: tx!.length + 1,
      receiptRows: imports!.length + 1,
      ruleRows: rules!.length + 1,
    }
  }
  async formatRules(snapshot: Snapshot) {
    await this.request(`/${snapshot.spreadsheetId}:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({
        requests: ruleSheetControls(snapshot.ids.Rules, snapshot.rules?.categories ?? []),
      }),
    })
  }
  async replaceRules(snapshot: Snapshot, pack: RulePack) {
    const validated = validateRulePack(pack)
    const rows = [RULE_HEADERS, ...ruleRows(validated)]
    // Range-based update clears trailing old entries atomically.
    await this.request(`/${snapshot.spreadsheetId}:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({
        requests: [
          ...ruleSheetControls(snapshot.ids.Rules, validated.categories),
          {
            updateCells: {
              range: {
                sheetId: snapshot.ids.Rules,
                startRowIndex: 0,
                endRowIndex: Math.max(snapshot.ruleRows, rows.length),
                startColumnIndex: 0,
                endColumnIndex: RULE_HEADERS.length,
              },
              rows: rows.map((r) => rowData(r)),
              fields: 'userEnteredValue',
            },
          },
        ],
      }),
    })
  }
  async save(plan: SavePlan): Promise<void> {
    const body = saveBody(plan)
    await this.request(`/${plan.spreadsheetId}:batchUpdate`, { method: 'POST', body })
  }
  async correct(snapshot: Snapshot, id: string, payee: string, category: string) {
    const index = snapshot.transactions.findIndex((t) => t.id === id)
    if (index < 0) throw new Error('Buchung nicht gefunden. Bitte neu laden.')
    await this.request(`/${snapshot.spreadsheetId}:batchUpdate`, {
      method: 'POST',
      body: JSON.stringify({
        requests: [
          {
            updateCells: {
              start: { sheetId: snapshot.ids.Transactions, rowIndex: index + 1, columnIndex: 8 },
              rows: [rowData([payee, category])],
              fields: 'userEnteredValue',
            },
          },
        ],
      }),
    })
  }
}
export function createSavePlan(snapshot: Snapshot, preview: ImportPreview): SavePlan {
  return {
    spreadsheetId: snapshot.spreadsheetId,
    transactionSheetId: snapshot.ids.Transactions,
    importSheetId: snapshot.ids.Imports,
    transactionStart: snapshot.transactionRows,
    importStart: snapshot.receiptRows,
    transactions: preview.transactions,
    receipt: receiptFor(preview),
  }
}
export function saveBody(plan: SavePlan): string {
  const requests: unknown[] = []
  if (plan.transactions.length)
    requests.push(
      putRows(
        plan.transactionSheetId,
        plan.transactionStart,
        plan.transactions.map(transactionRow),
        TX_FORMATS,
      ),
    )
  requests.push(
    putRows(plan.importSheetId, plan.importStart, [receiptRow(plan.receipt)], IMPORT_FORMATS),
  )
  const body = JSON.stringify({ requests })
  if (new TextEncoder().encode(body).length > 1_800_000)
    throw new Error('Import zu groß. Bitte einen kürzeren Exportzeitraum wählen.')
  if (plan.transactionStart + plan.transactions.length > 30000 || plan.importStart >= 30000)
    throw new Error('Tabellengrenze erreicht. Bitte zunächst archivieren.')
  return body
}
export function reconcile(snapshot: Snapshot, plan: SavePlan): 'saved' | 'retry' {
  if (snapshot.spreadsheetId !== plan.spreadsheetId)
    throw new Error('Der offene Import gehört zu einer anderen Tabelle.')
  const receipt = snapshot.receipts.find((r) => r.id === plan.receipt.id)
  if (receipt) {
    const ids = new Set(snapshot.transactions.map((t) => t.id))
    if (!plan.transactions.every((t) => ids.has(t.id)))
      throw new Error('Importbeleg und Buchungen widersprechen sich. Bitte Tabelle prüfen.')
    return 'saved'
  }
  // A retry may overwrite only its original, still unoccupied target ranges.
  if (
    snapshot.transactionRows !== plan.transactionStart ||
    snapshot.receiptRows !== plan.importStart
  )
    throw new Error(
      'Die Tabelle wurde seit dem Speicherversuch verändert. Bitte den offenen Import manuell prüfen.',
    )
  return 'retry'
}
const PENDING_KEY = 'beancounter.pending.v1'
export function persistPending(plan: SavePlan) {
  saveBody(plan) // Validate before locking the UI or retaining a pending import.
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(plan))
  } catch {
    throw new Error(
      'Der Browser kann den offenen Import nicht sichern. Bitte Browserspeicher freigeben.',
    )
  }
}
export function restorePending(): SavePlan | null {
  const raw = sessionStorage.getItem(PENDING_KEY)
  if (!raw) return null
  try {
    return planSchema.parse(JSON.parse(raw))
  } catch {
    throw new Error(
      'Gesicherter Import ist beschädigt. Tab geöffnet lassen und Daten manuell prüfen.',
    )
  }
}
export function clearPending() {
  sessionStorage.removeItem(PENDING_KEY)
}
