import { dawnProvider } from './dawn'
import { essentialProvider } from './essential'
import { lunarProvider } from './lunar'
import type { CosmeticProvider } from './types'

export const providers: Record<string, CosmeticProvider> = {
  lunar: lunarProvider,
  dawn: dawnProvider,
  essential: essentialProvider,
}
