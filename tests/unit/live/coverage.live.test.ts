// Live: every file on the real CDN is an item, an item's dependency, or a listed resource.
import { describe, expect, it } from 'vitest'
// @ts-expect-error plain JS helper shared with the CLI
import { classify } from '../../../scripts/coverageLib.mjs'

describe('live CDN coverage', () => {
  it('leaves no file unclaimed', { timeout: 900_000 }, async () => {
    const { files, claim, left } = (await classify()) as { files: Map<string, string>; claim: Map<string, string>; left: string[] }
    expect(files.size).toBeGreaterThan(5000)
    expect(claim.size).toBe(files.size)
    expect(left).toEqual([])
  })
})
