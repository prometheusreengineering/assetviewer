<script setup lang="ts">
import Button from 'primevue/button'
import Chip from 'primevue/chip'
import DatePicker from 'primevue/datepicker'
import InputNumber from 'primevue/inputnumber'
import InputText from 'primevue/inputtext'
import MultiSelect from 'primevue/multiselect'
import Popover from 'primevue/popover'
import Select from 'primevue/select'
import ToggleSwitch from 'primevue/toggleswitch'
import { computed, ref } from 'vue'
import { OPS, type Rule, type SortKey } from '../filtering'
import type { FieldDef } from '../providers/types'

const props = defineProps<{ fields: FieldDef[]; measuring?: { done: number; total: number } }>()
const search = defineModel<string>('search', { required: true })
const rules = defineModel<Rule[]>('rules', { required: true })
const sorts = defineModel<SortKey[]>('sorts', { required: true })

const byKey = computed(() => new Map(props.fields.map((f) => [f.key, f])))
const fieldOptions = computed(() => props.fields.map((f) => ({ label: f.label, value: f.key })))

// ---- filter editor -------------------------------------------------------
const filterPop = ref<InstanceType<typeof Popover>>()
const draft = ref<Rule>({ id: 0, field: '', op: 'contains', value: '' })
const editing = ref(false)
let nextId = 1

const draftDef = computed(() => byKey.value.get(draft.value.field))
const draftOps = computed(() => (draftDef.value ? OPS[draftDef.value.type] : []))
const asDate = (ms: unknown) => (typeof ms === 'number' ? new Date(ms) : null)
const dayStart = (d: Date | null) => (d ? new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() : null)

function blank(field: string): Rule {
  const def = byKey.value.get(field)!
  const value = def.type === 'multi' ? [] : def.type === 'bool' ? true : def.type === 'text' ? '' : null
  return { id: nextId++, field, op: OPS[def.type][0]!.op, value }
}
function openFilter(e: Event, rule?: Rule) {
  editing.value = !!rule
  draft.value = rule ? { ...rule, value: Array.isArray(rule.value) ? [...rule.value] : rule.value } : blank(props.fields[0]!.key)
  const target = e.currentTarget as HTMLElement
  filterPop.value!.hide()
  setTimeout(() => filterPop.value!.show(e, target), 0)
}
function pickField(field: string) {
  draft.value = { ...blank(field), id: draft.value.id }
}
function saveFilter() {
  const r = { ...draft.value }
  const i = rules.value.findIndex((x) => x.id === r.id)
  rules.value = i >= 0 ? rules.value.map((x) => (x.id === r.id ? r : x)) : [...rules.value, r]
  filterPop.value!.hide()
}
const removeRule = (id: number) => (rules.value = rules.value.filter((r) => r.id !== id))

function fmt(v: unknown, def: FieldDef): string {
  if (def.type === 'date') return typeof v === 'number' ? new Date(v).toISOString().slice(0, 10) : '…'
  if (def.type === 'number') return v === null || v === undefined ? '…' : Number(v).toLocaleString()
  if (def.type === 'multi') return (v as string[]).join(', ') || '…'
  return String(v ?? '')
}
function describe(r: Rule): string {
  const def = byKey.value.get(r.field)
  if (!def) return r.field
  if (def.type === 'bool') return `${def.label}: ${r.value ? 'yes' : 'no'}`
  const op = OPS[def.type].find((o) => o.op === r.op)?.label ?? r.op
  const v = r.op === 'between' ? `${fmt(r.value, def)} – ${fmt(r.value2, def)}` : fmt(r.value, def)
  return `${def.label} ${op} ${v}`
}

// ---- sort editor ---------------------------------------------------------
const sortPop = ref<InstanceType<typeof Popover>>()
const sortLabel = (s: SortKey) => `${byKey.value.get(s.field)?.label ?? s.field} ${s.dir === 'asc' ? '↑' : '↓'}`
function addSort() {
  const used = new Set(sorts.value.map((s) => s.field))
  const f = props.fields.find((x) => !used.has(x.key)) ?? props.fields[0]!
  sorts.value = [...sorts.value, { field: f.key, dir: f.type === 'date' || f.type === 'number' ? 'desc' : 'asc' }]
}
const setSort = (i: number, patch: Partial<SortKey>) => (sorts.value = sorts.value.map((s, j) => (j === i ? { ...s, ...patch } : s)))
function moveSort(i: number, d: number) {
  const a = [...sorts.value]
  const j = i + d
  if (j < 0 || j >= a.length) return
  ;[a[i], a[j]] = [a[j]!, a[i]!]
  sorts.value = a
}
function openSort(e: Event) {
  if (!sorts.value.length) addSort()
  sortPop.value!.toggle(e)
}
const clearAll = () => ((rules.value = []), (sorts.value = []), (search.value = ''))
</script>

<template>
  <div class="bar">
    <InputText v-model="search" placeholder="Search names…" class="search" />
    <Button label="Filter" icon="pi pi-filter" size="small" severity="secondary" @click="openFilter($event)" />
    <Button label="Sort" icon="pi pi-sort-amount-down" size="small" severity="secondary" @click="openSort($event)" />
    <slot />
  </div>
  <div v-if="rules.length || sorts.length" class="chips">
    <Chip v-for="r in rules" :key="r.id" removable class="chip" @click="openFilter($event, r)" @remove="removeRule(r.id)">
      <span class="lbl"><i class="pi pi-filter" /> {{ describe(r) }}</span>
    </Chip>
    <Chip v-if="sorts.length" class="chip sortchip" @click="sortPop!.toggle($event)">
      <span class="lbl"><i class="pi pi-sort-amount-down" /> {{ sorts.map(sortLabel).join('  ›  ') }}</span>
    </Chip>
    <Button label="Clear all" size="small" text severity="secondary" @click="clearAll" />
    <span v-if="measuring && measuring.done < measuring.total" class="meas"><i class="pi pi-spin pi-spinner" /> measuring images {{ measuring.done }}/{{ measuring.total }}</span>
  </div>

  <Popover ref="filterPop">
    <div class="pop">
      <Select :model-value="draft.field" :options="fieldOptions" option-label="label" option-value="value" :disabled="editing" @update:model-value="pickField" />
      <template v-if="draftDef">
        <Select v-if="draftDef.type !== 'bool'" v-model="draft.op" :options="draftOps" option-label="label" option-value="op" />
        <MultiSelect v-if="draftDef.type === 'multi'" v-model="draft.value" :options="draftDef.options" filter placeholder="Choose…" display="chip" class="val" />
        <ToggleSwitch v-else-if="draftDef.type === 'bool'" v-model="draft.value" />
        <InputText v-else-if="draftDef.type === 'text'" v-model="draft.value" class="val" @keyup.enter="saveFilter" />
        <template v-else-if="draftDef.type === 'date'">
          <DatePicker :model-value="asDate(draft.value)" date-format="yy-mm-dd" show-icon @update:model-value="(d: any) => (draft.value = dayStart(d))" />
          <DatePicker v-if="draft.op === 'between'" :model-value="asDate(draft.value2)" date-format="yy-mm-dd" show-icon @update:model-value="(d: any) => (draft.value2 = dayStart(d))" />
        </template>
        <template v-else>
          <InputNumber v-model="draft.value" :use-grouping="false" class="val" @keyup.enter="saveFilter" />
          <InputNumber v-if="draft.op === 'between'" v-model="draft.value2" :use-grouping="false" class="val" />
        </template>
      </template>
      <Button :label="editing ? 'Update' : 'Add filter'" size="small" icon="pi pi-check" @click="saveFilter" />
    </div>
  </Popover>

  <Popover ref="sortPop">
    <div class="pop sorts">
      <div v-for="(s, i) in sorts" :key="i" class="srow">
        <span class="n">{{ i === 0 ? 'Sort by' : 'then' }}</span>
        <Select :model-value="s.field" :options="fieldOptions" option-label="label" option-value="value" @update:model-value="(v: string) => setSort(i, { field: v })" />
        <Button :icon="s.dir === 'asc' ? 'pi pi-sort-amount-up-alt' : 'pi pi-sort-amount-down'" size="small" severity="secondary" :title="s.dir === 'asc' ? 'Ascending' : 'Descending'" @click="setSort(i, { dir: s.dir === 'asc' ? 'desc' : 'asc' })" />
        <Button icon="pi pi-arrow-up" size="small" text severity="secondary" :disabled="i === 0" @click="moveSort(i, -1)" />
        <Button icon="pi pi-arrow-down" size="small" text severity="secondary" :disabled="i === sorts.length - 1" @click="moveSort(i, 1)" />
        <Button icon="pi pi-times" size="small" text severity="secondary" @click="sorts = sorts.filter((_, j) => j !== i)" />
      </div>
      <Button label="Add sort level" icon="pi pi-plus" size="small" text @click="addSort" />
    </div>
  </Popover>
</template>

<style scoped>
.bar { display: flex; flex-wrap: wrap; gap: 0.6rem; align-items: center; flex: 1; }
.search { width: 14rem; }
.chips { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; flex-basis: 100%; }
.chip { cursor: pointer; font-size: 0.85rem; }
.lbl { display: inline-flex; gap: 0.4rem; align-items: center; padding: 0.15rem 0; }
.lbl i { font-size: 0.75rem; opacity: 0.7; }
.sortchip { background: var(--p-surface-800); }
.meas { opacity: 0.7; font-size: 0.85rem; }
.pop { display: flex; flex-direction: column; gap: 0.6rem; min-width: 16rem; }
.val { width: 100%; }
.srow { display: flex; gap: 0.4rem; align-items: center; }
.srow .n { width: 4rem; opacity: 0.7; font-size: 0.85rem; }
</style>
