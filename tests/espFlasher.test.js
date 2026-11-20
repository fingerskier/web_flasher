import { describe, expect, it, vi } from 'vitest'
import { BOARD, checkImageChip, flashImages, guessOffset, identifyBoard, parseFlasherArgs, parseOffset, planImages, readBuildFolder } from '../src/esp/flasher.js'
import { md5 } from '../src/esp/md5.js'

const bytes = text => new TextEncoder().encode(text)
const file = (data, name = 'app.bin') => ({ name, size: data.length, arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), text: async () => new TextDecoder().decode(data) })
const espImage = (chipId, length = 64) => { const data = new Uint8Array(length); data[0] = 0xe9; data[12] = chipId; return data }
const CHIP = { CHIP_NAME: 'ESP32-S31', IMAGE_CHIP_ID: 32 }
const ARGS = JSON.stringify({
  flash_settings: { flash_mode: 'dio', flash_size: '16MB', flash_freq: '80m' },
  flash_files: { '0x2000': 'bootloader/bootloader.bin', '0x8000': 'partition_table/partition-table.bin', '0x10000': 'pbm_mosaico.bin' },
  extra_esptool_args: { chip: 'esp32s31', stub: false },
})

function fakeEsptool({ chip = CHIP, main, writeFlash, after } = {}) {
  const calls = { writes: [], after: [], disconnects: 0 }
  class Transport { constructor(port) { this.port = port } async disconnect() { calls.disconnects++ } }
  class ESPLoader {
    constructor(options) { this.options = options; calls.loader = this }
    async main() { if (main) await main(this); this.chip = chip; this.options.terminal.writeLine('Chip is fake'); return 'ESP32-S31 (fake)' }
    async writeFlash(options) { calls.writes.push(options); if (writeFlash) await writeFlash(options) }
    async after(mode) { calls.after.push(mode); if (after) await after() }
  }
  return { esptool: { Transport, ESPLoader }, calls }
}
const serial = () => ({ requestPort: vi.fn(async () => ({})) })

describe('md5', () => {
  it('matches RFC 1321 vectors across block boundaries', () => {
    expect(md5(bytes(''))).toBe('d41d8cd98f00b204e9800998ecf8427e')
    expect(md5(bytes('abc'))).toBe('900150983cd24fb0d6963f7d28e17f72')
    expect(md5(bytes('message digest'))).toBe('f96b697d7cb7938d525a2f31aaf161d0')
    expect(md5(bytes('12345678901234567890123456789012345678901234567890123456789012345678901234567890'))).toBe('57edf4a22be3c955ac49da2e2107b67a')
    expect(md5(bytes('a'.repeat(56)))).toBe('3b0c8ac703f828b04c6c197006d17218')
  })
})

describe('offsets and plans', () => {
  it('accepts sector-aligned hex or decimal offsets and rejects the rest', () => {
    expect(parseOffset('0x10000')).toBe(0x10000)
    expect(parseOffset(' 8192 ')).toBe(0x2000)
    for (const bad of ['', 'abc', '0x', '-4096', '0x1001', '1e5', '0x8000000']) expect(() => parseOffset(bad)).toThrow()
  })
  it('guesses ESP32-S31 default offsets from file names', () => {
    expect(guessOffset('bootloader.bin')).toBe(BOARD.bootloaderOffset)
    expect(guessOffset('partition-table.bin')).toBe(BOARD.partitionTableOffset)
    expect(guessOffset('pbm_mosaico.bin')).toBe(BOARD.appOffset)
    expect(guessOffset('merged-flash.bin')).toBe(0)
  })
  it('sorts images and rejects empty sets, empty files and sector overlaps', () => {
    const image = (address, size, name) => ({ name, address, file: { size } })
    expect(planImages([image(0x10000, 10, 'app'), image(0x2000, 10, 'boot')]).map(i => i.name)).toEqual(['boot', 'app'])
    expect(() => planImages([])).toThrow(/at least one/)
    expect(() => planImages([image(0x2000, 0, 'boot')])).toThrow(/empty/)
    expect(() => planImages([image(0x2000, 0x6001, 'boot'), image(0x8000, 10, 'table')])).toThrow(/overlaps/)
    expect(() => planImages([image(0x2000, 0x6000, 'boot'), image(0x8000, 10, 'table')])).not.toThrow()
  })
})

describe('ESP-IDF build folder', () => {
  it('reads offsets and chip from flasher_args.json', () => {
    const args = parseFlasherArgs(ARGS)
    expect(args.files).toEqual([
      { address: 0x2000, path: 'bootloader/bootloader.bin' },
      { address: 0x8000, path: 'partition_table/partition-table.bin' },
      { address: 0x10000, path: 'pbm_mosaico.bin' },
    ])
    expect(args.chip).toBe('esp32s31')
  })
  it('refuses builds for other chips and malformed files', () => {
    expect(() => parseFlasherArgs(JSON.stringify({ flash_files: { '0x0': 'a.bin' }, extra_esptool_args: { chip: 'esp32s3' } }))).toThrow(/esp32s3/)
    expect(() => parseFlasherArgs('{')).toThrow(/valid JSON/)
    expect(() => parseFlasherArgs('{}')).toThrow(/no flash files/)
  })
  const directory = tree => ({
    async getFileHandle(name) { if (!(tree[name] instanceof Uint8Array)) throw new DOMException('missing', 'NotFoundError'); return { getFile: async () => file(tree[name], name) } },
    async getDirectoryHandle(name) { if (!tree[name] || tree[name] instanceof Uint8Array) throw new DOMException('missing', 'NotFoundError'); return directory(tree[name]) },
  })
  it('resolves nested image paths inside the chosen folder', async () => {
    const build = await readBuildFolder(directory({
      'flasher_args.json': bytes(ARGS), 'pbm_mosaico.bin': espImage(32),
      bootloader: { 'bootloader.bin': espImage(32) }, partition_table: { 'partition-table.bin': new Uint8Array(8) },
    }))
    expect(build.images.map(i => [i.name, i.address, i.file.size])).toEqual([
      ['bootloader/bootloader.bin', 0x2000, 64], ['partition_table/partition-table.bin', 0x8000, 8], ['pbm_mosaico.bin', 0x10000, 64],
    ])
  })
  it('explains a wrong folder, a missing image and a path escape', async () => {
    await expect(readBuildFolder(directory({}))).rejects.toThrow(/build\/ directory/)
    await expect(readBuildFolder(directory({ 'flasher_args.json': bytes(ARGS) }))).rejects.toThrow(/bootloader\/bootloader.bin is missing/)
    const escape = JSON.stringify({ flash_files: { '0x0': '../secret.bin' } })
    await expect(readBuildFolder(directory({ 'flasher_args.json': bytes(escape) }))).rejects.toThrow(/outside the build folder/)
  })
})

describe('image chip check', () => {
  it('accepts matching headers, skips non-images and rejects other chips', () => {
    expect(checkImageChip(espImage(32), { name: 'app', address: 0x10000 }, CHIP)).toBe(true)
    expect(checkImageChip(new Uint8Array(64), { name: 'table', address: 0x8000 }, CHIP)).toBe(false)
    expect(() => checkImageChip(espImage(9), { name: 'app', address: 0x10000 }, CHIP)).toThrow(/different chip/)
  })
  it('finds the bootloader header inside a merged image', () => {
    const merged = new Uint8Array(0x2040).fill(0xff)
    merged.set(espImage(9), 0x2000)
    expect(() => checkImageChip(merged, { name: 'merged', address: 0 }, CHIP)).toThrow(/different chip/)
    merged.set(espImage(32), 0x2000)
    expect(checkImageChip(merged, { name: 'merged', address: 0 }, CHIP)).toBe(true)
  })
  it('rejects a merged image laid out for a chip whose bootloader sits at another offset', () => {
    for (const offset of [0, 0x1000]) {
      const merged = new Uint8Array(0x2040).fill(0xff)
      merged.set(espImage(9), offset)
      expect(() => checkImageChip(merged, { name: 'merged', address: 0 }, CHIP)).toThrow(/different chip/)
    }
  })
})

describe('flash session', () => {
  const images = () => [{ name: 'app.bin', address: 0x10000, file: file(espImage(32)) }, { name: 'boot.bin', address: 0x2000, file: file(espImage(32)) }]
  it('writes sorted images unmodified with MD5 verification, reports progress, resets and releases the port', async () => {
    const onProgress = vi.fn()
    const { esptool, calls } = fakeEsptool({ writeFlash: options => options.reportProgress(1, 5, 10) })
    const log = vi.fn()
    const result = await flashImages({ serial: serial(), esptool, log, images: images(), eraseAll: true, onProgress })
    expect(result).toEqual({ status: 'success', chip: 'ESP32-S31 (fake)', resetRequested: true })
    const [write] = calls.writes
    expect(write.fileArray.map(f => f.address)).toEqual([0x2000, 0x10000])
    expect(write).toMatchObject({ flashMode: 'keep', flashFreq: 'keep', flashSize: 'keep', eraseAll: true, compress: true })
    expect(write.calculateMD5Hash(bytes('abc'))).toBe('900150983cd24fb0d6963f7d28e17f72')
    expect(onProgress).toHaveBeenCalledWith({ index: 1, count: 2, name: 'app.bin', completed: 5, total: 10 })
    expect(calls.after).toEqual(['hard_reset'])
    expect(calls.disconnects).toBe(1)
    expect(log).toHaveBeenCalledWith('Chip is fake\n')
  })
  it('validates the plan before asking for a port', async () => {
    const port = serial()
    await expect(flashImages({ serial: port, esptool: fakeEsptool().esptool, log: vi.fn(), images: [] })).rejects.toThrow(/at least one/)
    expect(port.requestPort).not.toHaveBeenCalled()
  })
  it('treats a dismissed port picker as a cancellation', async () => {
    const port = { requestPort: vi.fn(async () => { throw new DOMException('No port selected', 'NotFoundError') }) }
    expect(await flashImages({ serial: port, esptool: fakeEsptool().esptool, log: vi.fn(), images: images() })).toEqual({ status: 'cancelled' })
  })
  it('refuses a different chip without writing, and restarts it', async () => {
    const { esptool, calls } = fakeEsptool({ chip: { CHIP_NAME: 'ESP32-S3', IMAGE_CHIP_ID: 9 } })
    await expect(flashImages({ serial: serial(), esptool, log: vi.fn(), images: images() })).rejects.toThrow(/ESP32-S3, not ESP32-S31/)
    expect(calls.writes).toEqual([])
    expect(calls.after).toEqual(['hard_reset'])
    expect(calls.disconnects).toBe(1)
  })
  it('refuses images built for another chip without writing', async () => {
    const { esptool, calls } = fakeEsptool()
    const wrong = [{ name: 'app.bin', address: 0x10000, file: file(espImage(9)) }]
    await expect(flashImages({ serial: serial(), esptool, log: vi.fn(), images: wrong })).rejects.toThrow(/different chip/)
    expect(calls.writes).toEqual([])
    expect(calls.disconnects).toBe(1)
  })
  it('reports a failed write as possibly partial and does not reset into broken firmware', async () => {
    const { esptool, calls } = fakeEsptool({ writeFlash: () => { throw new Error('MD5 of file does not match data in flash!') } })
    await expect(flashImages({ serial: serial(), esptool, log: vi.fn(), images: images() })).rejects.toThrow(/MD5.*partly written/)
    expect(calls.after).toEqual([])
    expect(calls.disconnects).toBe(1)
  })
  it('explains bootloader connection failures and still releases the port', async () => {
    const { esptool, calls } = fakeEsptool({ main: () => { throw new Error('Failed to connect with the device') } })
    await expect(identifyBoard({ serial: serial(), esptool, log: vi.fn() })).rejects.toThrow(/Failed to connect.*choose the new port.*hold BOOT/)
    expect(calls.disconnects).toBe(1)
  })
  it('reports success with a failed reset request separately', async () => {
    const { esptool } = fakeEsptool({ after: () => { throw new Error('port gone') } })
    const log = vi.fn()
    expect(await identifyBoard({ serial: serial(), esptool, log })).toEqual({ status: 'success', chip: 'ESP32-S31 (fake)', resetRequested: false })
    expect(log).toHaveBeenCalledWith('Reset request failed: port gone\n')
  })
})
