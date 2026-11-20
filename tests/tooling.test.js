import { readFileSync, statSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

describe('deployment assets and supported runtime', () => {
  it('ships a small, high-DPI header logo instead of the full-size source image', () => {
    const path = new URL('../src/rp2040/assets/logo.png', import.meta.url)
    const png = readFileSync(path)
    expect(statSync(path).size).toBeLessThan(30_000)
    expect(png.readUInt32BE(20)).toBe(96)
  })

  it('resolves manifest icons inside whatever project subdirectory the site is deployed to', () => {
    const manifest = JSON.parse(read('public/site.webmanifest'))
    expect(manifest.name).toBe('Web Flasher')
    for (const icon of manifest.icons) {
      expect(new URL(icon.src, 'https://example.com/web_flasher/site.webmanifest').pathname)
        .toMatch(/^\/web_flasher\//)
    }
    expect(read('vite.config.js')).toMatch(/base: '\.\/'/)
  })

  it('advertises only MicroPython on the RP2040 page and supplies a self-hosted production CSP on every page', () => {
    expect(read('rp2040/index.html')).toContain('MicroPython')
    for (const page of ['index.html', 'rp2040/index.html', 'esp-mosaico/index.html']) {
      const html = read(page)
      expect(html).toContain('http-equiv="Content-Security-Policy"')
      expect(html).toContain("object-src 'none'")
      expect(html).toContain("base-uri 'self'")
    }
    expect(read('README.md')).not.toMatch(/running MicroPython or CircuitPython/)
  })

  it('links the landing page to both flashers with relative URLs', () => {
    const html = read('index.html')
    expect(html).toContain('href="rp2040/"')
    expect(html).toContain('href="esp-mosaico/"')
  })
})
