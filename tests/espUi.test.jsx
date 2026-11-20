// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../src/esp/App.jsx'

const flasher = vi.hoisted(() => ({ flashImages: vi.fn(), identifyBoard: vi.fn() }))
vi.mock('../src/esp/flasher.js', async original => ({ ...(await original()), ...flasher }))

const bin = (name, size = 64) => new File([new Uint8Array(size)], name)
beforeEach(() => {
  flasher.flashImages.mockReset()
  flasher.identifyBoard.mockReset()
  vi.stubGlobal('isSecureContext', true)
  vi.stubGlobal('showDirectoryPicker', vi.fn())
  Object.defineProperty(navigator, 'serial', { configurable: true, value: {} })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('ESP-Mosaico page', () => {
  it('names its regions and links back to the flasher list', () => {
    render(<App esptool={{}} />)
    for (const name of ['Firmware images', 'Flash', 'Device log']) expect(screen.getByRole('region', { name })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('ESP-Mosaico Web Flasher')
    expect(screen.getByRole('link', { name: 'All flashers' }).getAttribute('href')).toBe('../')
    expect(screen.getByRole('button', { name: 'Flash firmware' }).disabled).toBe(true)
  })
  it('requires valid, non-overlapping offsets and explicit agreement before flashing', async () => {
    flasher.flashImages.mockResolvedValue({ status: 'success', chip: 'ESP32-S31', resetRequested: true })
    render(<App esptool={{}} />)
    await userEvent.upload(screen.getByLabelText(/Add image files/), [bin('bootloader.bin'), bin('pbm_mosaico.bin')])
    expect(screen.getByLabelText('Offset for bootloader.bin').value).toBe('0x2000')
    const offset = screen.getByLabelText('Offset for pbm_mosaico.bin')
    expect(offset.value).toBe('0x10000')
    const agree = screen.getByLabelText(/I agree to overwrite/)
    const flash = screen.getByRole('button', { name: 'Flash firmware' })

    await userEvent.clear(offset)
    await userEvent.type(offset, '0x2000')
    expect(screen.getByRole('alert').textContent).toMatch(/overlaps/)
    expect(agree.disabled).toBe(true)
    await userEvent.clear(offset)
    await userEvent.type(offset, '0x123')
    expect(screen.getByRole('alert').textContent).toMatch(/4 KiB/)
    await userEvent.clear(offset)
    await userEvent.type(offset, '0x10000')
    expect(screen.queryByRole('alert')).toBeNull()

    expect(flash.disabled).toBe(true)
    await userEvent.click(agree)
    await userEvent.click(flash)
    const [call] = flasher.flashImages.mock.calls[0]
    expect(call.images.map(image => [image.name, image.address])).toEqual([['bootloader.bin', 0x2000], ['pbm_mosaico.bin', 0x10000]])
    expect(call).toMatchObject({ eraseAll: false, settings: { flashMode: 'keep', flashFreq: 'keep', flashSize: 'keep' } })
    expect(screen.getByText(/Wrote and verified 2 images.*startup has not been verified/)).toBeTruthy()
    expect(agree.checked).toBe(false)
  })
  it('shows flashing errors and keeps the selection', async () => {
    flasher.flashImages.mockRejectedValue(new Error('Flashing failed: timeout'))
    render(<App esptool={{}} />)
    await userEvent.upload(screen.getByLabelText(/Add image files/), bin('app.bin'))
    await userEvent.click(screen.getByLabelText(/I agree to overwrite/))
    await userEvent.click(screen.getByRole('button', { name: 'Flash firmware' }))
    expect(screen.getByRole('alert').textContent).toBe('Flashing failed: timeout')
    expect(screen.getByLabelText('Offset for app.bin')).toBeTruthy()
  })
  it('identifies a board without any images and disables serial actions without Web Serial', async () => {
    flasher.identifyBoard.mockResolvedValue({ status: 'success', chip: 'ESP32-S31', resetRequested: false })
    const view = render(<App esptool={{}} />)
    await userEvent.click(screen.getByRole('button', { name: 'Identify board' }))
    expect(screen.getByText(/Found ESP32-S31.*power-cycle/)).toBeTruthy()
    view.unmount()
    Object.defineProperty(navigator, 'serial', { configurable: true, value: undefined })
    render(<App esptool={{}} />)
    expect(screen.getByRole('button', { name: 'Identify board' }).disabled).toBe(true)
    expect(screen.getByText(/Web Serial requires HTTPS/)).toBeTruthy()
  })
})
