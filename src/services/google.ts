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
export async function pickSpreadsheet(token: string, config: GoogleConfig): Promise<string | null> {
  if (!config.apiKey || !config.projectNumber)
    throw new Error('Für die Dateiauswahl fehlen API-Key oder Projektnummer in den Einstellungen.')
  await script('https://apis.google.com/js/api.js', () => typeof window.gapi?.load === 'function')
  await new Promise<void>((resolve, reject) =>
    window.gapi.load('picker', {
      callback: resolve,
      onerror: () => reject(new Error('Dateiauswahl konnte nicht geladen werden.')),
      timeout: LOAD_TIMEOUT_MS,
      ontimeout: () => reject(new Error('Dateiauswahl konnte nicht geladen werden.')),
    }),
  )
  return new Promise((resolve) => {
    const picker = window.google.picker
    new picker.PickerBuilder()
      .addView(picker.ViewId.SPREADSHEETS)
      .setOAuthToken(token)
      .setDeveloperKey(config.apiKey)
      .setAppId(config.projectNumber)
      .setOrigin(window.location.origin)
      .setCallback((data) => {
        if (data.action === picker.Action.PICKED) resolve(data.docs?.[0]?.id ?? null)
        if (data.action === picker.Action.CANCEL) resolve(null)
      })
      .build()
      .setVisible(true)
  })
}
