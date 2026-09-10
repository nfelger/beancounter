import { parseGermanAmount, parseGermanDate } from '../domain/csv'

const DAY_MS = 86_400_000
const EPOCH = Date.UTC(1899, 11, 30)
export function sheetDate(value: unknown): string {
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value < 0 || value > 2958465)
      throw new Error('Ungültiges Datum.')
    return new Date(EPOCH + value * DAY_MS).toISOString().slice(0, 10)
  }
  if (typeof value !== 'string') throw new Error('Ungültiges Datum.')
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  return parseGermanDate(iso ? `${iso[3]}.${iso[2]}.${iso[1]}` : value)
}
export function dateSerial(iso: string): number {
  return (Date.parse(sheetDate(iso) + 'T00:00:00Z') - EPOCH) / DAY_MS
}
export function sheetTimestamp(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value < 2958466)
    return new Date(Math.round(EPOCH + value * DAY_MS)).toISOString()
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T.*Z$/.test(value))
    return new Date(value).toISOString()
  throw new Error('Ungültiger Zeitpunkt.')
}
export function timestampSerial(iso: string): number {
  return (Date.parse(sheetTimestamp(iso)) - EPOCH) / DAY_MS
}
export function sheetInteger(value: unknown): number {
  // Actual Sheets numbers are locale-independent. Only legacy text needs parsing.
  const number =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? /^-?\d+$/.test(value)
          ? Number(value)
          : parseGermanAmount(value) / 100
        : NaN
  if (!Number.isSafeInteger(number)) throw new Error('Ungültige ganze Zahl.')
  return number
}
