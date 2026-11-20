import DeviceLog from '@/shared/DeviceLog'
import { useDeviceLogs } from '@/rp2040/lib/DeviceContext'

export default function Footer() {
  return (
    <footer>
      <DeviceLog {...useDeviceLogs()} />
      <p className="copyright">© 2025 fingerskier</p>
    </footer>
  )
}
