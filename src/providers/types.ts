import type { Object3D } from 'three'

export interface CategoryDef {
  id: string
  label: string
  icon: string
  count: number
  /** Sidebar section heading. */
  group?: string
}

export type FieldValue = string | string[] | boolean

export interface CosmeticItem {
  id: string
  name: string
  category: string
  /** Provider-specific fields; filters read from these. */
  fields: Record<string, FieldValue>
  /** How the item renders: a 3D model, a flat image, or a non-visual file. */
  render: '3d' | 'image' | 'file'
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
  /** Advances texture frames and bone animation; call every frame with a time in ms. */
  tick: (ms: number) => void
  /** Animation states available for this model (e.g. idle, moving). */
  states: string[]
  state: string
  setState: (state: string) => void
  dispose: () => void
}

/** A file listed in the CDN index, for the raw file browser. */
export interface IndexedFile {
  path: string
  hash: string
  size: number
}

export interface RawFile {
  name: string
  url: string
  /** Decoded text if the file is text-like. */
  text?: string
  size: number
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
  /** Frame layout (px) for stacked-frame images, if the item is animated. */
  imageFrames?(item: CosmeticItem): Promise<{ frameW?: number; frameH?: number; frametimeMs: number } | undefined>
  loadModel(item: CosmeticItem): Promise<LoadedModel>
  /** Non-visual file items. */
  rawFile?(item: CosmeticItem): Promise<RawFile>
  /** Every file in the CDN index. */
  indexedFiles?(): IndexedFile[]
  /** Metadata lines shown in the modal. */
  info?(item: CosmeticItem): Record<string, string>
}
