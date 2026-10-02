const UNITS = ['B', 'KB', 'MB', 'GB', 'TB']

/** 624931 -> "610.28 KB" (1024-based; whole bytes below 1 KB, otherwise 2 decimals). */
export function formatBytes(n: number): string {
  let v = Math.max(0, n)
  let i = 0
  while (v >= 1024 && i < UNITS.length - 1) {
    v /= 1024
    i++
  }
  return i === 0 ? `${Math.round(v)} B` : `${v.toFixed(2)} ${UNITS[i]}`
}
