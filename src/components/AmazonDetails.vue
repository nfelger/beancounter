<script setup lang="ts">
import { ref } from 'vue'
import { parseAmazon, type AmazonOrder } from '../domain/amazon'
defineProps<{ disabled: boolean }>()
const emit = defineEmits<{ change: [orders: AmazonOrder[]] }>()
const text = ref(''),
  error = ref(''),
  count = ref(0)
function clear() {
  text.value = ''
  apply()
}
function apply() {
  error.value = ''
  count.value = 0
  emit('change', [])
  if (!text.value.trim()) return
  try {
    const orders = parseAmazon(text.value)
    emit('change', orders)
    count.value = orders.length
    text.value = ''
  } catch (e) {
    error.value = (e as Error).message
  }
}
</script>
<template>
  <section class="panel">
    <h2>Amazon-Käufe gefunden</h2>
    <p>
      Um zu sehen, was du gekauft hast, öffne deine
      <a href="https://www.amazon.de/gp/css/order-history" target="_blank" rel="noopener noreferrer"
        >Amazon-Bestellungen</a
      >, kopiere deine Kaufdaten und füge sie hier ein.
    </p>
    <label
      >Amazon-Daten (optional)<textarea
        v-model="text"
        rows="5"
        placeholder="Amazon-Daten einfügen…"
        :disabled="disabled"
      />
    </label>
    <div class="actions">
      <button class="secondary" :disabled="disabled || !text.trim()" @click="apply">
        Amazon-Details anzeigen
      </button>
      <button v-if="count" class="text-button" :disabled="disabled" @click="clear">
        Amazon-Details entfernen
      </button>
    </div>
    <p v-if="error" class="message warning" role="status">{{ error }}</p>
    <p v-if="count" class="small muted">
      {{ count }} Bestellung(en) als Kontext geladen. Nur identische Bestellnummern werden
      zugeordnet. Eine Buchung behält eine Kategorie. Diese Details werden nicht gespeichert.
    </p>
  </section>
</template>
