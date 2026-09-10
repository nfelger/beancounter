import { describe, expect, it } from 'vitest'
import {
  amountValue,
  sheetAmountMinor,
  dateSerial,
  sheetDate,
  sheetInteger,
  sheetTimestamp,
  timestampSerial,
} from '../src/services/sheet-values'
import { readTransaction, transactionRow } from '../src/services/sheets'
import { prepareImport } from '../src/domain/import'
import { source, pack } from './fixtures'

describe('locale-independent spreadsheet values', () => {
  it('reads numeric dates without depending on display format or timezone', () => {
    expect(sheetDate(45717)).toBe('2025-03-01')
    for (const iso of ['2024-02-29', '2025-03-30', '2025-10-26']) {
      expect(sheetDate(dateSerial(iso))).toBe(iso)
    }
    expect(() => sheetDate('01.03.2025')).toThrow()
    expect(() => dateSerial('2025-02-30')).toThrow()
    expect(() => sheetDate(45717.5)).toThrow()
  })
  it('keeps import timestamps in UTC including milliseconds', () => {
    const iso = '2025-03-30T00:59:59.123Z'
    expect(sheetTimestamp(timestampSerial(iso))).toBe(iso)
  })
  it('reads integer counts without confusing German separators', () => {
    expect(sheetInteger(-123456)).toBe(-123456)
    expect(() => sheetInteger('-123456')).toThrow()
    expect(() => sheetInteger('-123.456,00')).toThrow()
    expect(() => sheetInteger('-1.234,56')).toThrow()
    expect(() => sheetInteger('12.34')).toThrow()
  })
  it('converts euros to integer cents, including binary floating-point artifacts', () => {
    expect(sheetAmountMinor(0.29)).toBe(29)
    expect(sheetAmountMinor(-0.29)).toBe(-29)
    for (const cents of [0, 1, -1, 29, -29, 123456, -123456, 999999999])
      expect(sheetAmountMinor(amountValue(cents))).toBe(cents)
    for (const invalid of ['1.234,56', null, true, NaN, Infinity, 1e20])
      expect(() => sheetAmountMinor(invalid)).toThrow()
    expect(() => amountValue(1.5)).toThrow()
  })
  it('loads a transaction after its date has been converted in Sheets', async () => {
    const t = (await prepareImport(source(), pack, [])).transactions[0]!
    const row = transactionRow(t)
    row[3] = dateSerial(t.bookingDate)
    row[4] = t.amountMinor / 100
    expect(readTransaction(row)).toEqual(t)
  })
})
