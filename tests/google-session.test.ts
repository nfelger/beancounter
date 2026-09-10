import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createGoogleSession, DRIVE_SCOPE } from '../src/services/google-session'
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
