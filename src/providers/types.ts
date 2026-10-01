import type { Object3D } from 'three'

export interface CategoryDef {
  id: string
  label: string
  icon: string
  count: number
}

export type FieldValue = string | string[] | boolean

export interface CosmeticItem {
  id: string
  name: string
  category: string
  /** Provider-specific fields; filters read from these. */
  fields: Record<string, FieldValue>
  /** How the item renders: a 3D model or just a flat image. */
  render: '3d' | 'image'
}

export interface FilterDef {
  key: string
  label: string
  type: 'multi' | 'toggle'
  options?: string[]
}

export interface DownloadFile {
  name: string
  data: Uint8Array
}

export interface LoadedModel {
  object: Object3D
  /** Raw source files, used for the zip download. */
  files: DownloadFile[]
  /** Texture frame count; >1 means an animated (vertically stacked) texture. */
  frames: number
  /** Advances animated textures; call every frame with a time in ms. */
  tick: (ms: number) => void
  dispose: () => void
}

export interface CosmeticProvider {
  id: string
  name: string
  available: boolean
  load(): Promise<void>
  categories(): CategoryDef[]
  filters(category: string): FilterDef[]
  items(category: string): CosmeticItem[]
  imageUrl(item: CosmeticItem): Promise<string>
  loadModel(item: CosmeticItem): Promise<LoadedModel>
}
