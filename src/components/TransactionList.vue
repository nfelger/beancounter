<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  effectivePayee,
  effectiveCategory,
  needsReview,
  money,
  displayDate,
  type Transaction,
} from '../domain/model'
const props = defineProps<{
  transactions: Transaction[]
  categories: string[]
  editable: boolean
}>()
const emit = defineEmits<{ correct: [id: string, payee: string, category: string] }>()
const search = ref(''),
  filter = ref('all'),
  page = ref(1),
  editing = ref(''),
  payee = ref(''),
  category = ref('')
const filtered = computed(() =>
  props.transactions
    .filter((t) => {
      const text = [effectivePayee(t), effectiveCategory(t), t.raw.rawPayee, t.raw.purpose]
        .join(' ')
        .toLocaleLowerCase()
      return (
        text.includes(search.value.toLocaleLowerCase()) &&
        (filter.value === 'all' ||
          (filter.value === 'excluded' && t.classification.excluded) ||
          (filter.value === 'review' && needsReview(t)))
      )
    })
    .sort((a, b) => b.bookingDate.localeCompare(a.bookingDate)),
)
const pageCount = computed(() => Math.max(1, Math.ceil(filtered.value.length / 40)))
const visible = computed(() => filtered.value.slice((page.value - 1) * 40, page.value * 40))
watch([search, filter, () => props.transactions], () => {
  page.value = 1
})
function edit(t: Transaction) {
  editing.value = t.id
  payee.value = t.manualPayee
  category.value = t.manualCategory
}
function submit() {
  emit('correct', editing.value, payee.value.trim(), category.value)
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
          <strong>{{ effectivePayee(t) }}</strong
          ><span class="tx-meta"
            >{{ displayDate(t.bookingDate) }} · {{ effectiveCategory(t) }}</span
          >
        </div>
        <strong class="amount" :class="{ credit: t.amountMinor > 0 }">{{
          money(t.amountMinor, t.raw.currency)
        }}</strong>
      </div>
      <div class="tx-foot">
        <span v-if="t.classification.excluded" class="badge">Ausgeschlossen</span>
        <span v-else-if="needsReview(t)" class="badge review">Zuordnung prüfen</span>
        <span v-else-if="t.manualPayee || t.manualCategory" class="badge">Manuell zugeordnet</span>
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
      <form v-if="editing === t.id" class="edit-form" @submit.prevent="submit">
        <label
          >Empfänger überschreiben<input
            v-model="payee"
            :placeholder="t.classification.payee"
            maxlength="1000"
        /></label>
        <label
          >Kategorie überschreiben<select v-model="category">
            <option value="">Automatisch: {{ t.classification.category }}</option>
            <option v-for="c in categories" :key="c">{{ c }}</option>
          </select></label
        >
        <div class="actions">
          <button class="primary" :disabled="!editable">Übernehmen</button
          ><button type="button" class="secondary" @click="editing = ''">Abbrechen</button>
        </div>
        <p class="small muted">Leere Felder verwenden wieder die automatische Zuordnung.</p>
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
