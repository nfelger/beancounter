<script setup lang="ts">
import type { AmazonContext } from '../domain/amazon'
import { computed, ref, watch } from 'vue'
import { relatedAssignments } from '../services/assignment-rules'
import { needsReview, money, displayDate, type Transaction } from '../domain/model'
const PER_PAGE = 100
const props = defineProps<{
  transactions: Transaction[]
  amazonContexts?: Record<string, AmazonContext | undefined>
  categories: string[]
  unknownCategory: string
  editable: boolean
  previewMode?: boolean
  editedIds?: ReadonlySet<string>
  canCreateRule: boolean
  saveAssignment: (
    id: string,
    payee: string,
    category: string,
    createRule: boolean,
  ) => Promise<boolean>
}>()
const expandedAmazon = ref(new Set<string>())
function toggleAmazon(id: string, event: Event) {
  if ((event.target as HTMLDetailsElement).open) expandedAmazon.value.add(id)
  else expandedAmazon.value.delete(id)
}
const search = ref(''),
  filter = ref('all'),
  page = ref(1),
  editing = ref(''),
  payee = ref(''),
  category = ref('')
const filtered = computed(() =>
  props.transactions
    .filter((t) => {
      const text = [
        t.classification.payee,
        t.classification.category,
        t.raw.rawPayee,
        t.raw.purpose,
      ]
        .join(' ')
        .toLocaleLowerCase()
      return (
        text.includes(search.value.toLocaleLowerCase()) &&
        (filter.value === 'all' ||
          (filter.value === 'excluded' && t.classification.excluded) ||
          (filter.value === 'review' && needsReview(t, props.unknownCategory)))
      )
    })
    .sort((a, b) => b.bookingDate.localeCompare(a.bookingDate)),
)
const pageCount = computed(() => Math.max(1, Math.ceil(filtered.value.length / PER_PAGE)))
const visible = computed(() =>
  filtered.value.slice((page.value - 1) * PER_PAGE, page.value * PER_PAGE),
)
watch([search, filter], () => {
  page.value = 1
})
watch(pageCount, (count) => {
  page.value = Math.min(page.value, count)
})
function edit(t: Transaction) {
  editing.value = t.id
  payee.value = t.classification.payee
  category.value = t.classification.category
}
const affectedCount = computed(() => {
  const source = props.transactions.find((t) => t.id === editing.value)
  if (!source || !props.previewMode) return 0
  return relatedAssignments(props.transactions, source, props.editedIds ?? new Set()).filter(
    (t) =>
      t.classification.payee !== payee.value.trim() || t.classification.category !== category.value,
  ).length
})
async function submit(createRule = false) {
  if (await props.saveAssignment(editing.value, payee.value.trim(), category.value, createRule))
    editing.value = ''
}
</script>
<template>
  <div class="list-toolbar">
    <label class="search-label"
      >Suchen<input
        v-model="search"
        type="search"
        placeholder="Empfänger, Kategorie, Verwendungszweck"
    /></label>
    <label
      >Zeigen<select v-model="filter">
        <option value="all">Alle Buchungen</option>
        <option value="review">Zu prüfen</option>
        <option value="excluded">Ausgeschlossen</option>
      </select></label
    >
  </div>
  <p class="muted small">{{ filtered.length }} Buchungen</p>
  <div class="transaction-list">
    <article
      v-for="t in visible"
      :key="t.id"
      class="transaction"
      :class="{ excluded: t.classification.excluded }"
    >
      <div class="tx-main">
        <div>
          <strong>{{ t.classification.payee }}</strong
          ><span class="tx-meta"
            >{{ displayDate(t.bookingDate) }} · {{ t.classification.category }}</span
          >
        </div>
        <strong class="amount" :class="{ credit: t.amountMinor > 0 }">{{
          money(t.amountMinor, t.raw.currency)
        }}</strong>
      </div>
      <details
        v-if="amazonContexts?.[t.id]"
        class="amazon-context"
        @toggle="toggleAmazon(t.id, $event)"
      >
        <summary>
          {{
            amazonContexts[t.id]!.exact
              ? 'Amazon: Bestellnummer stimmt überein'
              : 'Amazon-Kontext — keine eindeutige Zuordnung'
          }}
        </summary>
        <p v-if="!amazonContexts[t.id]!.exact" class="small muted">
          Keine passende Bestellnummer gefunden. Die eingefügten Bestellungen dienen nur zur
          Orientierung; sie sind dieser Buchung nicht zugeordnet.
        </p>
        <template v-if="expandedAmazon.has(t.id)">
          <div v-for="(order, index) in amazonContexts[t.id]!.orders" :key="index">
            <p class="small muted">Bestellung {{ order.orderId }}</p>
            <ul>
              <li v-for="(item, itemIndex) in order.items" :key="itemIndex">
                {{ item.name }}<br /><span class="small muted">{{ item.context }}</span>
              </li>
            </ul>
          </div>
        </template>
      </details>
      <div class="tx-foot">
        <span v-if="t.classification.excluded" class="badge">Ausgeschlossen</span>
        <span v-else-if="needsReview(t, props.unknownCategory)" class="badge review"
          >Zuordnung prüfen</span
        >
        <details>
          <summary>Original anzeigen</summary>
          <dl>
            <dt>Empfänger</dt>
            <dd>{{ t.raw.rawPayee }}</dd>
            <dt>Verwendungszweck</dt>
            <dd>{{ t.raw.purpose }}</dd>
            <dt>Buchungstext</dt>
            <dd>{{ t.raw.bookingText }}</dd>
          </dl>
        </details>
        <button
          v-if="editable && !t.classification.excluded && editing !== t.id"
          class="text-button"
          @click="edit(t)"
        >
          Zuordnung ändern
        </button>
      </div>
      <form v-if="editing === t.id" class="edit-form" @submit.prevent="submit(false)">
        <label
          >Empfänger<input v-model="payee" :placeholder="t.classification.payee" maxlength="1000"
        /></label>
        <label
          >Kategorie<select v-model="category">
            <option v-if="!categories.includes(category)" :value="category">{{ category }}</option>
            <option v-for="c in categories" :key="c">{{ c }}</option>
          </select></label
        >
        <div class="actions">
          <button class="secondary" :disabled="!editable">Zuordnung ändern</button
          ><button
            type="button"
            class="primary"
            :disabled="
              !editable || !canCreateRule || !payee.trim() || !categories.includes(category)
            "
            @click="submit(true)"
          >
            Ändern &amp; Regel erstellen</button
          ><button type="button" class="secondary" @click="editing = ''">Abbrechen</button>
        </div>
        <p v-if="previewMode" class="small muted">
          Mit Regel: ändert auch {{ affectedCount }} weitere Buchung(en) in diesem Import. Manuelle
          Änderungen und Ausschlüsse bleiben erhalten. Die Regel wird erst mit „Import bestätigen“
          gespeichert.
        </p>
        <p v-else class="small muted">
          Mit Regel: gilt für zukünftige Importe. Andere gespeicherte Buchungen bleiben
          unverändert.<span v-if="!canCreateRule">
            Bitte zuerst den offenen Import abschließen und sicherstellen, dass Regeln geladen
            sind.</span
          >
        </p>
      </form>
    </article>
    <p v-if="!filtered.length" class="empty">Keine passenden Buchungen.</p>
  </div>
  <div v-if="pageCount > 1" class="pagination">
    <button class="secondary" :disabled="page === 1" @click="page--">Zurück</button
    ><span>{{ page }} / {{ pageCount }}</span
    ><button class="secondary" :disabled="page >= pageCount" @click="page++">Weiter</button>
  </div>
</template>
