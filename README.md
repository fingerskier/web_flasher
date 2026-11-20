# Web Flasher

Browser-based flashers for microcontroller boards. Files and serial traffic stay in your browser; there is no upload server.

**[Launch App](https://fingerskier.github.io/web_flasher/)**

| Page | Board | What it does |
| --- | --- | --- |
| [`rp2040/`](https://fingerskier.github.io/web_flasher/rp2040/) | RP2040 running **MicroPython** | Copy firmware (UF2), transfer individual files, run REPL commands |
| [`esp-mosaico/`](https://fingerskier.github.io/web_flasher/esp-mosaico/) | Espressif **ESP-Mosaico** (ESP32-S31) | Flash ESP-IDF firmware images over USB |

Both need desktop Chrome or Edge with Web Serial support, on HTTPS or localhost.

# ESP-Mosaico

Flashes ESP-IDF images to an ESP-Mosaico using [esptool-js](https://github.com/espressif/esptool-js) and its ESP32-S31 flasher stub.

1. **Load build folder**: choose your project's ESP-IDF `build/` directory. The page reads `flasher_args.json` and loads every listed image with its offset. Alternatively, **add .bin files** and set the offsets yourself. Offsets are guessed from file names using the ESP32-S31 defaults: bootloader `0x2000`, partition table `0x8000`, app `0x10000`, merged image `0x0`.
2. Tick the overwrite agreement, press **Flash firmware**, and choose the board's serial port.
3. The page resets the board into its bootloader, writes each image, verifies it by MD5, and requests a reset.

**Identify board** connects, reports the chip, and resets the board without writing anything.

### Safety and limitations

- Only an ESP32-S31 is accepted. A different connected chip, a `flasher_args.json` for another target, or an image whose header names another chip stops the run before anything is written.
- Files without an ESP image header (partition tables, data partitions) cannot be checked against the chip; the log says so when no image could be checked.
- Images are written unchanged. Flash mode, frequency and size are whatever the build put in the bootloader header; the page does not rewrite them.
- A merged image is also checked at the bootloader offsets other ESP chips use, so a merged build for another chip is refused.
- Offsets must be 4 KiB aligned and images must not overlap.
- Flashing cannot be cancelled part-way. A failed run can leave flash partly written with the board still in its bootloader; flash again.
- A reset **request** is not a verified boot.
- The board's USB port can re-enumerate as a different device when it enters the bootloader, and the browser then loses the port. Run the action again and choose the new port. On a first flash, power off, hold **BOOT**, and power on.
- **Erase the whole flash** also wipes NVS (saved settings).
- There is no serial monitor. Flashing through the browser has not been validated on hardware yet; see Development.

# RP2040

A tool for copying firmware and transferring individual files to RP2040 microcontrollers running **MicroPython**. CircuitPython is not supported.

## Requirements

- Desktop Chrome or Edge with Web Serial support, on HTTPS or localhost
- RP2040-based device connected via a USB data cable
- MicroPython installed on the device for serial commands and file transfers
- File System Access (`showDirectoryPicker`) support to copy firmware from the browser

## Usage

1. **Connect** — Select the device's serial port. MicroPython operations interrupt a running program; save any important state first.
2. **Upload File** — Select one file, acknowledge replacement of a same-named file, and upload. This saves the file's bytes under its filename; it does **not** execute the file. Python, text, and binary files are supported. An upload of `main.py` changes what runs on the next boot.
3. **REPL Mode / custom commands** — Interrupt a program and interact with MicroPython. Commands verify the runtime and wait for a device response; silent devices and Python errors are failures, not successful sends. Only run commands you trust.
4. **Reboot** — Restart MicroPython. Resetting or unplugging a device ends its session; reconnect when it is available again.
5. **FS Mode** — Enter the RP2040 ROM bootloader. This ends the serial connection. Alternatively, hold **BOOTSEL** while plugging in the board.
6. **Upload Firmware** — Obtain the correct MicroPython `.uf2` for your exact board from [micropython.org/download](https://micropython.org/download/). Select it, then choose the mounted **RPI-RP2** drive. A serial connection is not required for this step.

### Transfer safety and limitations

- File uploads use acknowledged, bounded chunks and a temporary file before replacing the destination. A failed or cancelled transfer is not reported as success; reconnect after a connection-ending cancellation. An interrupted transfer can leave a temporary file requiring cleanup.
- Device operations are serialized and bound to their original connection. Disconnecting cancels pending work rather than silently continuing on another device.
- Reset and bootloader actions report a **request**, not verified startup. Reconnect and inspect the device after it restarts.
- Firmware copying checks UF2 structure, RP2040 family and the destination's `INFO_UF2.TXT`. **UF2 format does not prove that firmware is MicroPython or that it matches your exact board.** Use a trusted board-specific download.
- Copy completion means the browser finished writing, not that the firmware booted successfully. The drive normally disappears as the board reboots. A disappearing drive or write error cannot safely be treated as verified success; check the device and retry through BOOTSEL if needed.
- Browser/OS support for writing a bootloader volume varies. If the browser refuses the drive, copy the trusted UF2 using your operating system's file manager instead.
- Cancellation cannot undo firmware blocks already consumed by the bootloader. If native filesystem I/O does not settle safely, the app blocks further device work and asks you to reload before retrying; check the drive/device first.
- Logs are bounded and batched for responsiveness; older output may be discarded. The log is not a durable capture.
- The UI uses Web Serial. The WebUSB transport is an internal API, not a second connection button or a browser-support workaround.

# Development

```bash
npm ci --include=dev
npm run dev
```

Use Node.js **24.15 or newer** (CI uses Node 24) and `python3` for the generated-filesystem-command regression test. The test scripts explicitly select React's test environment, even when your shell exports `NODE_ENV=production`.

```bash
npm test          # protocol, lifecycle, firmware, log, UI, and asset regressions
npm run check    # lint + tests + production build
npm run preview  # serve the production build for browser checks
```

Each page is its own HTML entry (`index.html`, `rp2040/index.html`, `esp-mosaico/index.html`) with sources under `src/rp2040`, `src/esp` and `src/shared`. The build uses a relative base, so it works under any GitHub Pages project path.

Tests use simulated transports/filesystems and do not flash real hardware. ESP-Mosaico acceptance still requires a board: identify it, flash a known-good ESP-IDF build folder, and confirm it boots. Hardware acceptance still requires a MicroPython RP2040: transfer and read back a binary file, reconnect after unplug/reset, cancel a transfer, and copy a known-good board-specific UF2. Do not use a board with irreplaceable data for initial validation.

Every production page has a self-hosted Content Security Policy. Vite removes it only from the development HTML to support hot reload; check the production preview when testing CSP behavior.

# Deployment

```bash
npm run deploy
```
GitHub Actions runs lint, tests and build for pull requests and main; only main can deploy to Pages. The optional local `deploy` command also runs the full check first. `gh-pages` is a development-only tool; review `npm audit` findings separately from browser runtime dependencies (`npm audit --omit=dev`). Do not apply forced audit upgrades without checking behavior.
