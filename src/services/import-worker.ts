import type { ImportPreview, Transaction } from '../domain/model'
import type { RulePack } from '../domain/rules'
import type { AssignmentRuleResult } from './assignment-rules'
import type { Cell } from './sheets'

function runWorker<T>(message: unknown, transfer: Transferable[] = []): Promise<T> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../domain/worker.ts', import.meta.url), { type: 'module' })
    const stop = () => {
      clearTimeout(timeout)
      worker.terminate()
    }
    const timeout = setTimeout(() => {
      worker.terminate()
      reject(new Error('Verarbeitung abgebrochen. Bitte Dateigröße und Regex-Regeln prüfen.'))
    }, 20000)
    worker.onmessage = (event: MessageEvent<{ result?: T; error?: string }>) => {
      stop()
      if (event.data.result) resolve(event.data.result)
      else reject(new Error(event.data.error || 'Verarbeitung fehlgeschlagen.'))
    }
    worker.onerror = () => {
      stop()
      reject(new Error('Verarbeitung fehlgeschlagen. Bitte Datei und Regeln prüfen.'))
    }
    worker.postMessage(message, transfer)
  })
}
export async function processFile(
  file: File,
  pack: RulePack,
  existing: Transaction[],
): Promise<ImportPreview> {
  if (file.size > 10_000_000)
    throw new Error('Datei zu groß. Bitte einen Export unter 10 MB wählen.')
  const bytes = await file.arrayBuffer()
  return runWorker(
    {
      kind: 'import',
      bytes,
      filename: file.name,
      pack: JSON.parse(JSON.stringify(pack)),
      existing: JSON.parse(JSON.stringify(existing)),
    },
    [bytes],
  )
}
export function processAssignmentRule(
  cells: Cell[][],
  transaction: Transaction,
  payee: string,
  category: string,
): Promise<AssignmentRuleResult> {
  return runWorker(
    JSON.parse(JSON.stringify({ kind: 'assignment', cells, transaction, payee, category })),
  )
}
