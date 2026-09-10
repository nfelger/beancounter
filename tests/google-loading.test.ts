import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let tags: {
  onload: (() => void) | null
  onerror: (() => void) | null
  remove: ReturnType<typeof vi.fn>
}[]
let loadGoogle: typeof import('../src/services/google').loadGoogle
function ready() {
  vi.stubGlobal('window', { google: { accounts: { oauth2: { initTokenClient: vi.fn() } } } })
}
beforeEach(async () => {
  vi.useFakeTimers()
  vi.resetModules()
  tags = []
  vi.stubGlobal('window', {})
  vi.stubGlobal('document', {
    createElement: () => ({ onload: null, onerror: null, remove: vi.fn() }),
    head: { append: (tag: (typeof tags)[number]) => tags.push(tag) },
  })
  ;({ loadGoogle } = await import('../src/services/google'))
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
describe('Google SDK loading', () => {
  it('shares an in-flight load and reuses an already initialized SDK', async () => {
    const pending = loadGoogle()
    expect(loadGoogle()).toBe(pending)
    ready()
    tags[0]!.onload!()
    await pending
    await loadGoogle()
    expect(tags).toHaveLength(1)
    expect(vi.getTimerCount()).toBe(0)
  })
  it.each(['error', 'timeout', 'missing API'])(
    'allows retry after %s and ignores stale events',
    async (failure) => {
      const pending = loadGoogle()
      const rejected = expect(pending).rejects.toThrow('erneut versuchen')
      const staleLoad = tags[0]!.onload!
      if (failure === 'error') tags[0]!.onerror!()
      else if (failure === 'timeout') vi.advanceTimersByTime(15_000)
      else tags[0]!.onload!()
      await rejected
      expect(tags[0]!.remove).toHaveBeenCalledOnce()
      const retry = loadGoogle()
      expect(tags).toHaveLength(2)
      staleLoad()
      ready()
      tags[1]!.onload!()
      await retry
      expect(vi.getTimerCount()).toBe(0)
    },
  )
})
