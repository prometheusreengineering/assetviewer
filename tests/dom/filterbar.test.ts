import { describe, expect, it } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import FilterBar from '../../src/components/FilterBar.vue'
import type { Rule, SortKey } from '../../src/filtering'
import type { FieldDef } from '../../src/providers/types'
import { $, $$, byText, mountApp, press, settle } from '../helpers/mount'

const FIELDS: FieldDef[] = [
  { key: 'name', label: 'Name', type: 'text' },
  { key: 'size', label: 'Size', type: 'number' },
  { key: 'released', label: 'Released', type: 'date' },
  { key: 'themes', label: 'Theme', type: 'multi', options: ['A', 'B'] },
  { key: 'animated', label: 'Animated', type: 'bool' },
]

/** FilterBar with its three v-models in a host component. */
async function mountBar(init: { rules?: Rule[]; sorts?: SortKey[]; search?: string; measuring?: { done: number; total: number } } = {}) {
  const search = ref(init.search ?? '')
  const rules = ref<Rule[]>(init.rules ?? [])
  const sorts = ref<SortKey[]>(init.sorts ?? [])
  const Host = defineComponent({
    setup: () => () =>
      h(
        FilterBar,
        {
          fields: FIELDS,
          measuring: init.measuring,
          search: search.value,
          'onUpdate:search': (v: string) => (search.value = v),
          rules: rules.value,
          'onUpdate:rules': (v: Rule[]) => (rules.value = v),
          sorts: sorts.value,
          'onUpdate:sorts': (v: SortKey[]) => (sorts.value = v),
        },
        { default: () => h('span', { class: 'slotted' }, 'extra') },
      ),
  })
  const { wrapper } = await mountApp(Host)
  return { wrapper, search, rules, sorts }
}
const chips = () => $$('.chip:not(.sortchip) .lbl').map((e) => e.textContent!.trim())

describe('FilterBar', () => {
  it('search box drives the search model; the slot renders in the bar', async () => {
    const { wrapper, search } = await mountBar()
    await wrapper.find('input.search').setValue('crown')
    expect(search.value).toBe('crown')
    expect(wrapper.find('.bar .slotted').exists()).toBe(true)
    expect(wrapper.find('.chips').exists()).toBe(false)
    wrapper.unmount()
  })

  it('describes rules of every type as chips', async () => {
    const day = Date.UTC(2024, 0, 2)
    const { wrapper } = await mountBar({
      rules: [
        { id: 1, field: 'name', op: 'contains', value: 'gold' },
        { id: 2, field: 'size', op: 'between', value: 1000, value2: 2000 },
        { id: 3, field: 'released', op: 'gt', value: day },
        { id: 4, field: 'themes', op: 'none', value: ['A', 'B'] },
        { id: 5, field: 'animated', op: 'is', value: false },
        { id: 6, field: 'size', op: 'eq', value: null },
        { id: 7, field: 'themes', op: 'any', value: [] },
        { id: 8, field: 'gone', op: 'eq', value: 1 },
      ],
    })
    expect(chips()).toEqual([
      'Name contains gold',
      `Size between ${(1000).toLocaleString()} – ${(2000).toLocaleString()}`,
      'Released after 2024-01-02',
      'Theme none of A, B',
      'Animated: no',
      'Size = …',
      'Theme any of …',
      'gone',
    ])
    wrapper.unmount()
  })

  it('adds a filter through the popover', async () => {
    const { wrapper, rules } = await mountBar()
    press(byText('Filter', 'button'))
    await settle(10)
    expect($('.p-popover .pop')).toBeTruthy()
    const input = $<HTMLInputElement>('.p-popover input.val')!
    input.value = 'hat'
    input.dispatchEvent(new Event('input'))
    await nextTick()
    press(byText('Add filter', 'button'))
    await settle()
    expect(rules.value).toEqual([{ id: 1, field: 'name', op: 'contains', value: 'hat' }])
    expect(chips()).toEqual(['Name contains hat'])
    wrapper.unmount()
  })

  it('editing a chip updates that rule; ids continue after linked rules', async () => {
    const { wrapper, rules } = await mountBar({ rules: [{ id: 7, field: 'name', op: 'contains', value: 'a' }] })
    press($('.chip .lbl'))
    await settle(10)
    expect(byText('Update', 'button')).toBeTruthy()
    const input = $<HTMLInputElement>('.p-popover input.val')!
    input.value = 'b'
    input.dispatchEvent(new Event('input'))
    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter' }))
    await settle()
    expect(rules.value).toEqual([{ id: 7, field: 'name', op: 'contains', value: 'b' }])
    press(byText('Filter', 'button'))
    await settle(10)
    press(byText('Add filter', 'button'))
    await settle()
    expect(rules.value.map((r) => r.id)).toEqual([7, 8])
    wrapper.unmount()
  })

  it('removing a chip drops its rule without opening the editor; Clear all resets everything', async () => {
    const { wrapper, rules, sorts, search } = await mountBar({
      search: 'x',
      rules: [
        { id: 1, field: 'name', op: 'contains', value: 'a' },
        { id: 2, field: 'animated', op: 'is', value: true },
      ],
      sorts: [{ field: 'size', dir: 'desc' }],
    })
    press($('.chip .p-chip-remove-icon'))
    await settle(10)
    expect(rules.value.map((r) => r.id)).toEqual([2])
    expect($('.p-popover')).toBeNull()
    press(byText('Clear all', 'button'))
    await settle()
    expect(rules.value).toEqual([])
    expect(sorts.value).toEqual([])
    expect(search.value).toBe('')
    wrapper.unmount()
  })

  it('sort: opening adds a first level; levels can flip, move and be removed', async () => {
    const { wrapper, sorts } = await mountBar()
    press(byText('Sort', 'button'))
    await settle(10)
    expect(sorts.value).toEqual([{ field: 'name', dir: 'asc' }])
    // the next unused field: size (number) sorts descending by default
    press(byText('Add sort level', 'button'))
    await settle()
    expect(sorts.value).toEqual([
      { field: 'name', dir: 'asc' },
      { field: 'size', dir: 'desc' },
    ])
    expect($('.sortchip')!.textContent).toContain('Name ↑  ›  Size ↓')
    const row = (i: number) => $$('.srow')[i]!
    press(row(0).querySelector('button[title="Ascending"]'))
    await settle()
    expect(sorts.value[0]!.dir).toBe('desc')
    press(row(1).querySelector('.pi-arrow-up')!.closest('button'))
    await settle()
    expect(sorts.value.map((s) => s.field)).toEqual(['size', 'name'])
    press(row(1).querySelector('.pi-times')!.closest('button'))
    await settle()
    expect(sorts.value).toEqual([{ field: 'size', dir: 'desc' }])
    wrapper.unmount()
  })

  it('shows image measuring progress until done', async () => {
    const a = await mountBar({ rules: [{ id: 1, field: 'size', op: 'gt', value: 1 }], measuring: { done: 3, total: 10 } })
    expect(a.wrapper.find('.meas').text()).toContain('measuring images 3/10')
    a.wrapper.unmount()
    const b = await mountBar({ rules: [{ id: 1, field: 'size', op: 'gt', value: 1 }], measuring: { done: 10, total: 10 } })
    expect(b.wrapper.find('.meas').exists()).toBe(false)
    b.wrapper.unmount()
  })
})
