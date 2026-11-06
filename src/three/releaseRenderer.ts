import type { WebGLRenderer } from 'three'

/**
 * dispose() frees three's resources but not the WebGL context, which stays until garbage collection. Browsers
 * allow about 16 at a time and then kill the oldest, which is the thumbnail grid's: give it back right away.
 */
export function releaseRenderer(renderer: WebGLRenderer) {
  renderer.dispose()
  renderer.forceContextLoss()
  renderer.domElement.remove()
}
