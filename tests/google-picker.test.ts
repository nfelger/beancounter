import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { pickSpreadsheet } from '../src/services/google'

const config = { clientId: 'test-client', apiKey: 'test-key', projectNumber: '123' }
let callback: (data: google.picker.ResponseObject) => void
const dispose = vi.fn(),
  build = vi.fn(),
  setVisible = vi.fn(),
  setOAuthToken = vi.fn()
const load = vi.fn((_name: string, options: { callback: () => void }) => options.callback())
const result = (action: string, id?: string) =>
  ({ action, docs: id ? [{ id }] : [] }) as google.picker.ResponseObject
beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  load.mockImplementation((_name, options) => options.callback())
  build.mockImplementation(() => ({ dispose, setVisible }))
  vi.stubGlobal('window', {
    location: { origin: 'https://example.invalid' },
    gapi: { load },
    google: {
      picker: {
        Action: { PICKED: 'picked', CANCEL: 'cancel', ERROR: 'error' },
        ViewId: { SPREADSHEETS: 'spreadsheets' },
        PickerBuilder: class {
          addView() {
            return this
          }
          setOAuthToken(token: string) {
            setOAuthToken(token)
            return this
          }
          setDeveloperKey() {
            return this
          }
          setAppId() {
            return this
          }
          setOrigin() {
            return this
          }
          setCallback(cb: typeof callback) {
            callback = cb
            return this
          }
          build() {
            return build()
          }
        },
      },
    },
  })
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
describe('Google Picker lifecycle', () => {
  it.each(['picked', 'cancel'])('disposes after %s and ignores late events', async (action) => {
    const pending = pickSpreadsheet(() => 'synthetic-token', config)
    await vi.advanceTimersByTimeAsync(0)
    expect(setOAuthToken).toHaveBeenCalledWith('synthetic-token')
    expect(setVisible).toHaveBeenCalledWith(true)
    callback(result(action, 'test-sheet'))
    expect(await pending).toBe(action === 'picked' ? 'test-sheet' : null)
    callback(result('picked', 'another-sheet'))
    expect(dispose).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })
  it('rejects SDK errors without exposing their contents', async () => {
    const pending = pickSpreadsheet(() => 'synthetic-token', config)
    await vi.advanceTimersByTimeAsync(0)
    callback(result('error', 'private-error-detail'))
    await expect(pending).rejects.toThrow('Dateiauswahl fehlgeschlagen.')
    expect(dispose).toHaveBeenCalledOnce()
  })
  it('does not build a late dialog after cancellation during initialization', async () => {
    let complete!: () => void
    load.mockImplementation((_name, options) => {
      complete = options.callback
    })
    const controller = new AbortController()
    const pending = pickSpreadsheet(() => 'synthetic-token', config, controller.signal)
    await vi.advanceTimersByTimeAsync(0)
    controller.abort()
    await expect(pending).rejects.toThrow('abgebrochen')
    complete()
    await vi.advanceTimersByTimeAsync(0)
    expect(build).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
  it('disposes an open dialog when the session expires or app unmounts', async () => {
    const controller = new AbortController()
    const pending = pickSpreadsheet(() => 'synthetic-token', config, controller.signal)
    await vi.advanceTimersByTimeAsync(0)
    controller.abort()
    await expect(pending).rejects.toThrow('abgebrochen')
    expect(dispose).toHaveBeenCalledOnce()
  })
  it('bounds stalled module loading and permits a fresh attempt', async () => {
    load.mockImplementationOnce(() => {})
    const pending = pickSpreadsheet(() => 'synthetic-token', config)
    const rejected = expect(pending).rejects.toThrow('fehlgeschlagen')
    await vi.advanceTimersByTimeAsync(15_000)
    await rejected
    const retry = pickSpreadsheet(() => 'synthetic-token', config)
    await vi.advanceTimersByTimeAsync(0)
    callback(result('cancel'))
    expect(await retry).toBeNull()
  })
  it('disposes a dialog that never returns a result', async () => {
    const pending = pickSpreadsheet(() => 'synthetic-token', config)
    const rejected = expect(pending).rejects.toThrow('zu lange')
    await vi.advanceTimersByTimeAsync(120_000)
    await rejected
    expect(dispose).toHaveBeenCalledOnce()
  })
  it('rechecks the token after loading before opening the picker', async () => {
    const getToken = vi.fn().mockReturnValueOnce('synthetic-token').mockReturnValue('')
    await expect(pickSpreadsheet(getToken, config)).rejects.toThrow('abgebrochen')
    expect(build).not.toHaveBeenCalled()
  })
})
