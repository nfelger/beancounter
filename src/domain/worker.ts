import { decodeCsv, parseIngCsv } from './csv'
import { prepareImport } from './import'
import { validateRulePack, type RulePack } from './rules'
import type { Transaction } from './model'

self.onmessage = async (
  event: MessageEvent<{
    bytes: ArrayBuffer
    filename: string
    pack: RulePack
    existing: Transaction[]
  }>,
) => {
  try {
    const { bytes, filename, pack, existing } = event.data
    const source = parseIngCsv(decodeCsv(bytes), filename)
    const preview = await prepareImport(source, validateRulePack(pack), existing)
    self.postMessage({ preview })
  } catch (e) {
    self.postMessage({
      error: e instanceof Error ? e.message : 'Die Datei konnte nicht verarbeitet werden.',
    })
  }
}
