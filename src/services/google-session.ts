import { computed, readonly, ref } from 'vue'
import { loadGoogle } from './google'

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file'
const EXPIRY_MARGIN_MS = 30_000

export function createGoogleSession() {
  const ready = ref(false),
    loading = ref(false)
  const status = ref<'disconnected' | 'authorizing' | 'connected' | 'expired'>('disconnected')
  let token = '',
    expiresAt = 0
  let expiryTimer: ReturnType<typeof setTimeout> | undefined
  let preparing: Promise<void> | undefined
  let cancelAuthorization: (() => void) | undefined

  function clearToken() {
    clearTimeout(expiryTimer)
    token = ''
    expiresAt = 0
  }
  function checkExpiry() {
    if (token && Date.now() >= expiresAt) {
      clearToken()
      status.value = 'expired'
    }
  }
  function getToken() {
    checkExpiry() // Timers may be suspended while a mobile browser is in the background.
    return token
  }
  function disconnect() {
    cancelAuthorization?.()
    clearToken()
    status.value = 'disconnected'
  }
  function invalidate() {
    disconnect()
    status.value = 'expired'
  }
  function prepare(): Promise<void> {
    if (ready.value) return Promise.resolve()
    if (preparing) return preparing
    loading.value = true
    preparing = loadGoogle()
      .then(() => {
        ready.value = true
      })
      .finally(() => {
        loading.value = false
        preparing = undefined
      })
    return preparing
  }
  function authorize(clientId: string): Promise<void> {
    if (cancelAuthorization) return Promise.reject(new Error('Anmeldung läuft bereits.'))
    if (!ready.value || !clientId.trim())
      return Promise.reject(
        new Error('Google-Zugang ist noch nicht bereit. Bitte Einstellungen prüfen.'),
      )
    clearToken()
    status.value = 'authorizing'
    return new Promise((resolve, reject) => {
      let settled = false
      const timer = setTimeout(
        () => fail('Anmeldung hat zu lange gedauert. Bitte erneut verbinden.'),
        120_000,
      )
      const fail = (message: string) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        cancelAuthorization = undefined
        status.value = 'disconnected'
        reject(new Error(message))
      }
      cancelAuthorization = () => fail('Anmeldung abgebrochen.')
      try {
        const oauth = window.google.accounts.oauth2
        const client = oauth.initTokenClient({
          client_id: clientId,
          scope: DRIVE_SCOPE,
          callback: (response) => {
            if (settled) return
            if (
              response.error ||
              !response.access_token ||
              !oauth.hasGrantedAllScopes(response, DRIVE_SCOPE)
            ) {
              fail('Google-Zugriff auf die Tabelle wurde nicht gewährt.')
              return
            }
            const lifetime = Number(response.expires_in) * 1000 - EXPIRY_MARGIN_MS
            if (!Number.isFinite(lifetime) || lifetime <= 0 || lifetime > 2_147_483_647) {
              fail('Google hat keine gültige Sitzungsdauer übermittelt. Bitte erneut verbinden.')
              return
            }
            settled = true
            clearTimeout(timer)
            cancelAuthorization = undefined
            token = response.access_token
            expiresAt = Date.now() + lifetime
            expiryTimer = setTimeout(checkExpiry, lifetime)
            status.value = 'connected'
            resolve()
          },
          error_callback: () => fail('Anmeldung abgebrochen oder Popup blockiert.'),
        })
        // Keep this synchronous with the click so mobile browsers allow the popup.
        client.requestAccessToken({ prompt: '' })
      } catch {
        fail('Google-Anmeldung konnte nicht gestartet werden. Bitte erneut versuchen.')
      }
    })
  }
  return {
    ready: readonly(ready),
    loading: readonly(loading),
    status: readonly(status),
    connected: computed(() => status.value === 'connected'),
    prepare,
    authorize,
    getToken,
    checkExpiry,
    disconnect,
    invalidate,
  }
}
