import { expect, it } from 'vitest'
import { amazonContext, isAmazon, parseAmazon } from '../src/domain/amazon'
import { prepareImport } from '../src/domain/import'
import { pack, raw, source } from './fixtures'

// Entirely invented purchase data.
const orders = [
  {
    orderId: '999-0000000-0000001',
    items: [
      { name: 'Imaginary moon lamp', context: 'Opaque context, left unchanged' },
      { name: 'Fictional notebook', context: '<b>literal text</b>' },
    ],
  },
  { orderId: 'D99-0000000-0000002', items: [{ name: 'Invented book', context: '' }] },
]
async function tx(purpose = '', rawPayee = 'AMAZON EU') {
  return (await prepareImport(source([{ ...raw, rawPayee, purpose }]), pack, [])).transactions[0]!
}
it('uses only a complete literal order ID and retains every item without changing a transaction', async () => {
  const t = await tx('REFERENCE 999-0000000-0000001 END')
  const before = structuredClone(t)
  expect(amazonContext(t, parseAmazon(JSON.stringify({ orders })))).toEqual({
    exact: true,
    orders: [orders[0]],
  })
  expect(t).toEqual(before)
})
it('does not infer matches from prose or partial order IDs', async () => {
  for (const purpose of [
    '999-0000000-00000010',
    'X999-0000000-0000001',
    'Opaque context, left unchanged',
    '',
  ]) {
    expect(amazonContext(await tx(purpose), orders)).toEqual({ exact: false, orders })
  }
})
it('ignores unrelated merchants and recognizes raw Amazon fields after classification edits', async () => {
  expect(isAmazon(await tx('', 'AMZN Mktp DE'))).toBe(true)
  expect(amazonContext(await tx('', 'Example Store'), orders)).toBeUndefined()
  const t = await tx()
  t.classification.payee = 'Manually renamed'
  expect(isAmazon(t)).toBe(true)
  expect(amazonContext(t, [])).toBeUndefined()
})
it.each([
  '{',
  '{"orders":{}}',
  '{"orders":[{"orderId":"x","items":[{"name":"private"}]}]}',
  'x'.repeat(2_000_001),
])('rejects invalid optional data with a generic error', (input) => {
  expect(() => parseAmazon(input)).toThrow('Der CSV-Import bleibt möglich')
})
it('supports empty data and multiple exact IDs without selecting one arbitrarily', async () => {
  expect(parseAmazon('{"orders":[]}')).toEqual([])
  expect(amazonContext(await tx(orders.map((o) => o.orderId).join(' ')), orders)).toEqual({
    exact: true,
    orders,
  })
})
