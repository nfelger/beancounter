export interface GoogleConfig {
  clientId: string
  apiKey: string
  projectNumber: string
}
const LOAD_TIMEOUT_MS = 15_000
const loaded = new Map<string, Promise<void>>()
function script(url: string, isReady: () => boolean): Promise<void> {
  if (isReady()) return Promise.resolve()
  const existing = loaded.get(url)
  if (existing) return existing
  const promise = new Promise<void>((resolve, reject) => {
    const tag = document.createElement('script')
    let settled = false
    const finish = (success: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      tag.onload = tag.onerror = null
      if (success) resolve()
      else {
        tag.remove()
        reject(new Error('Google konnte nicht geladen werden. Bitte erneut versuchen.'))
      }
    }
    const timer = setTimeout(() => finish(false), LOAD_TIMEOUT_MS)
    tag.src = url
    tag.async = true
    tag.onload = () => finish(isReady())
    tag.onerror = () => finish(false)
    try {
      document.head.append(tag)
    } catch {
      finish(false)
    }
  }).catch((error) => {
    loaded.delete(url)
    throw error
  })
  loaded.set(url, promise)
  return promise
}
export const loadGoogle = () =>
  script(
    'https://accounts.google.com/gsi/client',
    () => typeof window.google?.accounts?.oauth2?.initTokenClient === 'function',
  )
async function loadPicker() {
  await script('https://apis.google.com/js/api.js', () => typeof window.gapi?.load === 'function')
  await new Promise<void>((resolve, reject) => {
    let settled = false
    const finish = (success: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (success) resolve()
      else reject(new Error('Dateiauswahl konnte nicht geladen werden. Bitte erneut versuchen.'))
    }
    const timer = setTimeout(() => finish(false), LOAD_TIMEOUT_MS)
    try {
      window.gapi.load('picker', {
        callback: () => finish(typeof window.google?.picker?.PickerBuilder === 'function'),
        onerror: () => finish(false),
        timeout: LOAD_TIMEOUT_MS,
        ontimeout: () => finish(false),
      })
    } catch {
      finish(false)
    }
  })
}
export async function pickSpreadsheet(
  getToken: () => string,
  config: GoogleConfig,
  signal?: AbortSignal,
): Promise<string | null> {
  if (!getToken()) throw new Error('Google-Verbindung abgelaufen. Bitte erneut verbinden.')
  if (!config.apiKey || !config.projectNumber)
    throw new Error('Für die Dateiauswahl fehlen API-Key oder Projektnummer in den Einstellungen.')
  return new Promise((resolve, reject) => {
    let picker: google.picker.Picker | undefined
    let settled = false
    const finish = (id: string | null, error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      try {
        picker?.dispose()
      } finally {
        if (error) reject(error)
        else resolve(id)
      }
    }
    const abort = () =>
      finish(null, new Error('Dateiauswahl abgebrochen. Bitte bei Bedarf erneut öffnen.'))
    const fail = () =>
      finish(null, new Error('Dateiauswahl fehlgeschlagen. Bitte erneut versuchen.'))
    const timer = setTimeout(
      () => finish(null, new Error('Dateiauswahl hat zu lange gedauert. Bitte erneut öffnen.')),
      120_000,
    )
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) {
      abort()
      return
    }
    void loadPicker()
      .then(() => {
        if (settled) return
        const token = getToken()
        if (!token) {
          abort()
          return
        }
        const sdk = window.google.picker
        picker = new sdk.PickerBuilder()
          .addView(sdk.ViewId.SPREADSHEETS)
          .setOAuthToken(token)
          .setDeveloperKey(config.apiKey)
          .setAppId(config.projectNumber)
          .setOrigin(window.location.origin)
          .setCallback((data) => {
            if (data.action === sdk.Action.PICKED) {
              const id = data.docs?.[0]?.id
              if (id && /^[\w-]+$/.test(id)) finish(id)
              else fail()
            }
            if (data.action === sdk.Action.CANCEL) finish(null)
            if (data.action === sdk.Action.ERROR) fail()
          })
          .build()
        picker.setVisible(true)
      })
      .catch(fail)
  })
}
