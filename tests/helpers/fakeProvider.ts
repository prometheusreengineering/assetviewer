import { Group, Mesh, BoxGeometry, MeshBasicMaterial } from 'three'
import { vi } from 'vitest'
import type { CosmeticItem, CosmeticProvider, LoadedModel } from '../../src/providers/types'

/** A loaded model with one box; records tick/dispose calls. */
export function fakeModel(extra: Partial<LoadedModel> = {}): LoadedModel {
  const object = new Group()
  object.add(new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial()))
  return { object, files: [{ name: 'a.webp', data: new Uint8Array([1]) }], frames: 1, tick: vi.fn(), states: [], state: '', setState: vi.fn(), dispose: vi.fn(), ...extra }
}

export const ITEMS: CosmeticItem[] = [
  { id: 'm1', name: 'Model One', category: 'hat', render: '3d', fields: { category: 'Hats', type: '3D', ext: 'json', size: 2048 } },
  { id: 'i1', name: 'Image One', category: 'hat', render: 'image', fields: { category: 'Hats', type: '2D', ext: 'png', size: 10, animated: true } },
  { id: 'f1', name: 'File One', category: 'data', render: 'file', fields: { category: 'Data', type: 'File', ext: 'json', size: 0 } },
  { id: 'e1', name: 'Emote One', category: 'emotes', render: '3d', thumb: 'none', fields: { category: 'Emotes', type: '3D' } },
]

/** A provider over a fixed item list with spies for everything the components call. */
export function fakeProvider(items: CosmeticItem[] = ITEMS): CosmeticProvider & { [k: string]: any } {
  const byId = new Map(items.map((i) => [i.id, i]))
  return {
    id: 'lunar',
    name: 'Fake',
    available: true,
    load: vi.fn(async () => {}),
    categories: () => [],
    fields: () => [{ key: 'name', label: 'Name', type: 'text' }],
    items: (c: string) => items.filter((i) => i.category === c),
    imageUrl: vi.fn(async (it: CosmeticItem) => `blob:${it.id}`),
    imageFrames: vi.fn(async () => ({ frametimeMs: 100 })),
    loadModel: vi.fn(async () => fakeModel()),
    sourceFiles: vi.fn(async (it: CosmeticItem) => [{ name: `${it.id}.png`, data: new Uint8Array([1, 2]) }, { name: 'model.json', data: new TextEncoder().encode('{}') }]),
    estimateSize: vi.fn(() => 1000),
    itemById: (id: string) => byId.get(id),
    rawFile: vi.fn(async (it: CosmeticItem) => ({ name: `${it.id}.json`, url: 'https://textures.lunarclientcdn.com/file/abc', text: '{"hello": 1}', size: 12 })),
    info: vi.fn((it: CosmeticItem) => ({ Type: it.render, Name: it.name })),
    ensureDimensions: vi.fn(async () => {}),
  }
}
