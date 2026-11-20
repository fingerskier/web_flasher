import { useMemo, useRef, useState, useSyncExternalStore } from 'react'
import PageHeader from '@/shared/PageHeader'
import DeviceLog from '@/shared/DeviceLog'
import { createLogStore } from '@/shared/logStore'
import { BOARD, DEFAULT_SETTINGS, FLASH_FREQS, FLASH_MODES, FLASH_SIZES, flashImages, guessOffset, hex, identifyBoard, parseOffset, planImages, readBuildFolder } from './flasher.js'

const SETTINGS = [['flashMode', 'Flash mode', FLASH_MODES], ['flashFreq', 'Flash frequency', FLASH_FREQS], ['flashSize', 'Flash size', FLASH_SIZES]]
const size = bytes => (bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KiB`)
const offsetOf = text => { try { return { address: parseOffset(text) } } catch (error) { return { error: error.message } } }

export default function App({ esptool }) {
  const [store] = useState(() => createLogStore())
  const logs = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const nextId = useRef(0)
  const inFlight = useRef(false)
  const [images, setImages] = useState([])
  const [settings, setSettings] = useState(DEFAULT_SETTINGS)
  const [eraseAll, setEraseAll] = useState(false)
  const [agreed, setAgreed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(null)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const serialSupported = window.isSecureContext && !!navigator.serial
  const folderSupported = window.isSecureContext && typeof window.showDirectoryPicker === 'function'

  const rows = useMemo(() => images.map(image => ({ ...image, ...offsetOf(image.offset) })), [images])
  const planError = useMemo(() => {
    if (!rows.length || rows.some(row => row.error)) return ''
    try { planImages(rows); return '' } catch (err) { return err.message }
  }, [rows])
  const ready = rows.length > 0 && !rows.some(row => row.error) && !planError

  const replaceImages = update => { setImages(update); setAgreed(false); setStatus('') }
  const entry = (name, file, address) => ({ id: nextId.current++, name, file, offset: hex(address) })

  const run = async action => {
    if (busy || inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setError('')
    setStatus('')
    try { await action() }
    catch (err) { if (err?.name !== 'AbortError') setError(err?.message || String(err)) }
    finally { inFlight.current = false; setBusy(false); setProgress(null) }
  }

  const loadFolder = () => run(async () => {
    const build = await readBuildFolder(await window.showDirectoryPicker({ mode: 'read' }))
    replaceImages(build.images.map(image => entry(image.name, image.file, image.address)))
    setSettings(build.settings)
    setStatus(`Loaded ${build.images.length} images from flasher_args.json.`)
  })

  const addFiles = event => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (files.length) replaceImages(current => [...current, ...files.map(file => entry(file.name, file, guessOffset(file.name)))])
  }

  const deps = { esptool, log: store.append }
  const describeReset = result => (result.resetRequested ? 'Reset requested; startup has not been verified.' : 'Reset request failed; power-cycle the board.')

  const identify = () => run(async () => {
    const result = await identifyBoard(deps)
    if (result.status === 'success') setStatus(`Found ${result.chip}. ${describeReset(result)}`)
  })

  const flash = () => run(async () => {
    const result = await flashImages({
      ...deps, images: rows, settings, eraseAll,
      onProgress: ({ index, count, name, completed, total }) => setProgress({ label: `Writing ${name} (${index + 1} of ${count})`, completed, total }),
    })
    if (result.status !== 'success') return
    setAgreed(false)
    setStatus(`Wrote and verified ${rows.length} image${rows.length === 1 ? '' : 's'} on ${result.chip}. ${describeReset(result)}`)
  })

  return (
    <>
      <PageHeader title="ESP-Mosaico Web Flasher" subtitle={`${BOARD.chipName} firmware over Web Serial`} />
      <main id="main-content" tabIndex={-1}>
        <section className="panel transfer-panel" aria-labelledby="images-heading">
          <h2 id="images-heading">Firmware images</h2>
          <p id="images-help">Load an ESP-IDF build folder to pick up every image and offset from flasher_args.json, or add .bin files and set their offsets yourself.</p>
          {!folderSupported && <p>Loading a build folder requires HTTPS (or localhost) and a browser supporting showDirectoryPicker. You can still add .bin files.</p>}
          <div className="controls">
            <button type="button" onClick={loadFolder} disabled={busy || !folderSupported}>Load build folder</button>
          </div>
          <label>Add image files (.bin) <input type="file" multiple accept=".bin" aria-describedby="images-help" disabled={busy} onChange={addFiles} /></label>
          {rows.length > 0 && <ul className="image-list" aria-label="Images to flash">
            {rows.map(row => <li className="image-row" key={row.id}>
              <span className="image-name">{row.name}<small>{size(row.file.size)}</small></span>
              <label>Offset
                <input type="text" value={row.offset} disabled={busy} aria-label={`Offset for ${row.name}`} aria-invalid={!!row.error}
                  onChange={e => replaceImages(current => current.map(image => (image.id === row.id ? { ...image, offset: e.target.value } : image)))} />
              </label>
              <button type="button" disabled={busy} aria-label={`Remove ${row.name}`} onClick={() => replaceImages(current => current.filter(image => image.id !== row.id))}>Remove</button>
              {row.error && <p role="alert">{row.error}</p>}
            </li>)}
          </ul>}
          {planError && <p role="alert">{planError}</p>}
          <div className="settings-grid">
            {SETTINGS.map(([key, label, options]) => <label key={key}>{label}
              <select value={settings[key]} disabled={busy} onChange={e => setSettings(current => ({ ...current, [key]: e.target.value }))}>
                {options.map(option => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>)}
          </div>
          <p className="hint">“keep” leaves the value already in the image header. {BOARD.name} defaults: bootloader {hex(BOARD.bootloaderOffset)}, partition table {hex(BOARD.partitionTableOffset)}, app {hex(BOARD.appOffset)}.</p>
        </section>
        <section className="panel transfer-panel" aria-labelledby="flash-heading">
          <h2 id="flash-heading">Flash</h2>
          <p id="flash-help">Switch the board on and connect it by USB. Flashing resets the board into its bootloader, writes each image, verifies it by MD5, then resets again. It cannot be cancelled part-way.</p>
          <p className="helper-note">If the serial port disappears when the board enters its bootloader, run the action again and choose the new port. On a first flash, power off, hold BOOT, and power on.</p>
          {!serialSupported && <p>Web Serial requires HTTPS (or localhost) and a supported browser such as desktop Chrome or Edge.</p>}
          <label className="confirmation"><input type="checkbox" disabled={busy} checked={eraseAll} onChange={e => setEraseAll(e.target.checked)} /> Erase the whole flash first. This also wipes saved settings (NVS).</label>
          <label className="confirmation"><input type="checkbox" disabled={busy || !ready} checked={agreed} onChange={e => setAgreed(e.target.checked)} /> I agree to overwrite the flash regions listed above.</label>
          <div className="controls">
            <button className="primary-button" type="button" aria-describedby="flash-help" onClick={flash} disabled={!serialSupported || busy || !ready || !agreed}>Flash firmware</button>
            <button type="button" onClick={identify} disabled={!serialSupported || busy}>Identify board</button>
          </div>
          {progress && <section className="operation-panel" aria-label="Current operation">
            <p role="status">{progress.label}: {progress.completed} / {progress.total}</p>
            <progress aria-label={progress.label} max={progress.total || 1} value={progress.completed} />
          </section>}
          <p role="status">{status}</p>
          {error && <div><p role="alert">{error}</p><button type="button" onClick={() => setError('')}>Clear error</button></div>}
        </section>
      </main>
      <footer>
        <DeviceLog {...logs} />
        <p className="copyright">© 2025 fingerskier</p>
      </footer>
    </>
  )
}
