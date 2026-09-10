export interface GoogleConfig {
  clientId: string
  apiKey: string
  projectNumber: string
}
const loaded = new Map<string, Promise<void>>()
function script(url: string) {
  if (!loaded.has(url))
    loaded.set(
      url,
      new Promise<void>((resolve, reject) => {
        const tag = document.createElement('script')
        tag.src = url
        tag.async = true
        tag.onload = () => resolve()
        tag.onerror = () => {
          loaded.delete(url)
          tag.remove()
          reject(new Error('Google konnte nicht geladen werden. Bitte erneut versuchen.'))
        }
        document.head.append(tag)
      }),
    )
  return loaded.get(url)!
}
export const loadGoogle = () => script('https://accounts.google.com/gsi/client')
export function requestToken(clientId: string): Promise<{ token: string; expiresAt: number }> {
  return new Promise((resolve, reject) => {
    if (!window.google?.accounts) {
      reject(new Error('Google-Anmeldung wird noch geladen.'))
      return
    }
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: 'https://www.googleapis.com/auth/drive.file',
      callback: (response) => {
        if (!response.access_token || response.error)
          reject(new Error('Google-Zugriff wurde nicht gewährt.'))
        else
          resolve({
            token: response.access_token,
            expiresAt: Date.now() + Number(response.expires_in ?? 3600) * 1000,
          })
      },
      error_callback: () => reject(new Error('Anmeldung abgebrochen oder Popup blockiert.')),
    })
    client.requestAccessToken({ prompt: '' })
  })
}
export async function pickSpreadsheet(token: string, config: GoogleConfig): Promise<string | null> {
  if (!config.apiKey || !config.projectNumber)
    throw new Error('Für die Dateiauswahl fehlen API-Key oder Projektnummer in den Einstellungen.')
  await script('https://apis.google.com/js/api.js')
  await new Promise<void>((resolve, reject) =>
    window.gapi.load('picker', {
      callback: resolve,
      onerror: () => reject(new Error('Dateiauswahl konnte nicht geladen werden.')),
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
