import type { ImportPreview, ParsedImport, Transaction, ImportReceipt } from './model'
import { parseGermanAmount, parseGermanDate } from './csv'
import { createClassifier, transactionKey, type RulePack } from './rules'

export async function digest(value: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('')
}
export async function prepareImport(
  source: ParsedImport,
  pack: RulePack,
  existing: Transaction[],
): Promise<ImportPreview> {
  const classify = createClassifier(pack)
  const known = new Set(existing.map((t) => t.id))
  const occurrences = new Map<string, number>()
  const all: Transaction[] = []
  const rulesDigest = await digest(JSON.stringify(pack))
  // An export identity is independent of filename, row order, balance, and rules.
  for (const raw of source.transactions) {
    const fingerprint = await digest(JSON.stringify([raw.account, transactionKey(raw)]))
    const occurrence = (occurrences.get(fingerprint) || 0) + 1
    occurrences.set(fingerprint, occurrence)
    const id = await digest(`${fingerprint}:${occurrence}`)
    all.push({
      id,
      fingerprint,
      occurrence,
      bookingDate: parseGermanDate(raw.bookingDate),
      amountMinor: parseGermanAmount(raw.rawAmount),
      raw: { ...raw },
      classification: classify(raw),
      manualPayee: '',
      manualCategory: '',
      importId: '',
    })
  }
  const id = await digest(
    JSON.stringify([
      source.account,
      source.periodStart,
      source.periodEnd,
      all.map((t) => t.id).sort(),
    ]),
  )
  all.forEach((t) => {
    t.importId = id
  })
  return {
    id,
    source,
    transactions: all.filter((t) => !known.has(t.id)),
    duplicates: all.filter((t) => known.has(t.id)).length,
    repeated: [...occurrences.values()].filter((count) => count > 1).length,
    rulesDigest,
  }
}
export function receiptFor(preview: ImportPreview): ImportReceipt {
  return {
    id: preview.id,
    importedAt: new Date().toISOString(),
    filename: preview.source.filename,
    account: preview.source.account,
    periodStart: preview.source.periodStart,
    periodEnd: preview.source.periodEnd,
    parsed: preview.source.transactions.length,
    added: preview.transactions.length,
    duplicates: preview.duplicates,
    excluded: preview.transactions.filter((t) => t.classification.excluded).length,
    rulesDigest: preview.rulesDigest,
  }
}
