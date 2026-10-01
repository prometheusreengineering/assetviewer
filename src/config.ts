// Base URL of the asset CDN. Point VITE_CDN_BASE at the Cloudflare Worker proxy in production.
export const CDN_BASE: string = import.meta.env.VITE_CDN_BASE ?? 'https://textures.lunarclientcdn.com'

// Root indexes of the Lunar Client CDN (text files: `path sha1 size mtime` per line).
export const LUNAR_INDEXES: string[] = [
  '8a23771c424b9d0ada1e6ba339d70dec72e75fd7',
  'fd50b83af05c7cb6fc8cc886fed06f5e1ee16b1f',
]
