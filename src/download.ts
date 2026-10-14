import { zipSync } from 'fflate'
import type { DownloadFile } from './providers/types'

export function zipFiles(files: DownloadFile[]): Uint8Array<ArrayBuffer> {
  return zipSync(Object.fromEntries(files.map((f) => [f.name, f.data]))) as Uint8Array<ArrayBuffer>
}

export function download(name: string, data: BlobPart, type = 'application/octet-stream') {
  const url = URL.createObjectURL(new Blob([data], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
