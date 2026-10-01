import type { Object3D } from 'three'

export interface CategoryDef {
  id: string
  label: string
  icon: string
  count: number
  /** Sidebar section heading. */
  group?: string
}

export type FieldValue = string | string[] | boolean | number

export interface CosmeticItem {
  id: string
  name: string
  category: string
  /** Provider-specific fields; filters read from these. */
  fields: Record<string, FieldValue>
  /** How the item renders: a 3D model, a flat image, or a non-visual file. */
  render: '3d' | 'image' | 'file'
  /** Card thumbnail for a 3D item: its image ('image'), or just the name ('none'); default is the live model. */
  thumb?: 'image' | 'none'
}

export type FieldType = 'text' | 'number' | 'date' | 'multi' | 'bool'

/** A field of the items that can be filtered and/or sorted. `name` is read from `item.name`, the rest from `item.fields`. */
export interface FieldDef {
  key: string
  label: string
  type: FieldType
  /** Known values for `multi` fields. */
  options?: string[]
  /** Measured lazily (see `ensureDimensions`); unknown until then. */
  lazy?: boolean
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
  /** Playback control for timed animations (emotes); times in seconds. */
  timeline?: Timeline
  dispose: () => void
}

export interface Timeline {
  readonly duration: number
  readonly time: number
  paused: boolean
  seek(seconds: number): void
}

/** A file listed in the CDN index, for the raw file browser. */
export interface IndexedFile {
  /** Name shown on the cosmetic card for this file (or one derived from the path). */
  name: string
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
  fields(category: string): FieldDef[]
  items(category: string): CosmeticItem[]
  imageUrl(item: CosmeticItem): Promise<string>
  /** Frame layout (px) for stacked-frame images, if the item is animated. */
  imageFrames?(item: CosmeticItem): Promise<{ frameW?: number; frameH?: number; frametimeMs: number } | undefined>
  /** `raw` keeps player-space coordinates (unfitted) for dressing a player. */
  loadModel(item: CosmeticItem, opts?: { raw?: boolean }): Promise<LoadedModel>
  /** A player wearing `items`, optionally playing an emote item. */
  dressPlayer?(items: CosmeticItem[], emote?: CosmeticItem): Promise<LoadedModel>
  /** Looks up any item by id (deep links, collections). */
  itemById?(id: string): CosmeticItem | undefined
  /** Non-visual file items. */
  rawFile?(item: CosmeticItem): Promise<RawFile>
  /** Every file in the CDN index. */
  indexedFiles?(): IndexedFile[]
  /** The item to open in the modal for an indexed file (its owning cosmetic, or the file itself). */
  fileItem?(path: string): CosmeticItem
  /** Catalog statistics for the footer. */
  stats?(): { items: number; files: number; indexes: string[] }
  /** Measures the lazy fields (image width/height) of the items; resolves when done. */
  ensureDimensions?(items: CosmeticItem[], onProgress: (done: number, total: number) => void, signal: AbortSignal): Promise<void>
  /** Metadata lines shown in the modal. */
  info?(item: CosmeticItem): Record<string, string>
}
