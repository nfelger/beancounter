import Papa from 'papaparse'
import type { ParsedImport } from './model'
import { rawSchema } from './model'

export function parseGermanAmount(value: string): number {
  const v = value.replace(/[€\s]/g, '')
  if (!/^[+-]?(?:\d+|\d{1,3}(?:\.\d{3})+),\d{2}$/.test(v))
    throw new Error('Ungültiger Betrag. Erwartet wird ein Betrag mit zwei Nachkommastellen.')
  const result = Number(v.replace(/\./g, '').replace(',', ''))
  if (!Number.isSafeInteger(result)) throw new Error('Betrag außerhalb des unterstützten Bereichs.')
  return result
}
export function parseGermanDate(value: string): string {
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value.trim())
  if (!match) throw new Error('Ungültiges Datum. Erwartet wird TT.MM.JJJJ.')
  const [, d, m, y] = match
  const iso = `${y}-${m}-${d}`
  const date = new Date(`${iso}T12:00:00Z`)
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== iso)
    throw new Error('Ungültiger Kalendertag.')
  return iso
}
export function decodeCsv(bytes: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('windows-1252', { fatal: true }).decode(bytes)
  }
}
const headerAliases: Record<string, string> = {
  'Auftraggeber/Empf�nger': 'Auftraggeber/Empfänger',
  'W�hrung': 'Währung',
}
const expectedHeaders = [
  'Buchung',
  'Wertstellungsdatum',
  'Auftraggeber/Empfänger',
  'Buchungstext',
  'Verwendungszweck',
  'Saldo',
  'Währung',
  'Betrag',
  'Währung',
]

export function parseIngCsv(text: string, filename: string): ParsedImport {
  const start = /^(?:\uFEFF)?Buchung;Wertstellungsdatum;.*$/m.exec(text)
  if (!start || start.index === undefined) throw new Error('Keine ING-Umsatztabelle gefunden.')
  const preamble = Papa.parse<string[]>(text.slice(0, start.index), { delimiter: ';' }).data
  const meta = new Map(
    preamble.filter((r) => r.length >= 2).map((r) => [r[0]!.trim(), r[1]!.trim()]),
  )
  const account = (meta.get('IBAN') ?? '').replace(/\s/g, '').toUpperCase()
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(account))
    throw new Error('Kontokennung fehlt oder ist ungültig.')
  const period = /^(\d{2}\.\d{2}\.\d{4})\s*-\s*(\d{2}\.\d{2}\.\d{4})$/.exec(
    meta.get('Zeitraum') ?? '',
  )
  if (!period) throw new Error('Exportzeitraum fehlt oder ist ungültig.')
  const periodStart = parseGermanDate(period[1]!),
    periodEnd = parseGermanDate(period[2]!)
  if (periodStart > periodEnd) throw new Error('Exportzeitraum ist widersprüchlich.')
  const result = Papa.parse<string[]>(text.slice(start.index), {
    delimiter: ';',
    skipEmptyLines: 'greedy',
  })
  if (result.errors.length)
    throw new Error('CSV ist beschädigt oder enthält nicht geschlossene Anführungszeichen.')
  const header = result.data.shift()?.map((h) => headerAliases[h.trim()] ?? h.trim())
  if (JSON.stringify(header) !== JSON.stringify(expectedHeaders))
    throw new Error('Unbekanntes ING-Spaltenformat. Die Datei wurde nicht importiert.')
  if (result.data.length > 20000)
    throw new Error('Bitte einen kleineren Export wählen (höchstens 20.000 Buchungen).')
  const transactions = result.data.map((r, i) => {
    try {
      if (r.length !== expectedHeaders.length) throw new Error('Unerwartete Spaltenanzahl.')
      const bookingDate = parseGermanDate(r[0]!)
      parseGermanDate(r[1]!)
      if (bookingDate < periodStart || bookingDate > periodEnd)
        throw new Error('Buchung außerhalb des Exportzeitraums.')
      parseGermanAmount(r[7]!)
      const parsed = rawSchema.safeParse({
        bookingDate: r[0]!,
        valueDate: r[1]!,
        rawPayee: r[2]!,
        bookingText: r[3]!,
        purpose: r[4]!,
        rawBalance: r[5]!,
        balanceCurrency: r[6]!,
        rawAmount: r[7]!,
        currency: r[8]!.trim(),
        account,
      })
      if (!parsed.success) throw new Error('Ungültige Felder oder Währung.')
      if (parsed.data.currency !== 'EUR')
        throw new Error('Zurzeit werden nur EUR-Kontobuchungen unterstützt.')
      return parsed.data
    } catch (e) {
      // Deliberately omit the cause: errors must not retain private row contents.
      // eslint-disable-next-line preserve-caught-error
      throw new Error(`Buchung ${i + 1}: ${e instanceof Error ? e.message : 'Ungültige Daten.'}`)
    }
  })
  return {
    filename,
    account,
    periodStart,
    periodEnd,
    transactions,
    warnings: text.includes('\uFFFD')
      ? [
          'Die Datei enthält bereits beschädigte Zeichen (�). Originaltexte bleiben unverändert; bitte Vorschau und Zuordnung prüfen.',
        ]
      : [],
  }
}
