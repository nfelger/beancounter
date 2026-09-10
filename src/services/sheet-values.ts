import { parseGermanDate } from '../domain/csv'

const DAY_MS = 86_400_000
const EPOCH = Date.UTC(1899, 11, 30)
export function sheetDate(value: unknown): string {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 2958465)
    throw new Error('Ungültiges Datum.')
  return new Date(EPOCH + value * DAY_MS).toISOString().slice(0, 10)
}
export function dateSerial(iso: string): number {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!parts) throw new Error('Ungültiges Datum.')
  const date = parseGermanDate(`${parts[3]}.${parts[2]}.${parts[1]}`)
  return (Date.parse(date + 'T00:00:00Z') - EPOCH) / DAY_MS
}
export function sheetTimestamp(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value >= 2958466)
    throw new Error('Ungültiger Zeitpunkt.')
  return new Date(Math.round(EPOCH + value * DAY_MS)).toISOString()
}
export function timestampSerial(iso: string): number {
  const timestamp = Date.parse(iso)
  if (!Number.isFinite(timestamp)) throw new Error('Ungültiger Zeitpunkt.')
  return (timestamp - EPOCH) / DAY_MS
}
export function sheetInteger(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value))
    throw new Error('Ungültige ganze Zahl.')
  return value
}

export function sheetAmountMinor(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Ungültiger Betrag.')
  // Remove binary floating-point artifacts at the boundary; calculations use cents.
  return sheetInteger(Math.round(value * 100))
}
export function amountValue(cents: number): number {
  const euros = sheetInteger(cents) / 100
  if (sheetAmountMinor(euros) !== cents) throw new Error('Betrag zu groß für Google Sheets.')
  return euros
}
