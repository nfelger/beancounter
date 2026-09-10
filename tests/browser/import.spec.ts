import { test, expect, type Page } from '@playwright/test'
import { csv, pack } from '../fixtures'
import {
  TX_HEADERS,
  RULE_HEADERS,
  IMPORT_HEADERS,
  META_HEADERS,
  ruleRows,
} from '../../src/services/sheets'

async function mockGoogle(page: Page, loseResponse = false) {
  const rows: unknown[][][] = [
    [TX_HEADERS],
    [RULE_HEADERS, ...ruleRows(pack)],
    [IMPORT_HEADERS],
    [META_HEADERS, ['schema_version', '2']],
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
      body: 'window.google={accounts:{oauth2:{initTokenClient:({callback})=>({requestAccessToken:()=>callback({access_token:"test-token",expires_in:3600})})}}}',
    }),
  )
  await page.route('https://sheets.googleapis.com/**', async (route) => {
    const url = route.request().url()
    if (route.request().method() === 'POST') {
      writes++
      const { requests } = route.request().postDataJSON()
      for (const { updateCells } of requests) {
        const { sheetId, rowIndex } = updateCells.start
        updateCells.rows.forEach(
          (r: { values: { userEnteredValue: Record<string, unknown> }[] }, i: number) => {
            rows[sheetId]![rowIndex + i] = r.values.map((c) => Object.values(c.userEnteredValue)[0])
          },
        )
      }
      if (loseResponse && writes === 1) {
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
  return { getWrites: () => writes }
}
async function openAndUpload(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Mit Google verbinden' }).click()
  const input = page.locator('input[type=file][accept=".csv,text/csv"]')
  await expect(input).toBeEnabled()
  await input.setInputFiles({
    name: 'synthetic.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv()),
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
