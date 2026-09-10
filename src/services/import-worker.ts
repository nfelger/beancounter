import type { ImportPreview, Transaction } from '../domain/model'
import type { RulePack } from '../domain/rules'

export async function processFile(
  file: File,
  pack: RulePack,
  existing: Transaction[],
): Promise<ImportPreview> {
  if (file.size > 10_000_000)
    throw new Error('Datei zu groß. Bitte einen Export unter 10 MB wählen.')
  const bytes = await file.arrayBuffer()
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
    worker.onmessage = (event: MessageEvent<{ preview?: ImportPreview; error?: string }>) => {
      stop()
      if (event.data.preview) resolve(event.data.preview)
      else reject(new Error(event.data.error || 'Verarbeitung fehlgeschlagen.'))
    }
    worker.onerror = () => {
      stop()
      reject(new Error('Verarbeitung fehlgeschlagen. Bitte Datei und Regeln prüfen.'))
    }
    worker.postMessage(
      {
        bytes,
        filename: file.name,
        pack: JSON.parse(JSON.stringify(pack)),
        existing: JSON.parse(JSON.stringify(existing)),
      },
      [bytes],
    )
  })
}
