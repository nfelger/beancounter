import { z } from 'zod'
import { computed, readonly, ref } from 'vue'
import { loadGoogle } from './google'

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file'
const EXPIRY_MARGIN_MS = 30_000
export const SESSION_KEY = 'beancounter.google-session.v1'
const savedSession = z.object({
  clientId: z.string().min(1),
  scope: z.literal(DRIVE_SCOPE),
  token: z.string().min(1),
  expiresAt: z.number().finite().positive(),
})

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
  function forgetSavedToken() {
    try {
      const raw = localStorage.getItem(SESSION_KEY)
      // An older tab must not remove a newer tab's grant when its own token expires.
      if (raw && JSON.parse(raw).token === token) localStorage.removeItem(SESSION_KEY)
    } catch {
      // Storage may be disabled; the in-memory session still works.
    }
  }
  function restore(clientId: string): boolean {
    clearToken()
    status.value = 'disconnected'
    try {
      const raw = localStorage.getItem(SESSION_KEY)
      if (!raw) return false
      const saved = savedSession.parse(JSON.parse(raw))
      const remaining = saved.expiresAt - Date.now()
      if (saved.clientId !== clientId || remaining <= 0 || remaining > 2_147_483_647) {
        localStorage.removeItem(SESSION_KEY)
        return false
      }
      token = saved.token
      expiresAt = saved.expiresAt
      expiryTimer = setTimeout(checkExpiry, remaining)
      status.value = 'connected'
      return true
    } catch {
      try {
        localStorage.removeItem(SESSION_KEY)
      } catch {
        /* Storage unavailable. */
      }
      return false
    }
  }
  function dispose() {
    cancelAuthorization?.()
    clearToken()
    status.value = 'disconnected'
  }
  function onStorage(event: StorageEvent) {
    if (event.storageArea && event.storageArea !== localStorage) return
    // Do not switch accounts underneath an open preview. Reconnect explicitly.
    if (event.key === SESSION_KEY || event.key === null) dispose()
  }
  function checkExpiry() {
    if (token && Date.now() >= expiresAt) {
      forgetSavedToken()
      clearToken()
      status.value = 'expired'
    }
  }
  function getToken() {
    checkExpiry() // Timers may be suspended while a mobile browser is in the background.
    return token
  }
  function disconnect() {
    forgetSavedToken()
    dispose()
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
    forgetSavedToken()
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
            try {
              localStorage.setItem(
                SESSION_KEY,
                JSON.stringify({
                  clientId,
                  scope: DRIVE_SCOPE,
                  token,
                  expiresAt,
                }),
              )
            } catch {
              // A blocked or full store must not prevent authorization.
            }
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
    restore,
    dispose,
    onStorage,
    authorize,
    getToken,
    checkExpiry,
    disconnect,
    invalidate,
  }
}
