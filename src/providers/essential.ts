import type { CosmeticProvider } from './types'

// Placeholder: Essential Mod uses different files/models/fields, so it gets its own provider later.
export const essentialProvider: CosmeticProvider = {
  id: 'essential',
  name: 'Essential',
  available: false,
  load: async () => {},
  categories: () => [],
  fields: () => [],
  items: () => [],
  imageUrl: () => Promise.reject(new Error('Essential is not supported yet')),
  loadModel: () => Promise.reject(new Error('Essential is not supported yet')),
}
