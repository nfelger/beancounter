// Entirely invented examples. Never derive public fixtures from a real bank export.
import type { RawTransaction, ParsedImport } from '../src/domain/model'
import type { RulePack } from '../src/domain/rules'
import type { Snapshot } from '../src/services/sheets'
export const raw: RawTransaction = {
  bookingDate: '04.02.2025',
  valueDate: '03.02.2025',
  rawPayee: 'CARD MOONBEAN SHOP',
  bookingText: 'Card payment',
  purpose: 'TEST-REFERENCE-001',
  rawAmount: '-12,34',
  currency: 'EUR',
  rawBalance: '800,00',
  balanceCurrency: 'EUR',
  account: 'DE00000000000000000000',
}
export const pack: RulePack = {
  version: 1,
  categories: ['Food', 'Other', 'Travel'],
  unknownPayee: 'Unknown',
  unknownCategory: 'Other',
  countryPattern: 'COUNTRY:([A-Z]{2})',
  domesticCountry: 'DE',
  normalizers: [{ kind: 'replace', pattern: '^CARD\\s+', value: '', full: false }],
  rules: [
    {
      id: 'test-1',
      enabled: true,
      conditions: [{ field: 'normalized', op: 'full', value: 'MOONBEAN SHOP' }],
      payee: 'Moonbean',
      category: 'Food',
      exclude: false,
    },
  ],
}
export function source(transactions: RawTransaction[] = [raw]): ParsedImport {
  return {
    filename: 'synthetic.csv',
    account: raw.account,
    periodStart: '2025-02-01',
    periodEnd: '2025-02-28',
    transactions,
    warnings: [],
  }
}
export function csv(rows: RawTransaction[] = [raw]) {
  const quote = (v: string) => (/[;"\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v)
  return [
    'Umsatzanzeige;Datei erstellt am: 28.02.2025',
    'IBAN;' + raw.account,
    'Zeitraum;01.02.2025 - 28.02.2025',
    '',
    'Buchung;Wertstellungsdatum;Auftraggeber/Empfänger;Buchungstext;Verwendungszweck;Saldo;Währung;Betrag;Währung',
    ...rows.map((t) =>
      [
        t.bookingDate,
        t.valueDate,
        t.rawPayee,
        t.bookingText,
        t.purpose,
        t.rawBalance,
        t.balanceCurrency,
        t.rawAmount,
        t.currency,
      ]
        .map(quote)
        .join(';'),
    ),
  ].join('\n')
}
export function snapshot(): Snapshot {
  return {
    spreadsheetId: 'test-sheet',
    title: 'Synthetic',
    ids: { Transactions: 0, Rules: 1, Imports: 2, Meta: 3 },
    transactions: [],
    receipts: [],
    rules: pack,
    transactionRows: 1,
    receiptRows: 1,
    ruleRows: 3,
  }
}
