import { describe, expect, it } from 'vitest'
import { parseIngCsv, parseGermanAmount, parseGermanDate, decodeCsv } from '../src/domain/csv'
import { csv, raw } from './fixtures'
describe('ING parsing', () => {
  it('preserves raw fields, distinguishes currencies, and handles quoted multiline purposes', () => {
    const purpose = 'Two; items\nand "a quote"'
    const result = parseIngCsv(csv([{ ...raw, purpose, balanceCurrency: 'USD' }]), 'test.csv')
    expect(result.transactions[0]?.purpose).toBe(purpose)
    expect(result.transactions[0]?.balanceCurrency).toBe('USD')
    expect(result.transactions[0]?.currency).toBe('EUR')
    expect(result.periodEnd).toBe('2025-02-28')
  })
  it('supports CRLF and trailing empty records', () => {
    expect(
      parseIngCsv(csv().replace(/\n/g, '\r\n') + '\r\n\r\n', 'test').transactions,
    ).toHaveLength(1)
  })
  it('recognizes only known damaged headers and warns about damaged data', () => {
    const result = parseIngCsv(csv().replaceAll('ä', '�'), 'test')
    expect(result.warnings).toHaveLength(1)
    expect(result.transactions).toHaveLength(1)
  })
  it('rejects unknown headers instead of silently mapping by position', () => {
    expect(() => parseIngCsv(csv().replace('Betrag;', 'Unknown;'), 'test')).toThrow('Spaltenformat')
  })
  it('rejects malformed quoting', () => {
    expect(() => parseIngCsv(csv() + '\n"unclosed', 'test')).toThrow('beschädigt')
  })
  it('rejects invalid rows as a whole import without exposing their contents', () => {
    const malformed = csv([{ ...raw, rawAmount: 'SECRET' }])
    try {
      parseIngCsv(malformed, 'test')
      expect.unreachable()
    } catch (e) {
      expect(String(e)).toContain('Buchung 1')
      expect(String(e)).not.toContain('SECRET')
    }
  })
  it('rejects rows outside coverage and currencies without a defined minor unit policy', () => {
    expect(() => parseIngCsv(csv([{ ...raw, bookingDate: '01.03.2025' }]), 'test')).toThrow(
      'Exportzeitraum',
    )
    expect(() => parseIngCsv(csv([{ ...raw, currency: 'JPY' }]), 'test')).toThrow('EUR')
  })
  it('decodes UTF-8 BOM and windows-1252 without losing umlauts', () => {
    const bytes = new TextEncoder().encode('\uFEFFGrüße')
    expect(decodeCsv(bytes.buffer)).toBe('Grüße')
    expect(decodeCsv(new Uint8Array([71, 114, 252, 223, 101]).buffer)).toBe('Grüße')
  })
})
describe('amounts and date-only values', () => {
  it.each([
    ['-1.234,56', -123456],
    ['+0,07', 7],
    ['12,30 €', 1230],
    ['1 234,00', 123400],
  ])('parses %s exactly', (value, minor) => expect(parseGermanAmount(value)).toBe(minor))
  it.each(['1,234', '12.34', '1.23,45', 'NaN', '', '1e3,00'])('rejects %s', (v) =>
    expect(() => parseGermanAmount(v)).toThrow(),
  )
  it('validates leap days without timezone conversion', () => {
    expect(parseGermanDate('29.02.2024')).toBe('2024-02-29')
    expect(() => parseGermanDate('29.02.2025')).toThrow()
    expect(() => parseGermanDate('31.04.2025')).toThrow()
  })
})
