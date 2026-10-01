/** Runs async tasks with a concurrency cap so a big grid does not flood the network. */
export function createQueue(limit: number) {
  let active = 0
  const waiting: (() => void)[] = []
  const next = () => {
    active--
    waiting.shift()?.()
  }
  return async function run<T>(task: () => Promise<T>): Promise<T> {
    if (active >= limit) await new Promise<void>((r) => waiting.push(r))
    active++
    try {
      return await task()
    } finally {
      next()
    }
  }
}
