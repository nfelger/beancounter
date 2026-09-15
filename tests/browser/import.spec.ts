import { test, expect, type Page } from '@playwright/test'
import { csv, pack, raw } from '../fixtures'
import {
  TX_HEADERS,
  RULE_HEADERS,
  IMPORT_HEADERS,
  META_HEADERS,
  ruleRows,
} from '../../src/services/sheets'

async function mockGoogle(page: Page, loseResponse = false, loseAt = 1) {
  const rows: unknown[][][] = [
    [TX_HEADERS],
    [RULE_HEADERS, ...ruleRows(pack)],
    [IMPORT_HEADERS],
    [META_HEADERS, ['schema_version', '4']],
  ]
  let writes = 0
  await page.addInitScript(() => {
    localStorage.setItem(
      'beancounter.config.v1',
      JSON.stringify({ clientId: 'synthetic-client', apiKey: '', projectNumber: '' }),
    )
    localStorage.setItem('beancounter.sheet.v1', 'test-sheet')
  })
  await page.route('https://accounts.google.com/gsi/client', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: 'window.google={accounts:{oauth2:{hasGrantedAllScopes:()=>true,initTokenClient:({callback})=>({requestAccessToken:()=>callback({access_token:"test-token",expires_in:3600})})}}}',
    }),
  )
  await page.route('https://sheets.googleapis.com/**', async (route) => {
    const url = route.request().url()
    if (route.request().method() === 'POST') {
      writes++
      const { requests } = route.request().postDataJSON()
      for (const { updateCells } of requests) {
        if (!updateCells?.fields.includes('userEnteredValue')) continue
        const start = updateCells.start ?? {
          sheetId: updateCells.range.sheetId,
          rowIndex: updateCells.range.startRowIndex,
          columnIndex: updateCells.range.startColumnIndex,
        }
        const { sheetId, rowIndex, columnIndex = 0 } = start
        if (updateCells.range) {
          for (let i = rowIndex; i < updateCells.range.endRowIndex; i++) {
            rows[sheetId]![i] ??= []
            for (let c = columnIndex; c < updateCells.range.endColumnIndex; c++)
              rows[sheetId]![i]![c] = ''
          }
        }
        updateCells.rows.forEach(
          (r: { values: { userEnteredValue: Record<string, unknown> }[] }, i: number) => {
            rows[sheetId]![rowIndex + i] ??= []
            r.values.forEach((cell, c) => {
              rows[sheetId]![rowIndex + i]![columnIndex + c] = Object.values(
                cell.userEnteredValue,
              )[0]
            })
          },
        )
      }
      if (loseResponse && writes === loseAt) {
        await route.abort('failed')
        return
      }
      await route.fulfill({ json: {} })
      return
    }
    if (url.includes('values:batchGet')) {
      await route.fulfill({ json: { valueRanges: rows.map((values) => ({ values })) } })
      return
    }
    await route.fulfill({
      json: {
        properties: { title: 'Synthetic household' },
        sheets: ['Transactions', 'Rules', 'Imports', 'Meta'].map((title, sheetId) => ({
          properties: { title, sheetId },
        })),
      },
    })
  })
  return { getWrites: () => writes, rows }
}
async function openAndUpload(page: Page, data = csv()) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Mit Google verbinden' }).click()
  const input = page.locator('input[type=file][accept=".csv,text/csv"]')
  await expect(input).toBeEnabled()
  await input.setInputFiles({
    name: 'synthetic.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(data),
  })
  await expect(page.getByRole('button', { name: 'Import bestätigen' })).toBeEnabled()
}
test('mobile import, duplicate reimport, and private data rendering', async ({ page }) => {
  const mock = await mockGoogle(page)
  await openAndUpload(page)
  await expect(page.getByText('Moonbean', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Import bestätigen' }).click()
  await expect(page.getByRole('status')).toContainText('1 Buchungen gespeichert')
  await page
    .locator('input[type=file][accept=".csv,text/csv"]')
    .setInputFiles({ name: 'again.csv', mimeType: 'text/csv', buffer: Buffer.from(csv()) })
  await page.getByRole('button', { name: 'Import bestätigen' }).click()
  await expect(page.getByRole('status')).toContainText('bereits importiert')
  expect(mock.getWrites()).toBe(1)
})
test('lost response survives reload and reconciles without a second write', async ({ page }) => {
  const mock = await mockGoogle(page, true)
  await openAndUpload(page)
  await page.getByRole('button', { name: 'Import bestätigen' }).click()
  await expect(page.getByRole('heading', { name: 'Speicherung bestätigen' })).toBeVisible()
  await page.reload()
  await page.getByRole('button', { name: 'Mit Google verbinden' }).click()
  await page.getByRole('button', { name: 'Status prüfen und fortsetzen' }).click()
  await expect(page.getByRole('status')).toContainText('1 Buchungen gespeichert')
  expect(mock.getWrites()).toBe(1)
  expect(await page.evaluate(() => sessionStorage.getItem('beancounter.pending.v1'))).toBeNull()
})

async function editAssignment(
  page: Page,
  index: number,
  payee: string,
  category: string,
  rule = false,
) {
  const transaction = page.locator('article.transaction').nth(index)
  await transaction.getByRole('button', { name: 'Zuordnung ändern', exact: true }).click()
  await transaction.getByLabel('Empfänger', { exact: true }).fill(payee)
  await transaction.getByLabel('Kategorie', { exact: true }).selectOption(category)
  await transaction
    .locator('form')
    .getByRole('button', {
      name: rule ? 'Ändern & Regel erstellen' : 'Zuordnung ändern',
      exact: true,
    })
    .click()
  await expect(transaction.locator('form')).toHaveCount(0)
}
test('preview rule propagation protects manual edits and is discarded without a write', async ({
  page,
}) => {
  const mock = await mockGoogle(page)
  await openAndUpload(page, csv([raw, { ...raw, purpose: 'SECOND' }, { ...raw, purpose: 'THIRD' }]))
  await editAssignment(page, 1, 'Manual', 'Other')
  await editAssignment(page, 0, 'Shared', 'Travel', true)
  await expect(page.locator('article.transaction').nth(0)).toContainText('Shared')
  await expect(page.locator('article.transaction').nth(1)).toContainText('Manual')
  await expect(page.locator('article.transaction').nth(2)).toContainText('Shared')
  await expect(page.getByText('1 Regel(n) vorgemerkt', { exact: false })).toBeVisible()
  await editAssignment(page, 0, 'Revised', 'Food', true)
  await expect(page.locator('article.transaction').nth(1)).toContainText('Manual')
  await expect(page.locator('article.transaction').nth(2)).toContainText('Revised')
  expect(mock.getWrites()).toBe(0)
  await page.getByRole('button', { name: 'Import verwerfen' }).click()
  await expect(page.locator('article.transaction')).toHaveCount(0)
  expect(mock.getWrites()).toBe(0)
  expect(mock.rows[1]!.filter((r) => r[0] === 'simple_rule')).toHaveLength(0)
})
test('staged rule and import survive a lost response and apply on the next import', async ({
  page,
}) => {
  const mock = await mockGoogle(page, true)
  await openAndUpload(page)
  await editAssignment(page, 0, 'Future', 'Travel', true)
  expect(mock.getWrites()).toBe(0)
  await page.getByRole('button', { name: 'Import bestätigen' }).click()
  await expect(page.getByRole('heading', { name: 'Speicherung bestätigen' })).toBeVisible()
  await page.reload()
  await page.getByRole('button', { name: 'Mit Google verbinden' }).click()
  await page.getByRole('button', { name: 'Status prüfen und fortsetzen' }).click()
  await expect(page.getByRole('status')).toContainText('1 Buchungen gespeichert')
  expect(mock.getWrites()).toBe(1)
  expect(mock.rows[1]!.filter((r) => r[0] === 'simple_rule')).toHaveLength(1)
  await page.locator('input[type=file][accept=".csv,text/csv"]').setInputFiles({
    name: 'next.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv([{ ...raw, purpose: 'NEW TRANSACTION' }])),
  })
  await expect(page.locator('article.transaction')).toContainText('Future')
  await expect(page.locator('article.transaction')).toContainText('Travel')
})
test('historical rule creation changes only the selected transaction and recovers without duplication', async ({
  page,
}) => {
  const mock = await mockGoogle(page, true, 2)
  await openAndUpload(page, csv([raw, { ...raw, purpose: 'SECOND' }]))
  await page.getByRole('button', { name: 'Import bestätigen' }).click()
  await expect(page.getByRole('status')).toContainText('2 Buchungen gespeichert')
  await page.getByRole('button', { name: 'Buchungen', exact: true }).click()
  const transaction = page.locator('article.transaction').first()
  await transaction.getByRole('button', { name: 'Zuordnung ändern', exact: true }).click()
  await transaction.getByLabel('Empfänger', { exact: true }).fill('Historical')
  await transaction.getByLabel('Kategorie', { exact: true }).selectOption('Travel')
  await transaction.getByRole('button', { name: 'Ändern & Regel erstellen', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Speicherung bestätigen' })).toBeVisible()
  await page.reload()
  await page.getByRole('button', { name: 'Mit Google verbinden' }).click()
  await page.getByRole('button', { name: 'Status prüfen und fortsetzen' }).click()
  await expect(page.getByRole('status')).toContainText('Zuordnung und Regel gespeichert')
  expect(mock.getWrites()).toBe(2)
  expect(mock.rows[0]![1]![8]).toBe('Historical')
  expect(mock.rows[0]![2]![8]).toBe('Moonbean')
  expect(mock.rows[1]!.filter((r) => r[0] === 'simple_rule')).toHaveLength(1)
})
