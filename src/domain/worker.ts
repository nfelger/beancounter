import { decodeCsv, parseIngCsv } from './csv'
import { prepareImport } from './import'
import { validateRulePack, type RulePack } from './rules'
import type { Transaction } from './model'
import { buildAssignmentRule } from '../services/assignment-rules'
import type { Cell } from '../services/sheets'

type Task =
  | {
      kind: 'import'
      bytes: ArrayBuffer
      filename: string
      pack: RulePack
      existing: Transaction[]
    }
  | {
      kind: 'assignment'
      cells: Cell[][]
      transaction: Transaction
      payee: string
      category: string
    }
self.onmessage = async (event: MessageEvent<Task>) => {
  try {
    const task = event.data
    const result =
      task.kind === 'assignment'
        ? buildAssignmentRule(task.cells, task.transaction, task.payee, task.category)
        : await prepareImport(
            parseIngCsv(decodeCsv(task.bytes), task.filename),
            validateRulePack(task.pack),
            task.existing,
          )
    self.postMessage({ result })
  } catch (e) {
    self.postMessage({
      error: e instanceof Error ? e.message : 'Die Daten konnten nicht verarbeitet werden.',
    })
  }
}
