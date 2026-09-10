<script setup lang="ts">
import { computed, onMounted, onUnmounted, watch, ref, shallowRef } from 'vue'
import TransactionList from './components/TransactionList.vue'
import { money, displayDate, needsReview, type ImportPreview } from './domain/model'
import { digest } from './domain/import'
import { validateRulePack, type RulePack } from './domain/rules'
import { pickSpreadsheet, type GoogleConfig } from './services/google'
import { createGoogleSession } from './services/google-session'
import {
  SheetsStore,
  googleRequester,
  createSavePlan,
  reconcile,
  persistPending,
  restorePending,
  clearPending,
  GoogleError,
  type SavePlan,
  type Snapshot,
} from './services/sheets'
import { processFile } from './services/import-worker'

type View = 'import' | 'transactions' | 'settings'
const view = ref<View>('import'),
  error = ref(''),
  notice = ref(''),
  busy = ref('')
const session = createGoogleSession()
const { connected, ready: googleReady, loading: googleLoading, status: sessionStatus } = session
const snapshot = shallowRef<Snapshot | null>(null),
  preview = ref<ImportPreview | null>(null)
const pending = shallowRef<SavePlan | null>(null),
  candidateRules = shallowRef<RulePack | null>(null)
const selectedRulesName = ref('')
const config = ref<GoogleConfig>({
  clientId: import.meta.env.VITE_GOOGLE_CLIENT_ID || '',
  apiKey: import.meta.env.VITE_GOOGLE_API_KEY || '',
  projectNumber: import.meta.env.VITE_GOOGLE_PROJECT_NUMBER || '',
})
const sheetId = ref(''),
  fatalPending = ref(false)
const store = new SheetsStore(googleRequester(session.getToken))
const locked = computed(() => !!busy.value || !!pending.value || fatalPending.value)
const categories = computed(() => snapshot.value?.rules?.categories ?? [])
const excluded = computed(
  () => preview.value?.transactions.filter((t) => t.classification.excluded).length ?? 0,
)
const reviewCount = computed(() => preview.value?.transactions.filter(needsReview).length ?? 0)
const newSpend = computed(
  () =>
    -(
      preview.value?.transactions
        .filter((t) => !t.classification.excluded && t.amountMinor < 0)
        .reduce((sum, t) => sum + t.amountMinor, 0) ?? 0
    ),
)
const receipts = computed(() => snapshot.value?.receipts.slice().reverse() ?? [])
function report(e: unknown) {
  error.value = e instanceof Error ? e.message : 'Die Aktion ist fehlgeschlagen.'
  if (e instanceof GoogleError && e.status === 401) session.invalidate()
}
async function run(label: string, action: () => Promise<void>) {
  if (busy.value) return
  busy.value = label
  error.value = ''
  notice.value = ''
  try {
    await action()
  } catch (e) {
    report(e)
  } finally {
    busy.value = ''
  }
}
async function rememberConfig() {
  try {
    localStorage.setItem('beancounter.config.v1', JSON.stringify(config.value))
    notice.value = 'Einstellungen auf diesem Gerät gespeichert.'
  } catch {
    error.value = 'Einstellungen konnten nicht gespeichert werden.'
    return
  }
  if (config.value.clientId && !googleReady.value) {
    try {
      await session.prepare()
    } catch (e) {
      report(e)
    }
  }
}
async function refresh() {
  const next = await store.load(sheetId.value)
  snapshot.value = next
  localStorage.setItem('beancounter.sheet.v1', sheetId.value)
}
async function connect() {
  await run('Verbindung wird hergestellt', async () => {
    if (!googleReady.value) {
      await session.prepare()
      notice.value =
        'Google ist bereit. Bitte zum Anmelden noch einmal auf „Mit Google verbinden“ tippen.'
      return
    }
    await session.authorize(config.value.clientId)
    if (pending.value) sheetId.value = pending.value.spreadsheetId
    if (sheetId.value) await refresh()
    notice.value = 'Mit Google verbunden.'
  })
}
async function createSheet() {
  await run('Tabelle wird erstellt', async () => {
    sheetId.value = await store.create()
    localStorage.setItem('beancounter.sheet.v1', sheetId.value)
    await refresh()
    view.value = 'settings'
    notice.value = 'Tabelle erstellt. Lade jetzt deine private Regeldatei.'
  })
}
let pickerAbort: AbortController | undefined
watch(
  connected,
  (active) => {
    if (!active) pickerAbort?.abort()
  },
  { flush: 'sync' },
)
async function chooseSheet() {
  await run('Tabelle auswählen', async () => {
    pickerAbort = new AbortController()
    let id: string | null
    try {
      id = await pickSpreadsheet(session.getToken, config.value, pickerAbort.signal)
    } finally {
      pickerAbort = undefined
    }
    if (!id) return
    const next = await store.load(id)
    sheetId.value = id
    snapshot.value = next
    preview.value = null
    candidateRules.value = null
    localStorage.setItem('beancounter.sheet.v1', id)
    notice.value = 'Tabelle verbunden.'
  })
}
function disconnect() {
  if (locked.value) return
  session.disconnect()
  snapshot.value = null
  preview.value = null
  candidateRules.value = null
  notice.value = 'Abgemeldet. Die Tabelle bleibt in deinem Google-Konto.'
}
async function readRules(event: Event) {
  const input = event.target as HTMLInputElement,
    file = input.files?.[0]
  input.value = ''
  if (!file) return
  await run('Regeln werden geprüft', async () => {
    if (file.size > 2_000_000) throw new Error('Regeldatei zu groß.')
    let value: unknown
    try {
      value = JSON.parse(await file.text())
    } catch {
      throw new Error('Regeldatei ist kein gültiges JSON.')
    }
    candidateRules.value = validateRulePack(value)
    selectedRulesName.value = file.name
  })
}
async function saveRules() {
  await run('Regeln werden gespeichert', async () => {
    if (!candidateRules.value || !snapshot.value) return
    await refresh()
    await store.replaceRules(snapshot.value!, candidateRules.value)
    candidateRules.value = null
    preview.value = null
    await refresh()
    notice.value = 'Regeln gespeichert. Bestehende Buchungen bleiben unverändert.'
    view.value = 'import'
  })
}
async function readCsv(event: Event) {
  const input = event.target as HTMLInputElement,
    file = input.files?.[0]
  input.value = ''
  if (!file) return
  await run('Datei wird geprüft', async () => {
    preview.value = null
    await refresh()
    if (!snapshot.value?.rules) throw new Error('Bitte zuerst deine privaten Regeln laden.')
    preview.value = await processFile(file, snapshot.value.rules, snapshot.value.transactions)
  })
}
async function saveImport() {
  await run('Buchungen werden gespeichert', async () => {
    if (!preview.value || !snapshot.value) return
    await refresh()
    const fresh = snapshot.value!
    if (!fresh.rules || (await digest(JSON.stringify(fresh.rules))) !== preview.value.rulesDigest)
      throw new Error('Die Regeln haben sich geändert. Bitte die CSV erneut auswählen.')
    if (fresh.receipts.some((r) => r.id === preview.value!.id)) {
      preview.value = null
      notice.value = 'Dieser Export wurde bereits importiert.'
      return
    }
    const known = new Set(fresh.transactions.map((t) => t.id))
    const tx = preview.value.transactions.filter((t) => !known.has(t.id))
    const current = {
      ...preview.value,
      transactions: tx,
      duplicates: preview.value.duplicates + preview.value.transactions.length - tx.length,
    }
    const plan = createSavePlan(fresh, current)
    persistPending(plan)
    pending.value = plan
    await store.save(plan)
    await finishSave(plan)
  })
}
async function finishSave(plan: SavePlan) {
  await refresh()
  if (reconcile(snapshot.value!, plan) !== 'saved')
    throw new Error('Speicherung noch nicht bestätigt. Bitte Status prüfen.')
  clearPending()
  pending.value = null
  preview.value = null
  notice.value = `${plan.receipt.added} Buchungen gespeichert, davon ${plan.receipt.excluded} ausgeschlossen. ${plan.receipt.duplicates} bereits vorhanden.`
}
async function recover() {
  await run('Speicherstatus wird geprüft', async () => {
    const plan = pending.value
    if (!plan) return
    sheetId.value = plan.spreadsheetId
    await refresh()
    if (reconcile(snapshot.value!, plan) === 'retry') await store.save(plan)
    await finishSave(plan)
  })
}
async function correct(id: string, payee: string, category: string) {
  if (locked.value) return
  if (preview.value && view.value === 'import') {
    const tx = preview.value.transactions.find((t) => t.id === id)
    if (tx) {
      tx.manualPayee = payee
      tx.manualCategory = category
    }
    return
  }
  await run('Zuordnung wird gespeichert', async () => {
    await refresh()
    if (snapshot.value) await store.correct(snapshot.value, id, payee, category)
    await refresh()
    notice.value = 'Zuordnung gespeichert.'
  })
}
function exportBackup() {
  if (!snapshot.value) return
  const blob = new Blob(
    [
      JSON.stringify(
        {
          version: 1,
          exportedAt: new Date().toISOString(),
          transactions: snapshot.value.transactions,
          rules: snapshot.value.rules,
          imports: snapshot.value.receipts,
        },
        null,
        2,
      ),
    ],
    { type: 'application/json' },
  )
  const url = URL.createObjectURL(blob),
    a = document.createElement('a')
  a.href = url
  a.download = 'beancounter-private-backup.json'
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
onUnmounted(() => {
  pickerAbort?.abort()
  window.removeEventListener('focus', session.checkExpiry)
  document.removeEventListener('visibilitychange', session.checkExpiry)
  session.disconnect()
})
onMounted(async () => {
  window.addEventListener('focus', session.checkExpiry)
  document.addEventListener('visibilitychange', session.checkExpiry)
  try {
    const saved = localStorage.getItem('beancounter.config.v1')
    if (saved) {
      const data = JSON.parse(saved)
      for (const key of ['clientId', 'apiKey', 'projectNumber'] as const)
        if (typeof data[key] === 'string') config.value[key] = data[key]
    }
    sheetId.value = localStorage.getItem('beancounter.sheet.v1') || ''
    try {
      pending.value = restorePending()
    } catch (e) {
      fatalPending.value = true
      report(e)
    }
    if (pending.value) sheetId.value = pending.value.spreadsheetId
    if (config.value.clientId) {
      await session.prepare()
    }
  } catch (e) {
    report(e)
  }
})
</script>
<template>
  <div class="app-shell">
    <header class="masthead">
      <a class="wordmark" href="#" @click.prevent="view = 'import'">beancounter<span>.</span></a>
      <div class="header-actions">
        <span class="edition">Das Haushaltsbuch</span
        ><button v-if="connected" class="text-button" :disabled="locked" @click="disconnect">
          Abmelden
        </button>
      </div>
    </header>
    <nav class="tabs" aria-label="Bereiche">
      <button
        v-for="tab in [
          { id: 'import', label: 'Import' },
          { id: 'transactions', label: 'Buchungen' },
          { id: 'settings', label: 'Einstellungen' },
        ]"
        :key="tab.id"
        :class="{ active: view === tab.id }"
        :aria-current="view === tab.id ? 'page' : undefined"
        @click="view = tab.id as View"
      >
        {{ tab.label }}
      </button>
    </nav>
    <main>
      <div v-if="error" class="message error" role="alert">{{ error }}</div>
      <div v-if="notice" class="message success" role="status">{{ notice }}</div>
      <div v-if="busy" class="message" role="status" aria-live="polite">{{ busy }} …</div>
      <section v-if="pending" class="panel pending">
        <p class="eyebrow">OFFENER IMPORT</p>
        <h2>Speicherung bestätigen</h2>
        <p>
          Ein Import ist noch nicht bestätigt. Prüfe zuerst seinen Status. Bis dahin bleiben weitere
          Änderungen gesperrt.
        </p>
        <p class="small muted">
          Der offene Import wird vorübergehend in diesem Browser-Tab aufbewahrt. Bitte den Tab nicht
          schließen.
        </p>
        <button v-if="connected" class="primary" :disabled="!!busy" @click="recover">
          Status prüfen und fortsetzen
        </button>
      </section>
      <section v-if="!connected" class="panel connect">
        <p class="eyebrow">DEINE PRIVATE TABELLE</p>
        <h1>Die Zahlen bleiben<br />bei dir.</h1>
        <p>
          Verbinde dein Google-Konto, um deine Tabelle zu öffnen und Umsätze von jedem Gerät aus zu
          importieren.
        </p>
        <p v-if="sessionStatus === 'expired'" class="small muted">
          Deine Google-Verbindung ist abgelaufen. Verbinde dich erneut; deine Vorschau bleibt
          erhalten.
        </p>
        <button
          v-if="config.clientId"
          class="primary"
          :disabled="!!busy || googleLoading"
          @click="connect"
        >
          {{
            googleLoading
              ? 'Google wird geladen …'
              : googleReady
                ? 'Mit Google verbinden'
                : 'Erneut versuchen'
          }}
        </button>
        <template v-else
          ><p>Vor der ersten Anmeldung muss der Google-Zugang für diese App eingerichtet werden.</p>
          <button class="primary" @click="view = 'settings'">
            Google-Zugang einrichten
          </button></template
        >
      </section>
      <section v-else-if="!snapshot && !pending" class="panel">
        <h2>Dein Haushaltsbuch</h2>
        <p>
          Erstelle eine private Tabelle oder öffne eine bereits eingerichtete Beancounter-Tabelle.
        </p>
        <div class="actions">
          <button class="primary" :disabled="locked" @click="createSheet">
            Neue Tabelle erstellen</button
          ><button class="secondary" :disabled="locked" @click="chooseSheet">
            Bestehende Tabelle wählen
          </button>
        </div>
      </section>
      <template v-if="view === 'import'">
        <div class="section-heading">
          <div>
            <p class="eyebrow">UMSÄTZE IMPORTIEREN</p>
            <h1>Aus Dateien werden Buchungen.</h1>
          </div>
        </div>
        <div class="work-grid">
          <div>
            <section class="panel">
              <div class="step-heading">
                <span class="step">01</span>
                <h2>ING-Datei auswählen</h2>
              </div>
              <p class="muted">
                Lade den CSV-Export aus deinem Banking. Bereits importierte Buchungen werden
                erkannt.
              </p>
              <p v-if="snapshot && !snapshot.rules" class="message">
                Es fehlen noch deine Zuordnungsregeln.
                <button class="text-button" @click="view = 'settings'">Private Regeln laden</button>
              </p>
              <label class="upload" :class="{ disabled: locked || !snapshot?.rules || !connected }">
                CSV auswählen<input
                  type="file"
                  accept=".csv,text/csv"
                  :disabled="locked || !snapshot?.rules || !connected"
                  @change="readCsv"
                />
              </label>
              <p class="small muted">Gebuchte Umsätze · EUR · bis 10 MB</p>
            </section>
            <section v-if="preview" class="panel">
              <div class="step-heading">
                <span class="step">02</span>
                <h2>Prüfen &amp; speichern</h2>
              </div>
              <p class="filename">{{ preview.source.filename }}</p>
              <p class="small muted">
                {{ displayDate(preview.source.periodStart) }} –
                {{ displayDate(preview.source.periodEnd) }} · Konto …{{
                  preview.source.account.slice(-4)
                }}
              </p>
              <div
                v-for="warning in preview.source.warnings"
                :key="warning"
                class="message warning"
              >
                {{ warning }}
              </div>
              <p v-if="preview.repeated" class="message warning">
                Die Datei enthält {{ preview.repeated }} Gruppen identischer Buchungen. Ihre Anzahl
                bleibt erhalten. Prüfe bei Teil-Exporten, ob alle Buchungen desselben Tages
                enthalten sind.
              </p>
              <div class="metrics">
                <div>
                  <strong>{{ preview.transactions.length }}</strong
                  ><span>Neue Buchungen</span>
                </div>
                <div>
                  <strong>{{ preview.duplicates }}</strong
                  ><span>Schon vorhanden</span>
                </div>
                <div>
                  <strong>{{ reviewCount }}</strong
                  ><span>Zu prüfen</span>
                </div>
              </div>
              <div class="import-total">
                <span
                  >Neue Abbuchungen
                  <small>ohne {{ excluded }} ausgeschlossene Buchungen</small></span
                ><strong>{{ money(newSpend) }}</strong>
              </div>
              <p class="small muted">
                Gutschriften sind hier nicht verrechnet. Ausgeschlossene Buchungen werden zur
                Wiedererkennung gespeichert und nicht als Ausgaben gezählt.
              </p>
              <button class="primary full" :disabled="locked || !connected" @click="saveImport">
                Import bestätigen
              </button>
            </section>
          </div>
          <aside>
            <section class="panel compact">
              <p class="eyebrow">VERBINDUNG</p>
              <h2>{{ snapshot?.title || 'Noch keine Tabelle' }}</h2>
              <p class="small muted">
                {{
                  snapshot
                    ? snapshot.transactions.length + ' gespeicherte Buchungen'
                    : 'Melde dich an, um dein Haushaltsbuch zu öffnen.'
                }}
              </p>
              <a
                v-if="snapshot"
                :href="'https://docs.google.com/spreadsheets/d/' + snapshot.spreadsheetId + '/edit'"
                target="_blank"
                rel="noopener noreferrer"
                class="text-link"
                >In Google Sheets öffnen ↗</a
              >
            </section>
            <section class="panel compact">
              <p class="eyebrow">LETZTE IMPORTE</p>
              <ol v-if="receipts.length" class="history">
                <li v-for="r in receipts.slice(0, 5)" :key="r.id">
                  <strong>{{ displayDate(r.periodEnd) }}</strong
                  ><span>{{ r.added }} neue · {{ r.duplicates }} vorhandene</span
                  ><small>Konto …{{ r.account.slice(-4) }}</small>
                </li>
              </ol>
              <p v-else class="small muted">Hier erscheinen deine bestätigten Importe.</p>
            </section>
          </aside>
        </div>
        <section v-if="preview" class="panel">
          <h2>Neue Buchungen</h2>
          <TransactionList
            :transactions="preview.transactions"
            :categories="categories"
            :editable="!locked"
            @correct="correct"
          />
        </section>
      </template>
      <template v-if="view === 'transactions'">
        <div class="section-heading">
          <div>
            <p class="eyebrow">HAUSHALTSBUCH</p>
            <h1>Alle Buchungen.</h1>
          </div>
          <button
            v-if="connected && snapshot"
            class="secondary"
            :disabled="locked"
            @click="run('Buchungen werden geladen', refresh)"
          >
            Aktualisieren
          </button>
        </div>
        <section class="panel">
          <TransactionList
            v-if="snapshot"
            :transactions="snapshot.transactions"
            :categories="categories"
            :editable="connected && !locked"
            @correct="correct"
          />
          <p v-else class="empty">Verbinde eine Tabelle, um deine Buchungen zu sehen.</p>
        </section>
      </template>
      <template v-if="view === 'settings'">
        <p class="eyebrow">EINSTELLUNGEN</p>
        <h1>Dein Haushaltsbuch einrichten.</h1>
        <section class="panel">
          <h2>Google-Zugang</h2>
          <p class="muted">
            Einmalige Einrichtung für diese App. Die Angaben werden nur auf diesem Gerät
            gespeichert.
          </p>
          <form class="settings-form" @submit.prevent="rememberConfig">
            <label
              >OAuth Client-ID<input
                v-model="config.clientId"
                :disabled="connected || locked"
                placeholder="…apps.googleusercontent.com"
                autocomplete="off"
            /></label>
            <details>
              <summary>Bestehende Tabellen auswählen (optional)</summary>
              <label
                >Google Picker API-Key<input
                  v-model="config.apiKey"
                  :disabled="locked"
                  autocomplete="off"
              /></label>
              <label
                >Google Cloud Projektnummer<input
                  v-model="config.projectNumber"
                  :disabled="locked"
                  inputmode="numeric"
              /></label>
            </details>
            <div class="actions">
              <button class="primary" :disabled="locked">Einstellungen speichern</button
              ><a
                href="https://github.com/nfelger/beancounter/blob/main/docs/SETUP.md"
                target="_blank"
                rel="noopener noreferrer"
                class="text-link"
                >Einrichtungsanleitung ↗</a
              >
            </div>
          </form>
        </section>
        <section v-if="connected" class="panel">
          <h2>Tabelle</h2>
          <p>{{ snapshot?.title || 'Noch keine Tabelle verbunden.' }}</p>
          <div class="actions">
            <button class="secondary" :disabled="locked" @click="chooseSheet">
              Andere Tabelle wählen</button
            ><button class="secondary" :disabled="locked" @click="createSheet">
              Neue Tabelle erstellen
            </button>
          </div>
        </section>
        <section v-if="snapshot" class="panel">
          <h2>Private Zuordnungsregeln</h2>
          <p class="muted">
            Die Regeln werden in deiner Tabelle gespeichert. Änderungen wirken auf künftige Importe;
            bestehende Zuordnungen bleiben erhalten.
          </p>
          <p v-if="snapshot.rules">
            {{ snapshot.rules.rules.length }} Regeln ·
            {{ snapshot.rules.normalizers.length }} Bereinigungsschritte
          </p>
          <label class="upload" :class="{ disabled: locked || !connected }"
            >Regeldatei auswählen<input
              type="file"
              accept=".json,application/json"
              :disabled="locked || !connected"
              @change="readRules"
          /></label>
          <div v-if="candidateRules" class="rule-confirm">
            <p>{{ selectedRulesName }}: {{ candidateRules.rules.length }} Regeln geprüft.</p>
            <p v-if="snapshot.rules" class="small">Die vorhandenen Regeln werden ersetzt.</p>
            <button class="primary" :disabled="locked" @click="saveRules">
              {{ snapshot.rules ? 'Regeln ersetzen' : 'Regeln speichern' }}
            </button>
          </div>
          <p class="small muted">
            Die Einrichtungsanleitung beschreibt den privaten Export aus deinem Python-Skript.
          </p>
        </section>
        <section v-if="snapshot" class="panel">
          <h2>Datensicherung</h2>
          <p class="muted">
            Lade Buchungen, Regeln und Importverlauf als private JSON-Datei herunter. Bewahre die
            Datei sicher auf.
          </p>
          <button class="secondary" :disabled="locked" @click="exportBackup">
            Private Sicherung herunterladen
          </button>
        </section>
      </template>
    </main>
    <footer>beancounter · Deine Tabelle. Deine Zahlen.</footer>
  </div>
</template>
