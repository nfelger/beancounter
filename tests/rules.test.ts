import { describe, it, expect } from 'vitest'
import { asciiUpper, createClassifier, transactionKey, validateRulePack } from '../src/domain/rules'
import { raw, pack } from './fixtures'
describe('private declarative rules', () => {
  it('normalizes accents, case, whitespace and sharp s', () =>
    expect(asciiUpper('  Grüßé\u00a0  café ')).toBe('GRUSSE CAFE'))
  it('uses full matching, not substring matching', () => {
    const classify = createClassifier(pack)
    expect(classify(raw).payee).toBe('Moonbean')
    expect(classify({ ...raw, rawPayee: 'CARD MOONBEAN SHOP EXTRA' }).confidence).toBe('low')
  })
  it('takes the first matching enabled rule', () => {
    const changed = structuredClone(pack)
    changed.rules.unshift({ ...changed.rules[0]!, id: 'first', payee: 'First' })
    expect(createClassifier(changed)(raw).payee).toBe('First')
    changed.rules[0]!.enabled = false
    expect(createClassifier(changed)(raw).payee).toBe('Moonbean')
  })
  it('supports context and exact exclusions without matching people by name', () => {
    const changed = structuredClone(pack)
    changed.rules.unshift({
      id: 'exclude',
      enabled: true,
      conditions: [{ field: 'key', op: 'eq', value: transactionKey(raw) }],
      exclude: true,
      confidence: 'high',
    })
    expect(createClassifier(changed)(raw).excluded).toBe(true)
    expect(createClassifier(changed)({ ...raw, rawAmount: '-12,35' }).excluded).toBe(false)
  })
  it('supports foreign context and terminal normalization', () => {
    const changed = structuredClone(pack)
    changed.normalizers.unshift({
      kind: 'terminal',
      full: true,
      pattern: 'CARD MOONBEAN SHOP',
      value: 'SPECIAL',
    })
    changed.rules.unshift({
      id: 'foreign',
      enabled: true,
      conditions: [{ field: 'foreign', op: 'eq', value: true }],
      category: 'Travel',
      useNormalized: true,
      confidence: 'high',
      exclude: false,
    })
    const classified = createClassifier(changed)({ ...raw, purpose: 'COUNTRY:FR' })
    expect(classified.category).toBe('Travel')
    expect(classified.payee).toBe('SPECIAL')
  })
  it('rejects malformed regex and categories without leaking rule values', () => {
    const changed = structuredClone(pack)
    changed.rules[0]!.conditions[0]!.value = '[secret'
    expect(() => validateRulePack(changed)).toThrow('ungültigen Ausdruck')
    try {
      validateRulePack(changed)
    } catch (e) {
      expect(String(e)).not.toContain('secret')
    }
  })
  it('keeps expression syntax as data; nothing is evaluated as code', () => {
    const changed = structuredClone(pack)
    changed.rules[0]!.conditions[0]!.value = 'globalThis.secret=true'
    expect(createClassifier(changed)(raw).confidence).toBe('low')
  })
})
