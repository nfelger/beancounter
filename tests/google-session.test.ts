import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createGoogleSession, DRIVE_SCOPE, SESSION_KEY } from '../src/services/google-session'
import { loadGoogle } from '../src/services/google'

vi.mock('../src/services/google', () => ({ loadGoogle: vi.fn() }))
let session: ReturnType<typeof createGoogleSession>
let options: google.accounts.oauth2.TokenClientConfig
const requestAccessToken = vi.fn()
const response = (changes: Partial<google.accounts.oauth2.TokenResponse> = {}) =>
  ({
    access_token: 'synthetic-token',
    expires_in: '3600',
    scope: DRIVE_SCOPE,
    token_type: 'Bearer',
    ...changes,
  }) as google.accounts.oauth2.TokenResponse
beforeEach(async () => {
  vi.useFakeTimers()
  const values = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value)
    }),
    removeItem: vi.fn((key: string) => {
      values.delete(key)
    }),
  })
  vi.mocked(loadGoogle).mockResolvedValue()
  requestAccessToken.mockReset()
  vi.stubGlobal('window', {
    google: {
      accounts: {
        oauth2: {
          initTokenClient: (config: google.accounts.oauth2.TokenClientConfig) => {
            options = config
            return { requestAccessToken }
          },
          hasGrantedAllScopes: (r: google.accounts.oauth2.TokenResponse, scope: string) =>
            r.scope.split(' ').includes(scope),
        },
      },
    },
  })
  session = createGoogleSession()
  await session.prepare()
})
afterEach(() => {
  session.disconnect()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
describe('Google session', () => {
  it('releases a stalled authorization and ignores its late token', async () => {
    const pending = session.authorize('test-client')
    const rejected = expect(pending).rejects.toThrow('zu lange')
    const oldCallback = options.callback
    vi.advanceTimersByTime(120_000)
    await rejected
    expect(session.status.value).toBe('disconnected')
    oldCallback(response())
    expect(session.getToken()).toBe('')
    const retry = session.authorize('test-client')
    options.callback(response())
    await retry
  })
  it('resets readiness after a load failure so preparation can be retried', async () => {
    session = createGoogleSession()
    vi.mocked(loadGoogle).mockRejectedValueOnce(new Error('load failed'))
    const first = session.prepare()
    expect(session.prepare()).toBe(first)
    await expect(first).rejects.toThrow('load failed')
    expect(session.loading.value).toBe(false)
    expect(session.ready.value).toBe(false)
    await session.prepare()
    expect(session.ready.value).toBe(true)
  })
  it('opens the SDK popup synchronously and expires UI and request access together', async () => {
    const pending = session.authorize('test-client')
    expect(requestAccessToken).toHaveBeenCalledOnce()
    expect(options.scope).toBe(DRIVE_SCOPE)
    options.callback(response())
    await pending
    expect(session.connected.value).toBe(true)
    expect(session.getToken()).toBe('synthetic-token')
    vi.advanceTimersByTime(3_570_000)
    expect(session.connected.value).toBe(false)
    expect(session.status.value).toBe('expired')
    expect(session.getToken()).toBe('')
  })
  it('checks wall-clock expiry even when background timers did not fire', async () => {
    const pending = session.authorize('test-client')
    options.callback(response())
    await pending
    vi.setSystemTime(Date.now() + 3_600_000)
    expect(session.getToken()).toBe('')
    expect(session.connected.value).toBe(false)
  })
  it.each([
    { error: 'access_denied' },
    { scope: 'openid' },
    { access_token: '' },
    { expires_in: 'invalid' },
    { expires_in: '0' },
  ])('rejects an unusable grant without retaining its token: %j', async (changes) => {
    const pending = session.authorize('test-client')
    options.callback(response(changes))
    await expect(pending).rejects.toThrow()
    expect(session.getToken()).toBe('')
    expect(session.connected.value).toBe(false)
  })
  it('handles blocked or closed popups and allows another attempt', async () => {
    const pending = session.authorize('test-client')
    options.error_callback!({ type: 'popup_closed', name: 'PopupError', message: 'Closed' })
    await expect(pending).rejects.toThrow('Popup')
    const retry = session.authorize('test-client')
    options.callback(response())
    await retry
    expect(session.connected.value).toBe(true)
  })
  it('ignores late callbacks after disconnect and prevents overlapping authorization', async () => {
    const pending = session.authorize('test-client')
    const oldCallback = options.callback
    await expect(session.authorize('test-client')).rejects.toThrow('bereits')
    session.disconnect()
    await expect(pending).rejects.toThrow('abgebrochen')
    const retry = session.authorize('test-client')
    oldCallback(response())
    expect(session.getToken()).toBe('')
    options.callback(response({ access_token: 'new-synthetic-token' }))
    await retry
    session.invalidate()
    expect(session.getToken()).toBe('')
    expect(session.status.value).toBe('expired')
  })
})

describe('remembered Google connection', () => {
  async function connect() {
    const pending = session.authorize('test-client')
    options.callback(response())
    await pending
  }
  it('survives page teardown and restores without a popup or extending expiry', async () => {
    await connect()
    const saved = localStorage.getItem(SESSION_KEY)
    session.dispose()
    vi.advanceTimersByTime(60_000)
    session = createGoogleSession()
    expect(session.restore('test-client')).toBe(true)
    expect(session.getToken()).toBe('synthetic-token')
    expect(requestAccessToken).toHaveBeenCalledOnce()
    expect(localStorage.getItem(SESSION_KEY)).toBe(saved)
    vi.advanceTimersByTime(3_510_000)
    expect(session.status.value).toBe('expired')
    expect(localStorage.getItem(SESSION_KEY)).toBeNull()
  })
  it.each(['malformed', 'expired', 'wrong-client', 'wrong-scope'])(
    'discards a %s saved connection',
    async (kind) => {
      await connect()
      session.dispose()
      const saved = JSON.parse(localStorage.getItem(SESSION_KEY)!)
      if (kind === 'expired') saved.expiresAt = Date.now() - 1
      if (kind === 'wrong-client') saved.clientId = 'other-client'
      if (kind === 'wrong-scope') saved.scope = 'openid'
      localStorage.setItem(SESSION_KEY, kind === 'malformed' ? '{' : JSON.stringify(saved))
      expect(session.restore('test-client')).toBe(false)
      expect(session.getToken()).toBe('')
      expect(localStorage.getItem(SESSION_KEY)).toBeNull()
    },
  )
  it.each(['disconnect', 'invalidate'] as const)(
    'clears persisted access on %s',
    async (method) => {
      await connect()
      session[method]()
      expect(localStorage.getItem(SESSION_KEY)).toBeNull()
      expect(session.getToken()).toBe('')
    },
  )
  it('disconnects on another tab changing or clearing the saved connection', async () => {
    await connect()
    session.onStorage({ key: 'unrelated' } as StorageEvent)
    expect(session.connected.value).toBe(true)
    localStorage.removeItem(SESSION_KEY)
    session.onStorage({ key: SESSION_KEY } as StorageEvent)
    expect(session.connected.value).toBe(false)
    await connect()
    session.onStorage({ key: null } as StorageEvent)
    expect(session.connected.value).toBe(false)
  })
  it('does not erase a newer grant when an older tab expires', async () => {
    await connect()
    const saved = JSON.parse(localStorage.getItem(SESSION_KEY)!)
    localStorage.setItem(SESSION_KEY, JSON.stringify({ ...saved, token: 'new-synthetic-token' }))
    vi.advanceTimersByTime(3_570_000)
    expect(JSON.parse(localStorage.getItem(SESSION_KEY)!).token).toBe('new-synthetic-token')
    expect(session.connected.value).toBe(false)
  })
  it('keeps authorization usable when browser storage is blocked', async () => {
    vi.mocked(localStorage.getItem).mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.mocked(localStorage.setItem).mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.mocked(localStorage.removeItem).mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(session.restore('test-client')).toBe(false)
    await connect()
    expect(session.getToken()).toBe('synthetic-token')
    session.disconnect()
    expect(session.getToken()).toBe('')
  })
})
