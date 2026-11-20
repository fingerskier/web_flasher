import { md5 } from './md5.js'

// ESP-Mosaico: Espressif ESP32-S31 board. Offsets are the ESP-IDF defaults for this chip.
export const BOARD = {
  name: 'ESP-Mosaico',
  chip: 'esp32s31',
  chipName: 'ESP32-S31',
  bootloaderOffset: 0x2000,
  partitionTableOffset: 0x8000,
  appOffset: 0x10000,
}

const SECTOR = 0x1000
const MAX_FLASH = 128 * 1024 * 1024
const IMAGE_MAGIC = 0xe9
const chipKey = name => String(name ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
export const hex = value => `0x${value.toString(16)}`

export function parseOffset(text) {
  const value = String(text ?? '').trim()
  if (!/^(0x[0-9a-f]+|\d+)$/i.test(value)) throw new Error(`"${value}" is not a flash offset. Use hex such as 0x10000.`)
  const offset = Number(value)
  if (!Number.isSafeInteger(offset) || offset >= MAX_FLASH) throw new Error(`Offset ${value} is beyond the largest supported flash.`)
  if (offset % SECTOR) throw new Error(`Offset ${value} is not aligned to a 4 KiB flash sector.`)
  return offset
}

export function guessOffset(filename) {
  const name = String(filename).toLowerCase()
  if (/merged|factory|full/.test(name)) return 0
  if (/bootloader/.test(name)) return BOARD.bootloaderOffset
  if (/partition/.test(name)) return BOARD.partitionTableOffset
  return BOARD.appOffset
}

// Reads ESP-IDF's build/flasher_args.json.
export function parseFlasherArgs(text) {
  let args
  try { args = JSON.parse(text) } catch { throw new Error('flasher_args.json is not valid JSON.') }
  const entries = Object.entries(args?.flash_files ?? {})
  if (!entries.length) throw new Error('flasher_args.json lists no flash files.')
  const chip = args.extra_esptool_args?.chip
  if (chip && chipKey(chip) !== BOARD.chip) throw new Error(`This build targets ${chip}; this page only flashes ${BOARD.chipName} (${BOARD.name}).`)
  return {
    chip: chip ?? null,
    files: entries.map(([offset, path]) => ({ address: parseOffset(offset), path: String(path) })),
  }
}

async function fileAt(directory, path) {
  const parts = path.split('/')
  if (path.startsWith('/') || parts.some(part => !part || part === '.' || part === '..' || part.includes('\\'))) {
    throw new Error(`flasher_args.json refers to a file outside the build folder: ${path}`)
  }
  try {
    let current = directory
    for (const part of parts.slice(0, -1)) current = await current.getDirectoryHandle(part)
    return await (await current.getFileHandle(parts.at(-1))).getFile()
  } catch (error) {
    if (error?.name === 'NotFoundError') throw new Error(`${path} is missing from the build folder. Run the build first.`)
    throw error
  }
}

export async function readBuildFolder(directory) {
  let text
  try { text = await (await (await directory.getFileHandle('flasher_args.json')).getFile()).text() }
  catch (error) {
    if (error?.name === 'NotFoundError') throw new Error('No flasher_args.json in that folder. Choose the ESP-IDF build/ directory.')
    throw error
  }
  const { files, ...rest } = parseFlasherArgs(text)
  const images = []
  for (const { address, path } of files) images.push({ name: path, address, file: await fileAt(directory, path) })
  return { ...rest, images }
}

// Returns images sorted by address; throws on anything that would write an ambiguous or empty region.
export function planImages(images) {
  if (!images.length) throw new Error('Add at least one firmware image.')
  const plan = [...images].sort((a, b) => a.address - b.address)
  plan.forEach((image, i) => {
    if (!image.file.size) throw new Error(`${image.name} is empty.`)
    const end = Math.ceil((image.address + image.file.size) / SECTOR) * SECTOR
    if (end > MAX_FLASH) throw new Error(`${image.name} does not fit in flash.`)
    const next = plan[i + 1]
    if (next && end > next.address) throw new Error(`${image.name} (${hex(image.address)}) overlaps ${next.name} (${hex(next.address)}).`)
  })
  return plan
}

// Bootloader offsets across ESP chips; a merged image holds its first header at one of them.
const HEADER_OFFSETS = [0x0, 0x1000, 0x2000]

// An ESP image header carries the chip it was built for. Returns true when one was found and matches.
export function checkImageChip(data, image, chip) {
  const positions = new Set([0, ...HEADER_OFFSETS.map(offset => offset - image.address).filter(at => at > 0)])
  let found = false
  for (const at of positions) {
    if (data.length < at + 16 || data[at] !== IMAGE_MAGIC) continue
    const id = data[at + 12] | (data[at + 13] << 8)
    if (id !== chip.IMAGE_CHIP_ID) throw new Error(`${image.name} holds an image built for a different chip (image chip id ${id}, ${chip.CHIP_NAME} is ${chip.IMAGE_CHIP_ID}). Nothing was written.`)
    found = true
  }
  return found
}

const cancelled = error => error?.name === 'NotFoundError' || error?.name === 'AbortError'

// One serial session: pick a port, enter the bootloader, confirm the chip, do the work, release the port.
async function runSession({ serial = globalThis.navigator?.serial, esptool, log }, work) {
  if (!serial) throw new Error('Web Serial API is not available in this browser')
  let port
  try { port = await serial.requestPort() }
  catch (error) { if (cancelled(error)) return { status: 'cancelled' }; throw error }
  const transport = new esptool.Transport(port, false)
  const terminal = { clean() {}, write: text => log(text), writeLine: text => log(`${text}\n`) }
  const loader = new esptool.ESPLoader({ transport, baudrate: 115200, terminal })
  try {
    let description
    try { description = await loader.main() }
    catch (error) {
      throw new Error(`Could not reach the bootloader: ${error?.message || error}. If the board re-enumerated as a new USB device, run this again and choose the new port. Otherwise power off, hold BOOT, and power on.`, { cause: error })
    }
    if (chipKey(loader.chip?.CHIP_NAME) !== BOARD.chip) {
      await reset(loader, log)
      throw new Error(`Connected chip is ${loader.chip?.CHIP_NAME ?? 'unknown'}, not ${BOARD.chipName}. Nothing was written.`)
    }
    return await work(loader, description)
  } finally {
    try { await transport.disconnect() } catch { /* The port is already gone after a reset or unplug. */ }
  }
}

async function reset(loader, log) {
  try { await loader.after('hard_reset'); return true }
  catch (error) { log(`Reset request failed: ${error?.message || error}\n`); return false }
}

export function identifyBoard(deps) {
  return runSession(deps, async (loader, description) => ({ status: 'success', chip: description, resetRequested: await reset(loader, deps.log) }))
}

export async function flashImages({ images, eraseAll = false, onProgress, ...deps }) {
  const plan = planImages(images)
  const data = await Promise.all(plan.map(async image => new Uint8Array(await image.file.arrayBuffer())))
  return runSession(deps, async (loader, description) => {
    try {
      const verified = plan.filter((image, i) => checkImageChip(data[i], image, loader.chip))
      if (!verified.length) deps.log(`Warning: no image has an ESP image header, so the target chip could not be checked against the files.\n`)
    } catch (error) { await reset(loader, deps.log); throw error }
    try {
      await loader.writeFlash({
        fileArray: plan.map((image, i) => ({ data: data[i], address: image.address })),
        // Images are written byte-for-byte. esptool-js 0.7.1 mishandles header rewrites
        // (stale appended SHA-256, unsupported frequencies), and ESP-IDF already bakes
        // the flash settings into the bootloader header.
        flashMode: 'keep', flashFreq: 'keep', flashSize: 'keep',
        eraseAll,
        compress: true,
        calculateMD5Hash: md5,
        reportProgress: (index, completed, total) => onProgress?.({ index, count: plan.length, name: plan[index].name, completed, total }),
      })
    } catch (error) {
      throw new Error(`Flashing failed: ${error?.message || error}. Flash may be partly written and the board is still in its bootloader; flash again before relying on it.`, { cause: error })
    }
    return { status: 'success', chip: description, resetRequested: await reset(loader, deps.log) }
  })
}
