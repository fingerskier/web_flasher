import PageHeader from '@/shared/PageHeader'
import logo from '@/rp2040/assets/logo.png'

export default function Header() {
  return <PageHeader
    title="RP2040 Web Flasher"
    subtitle="MicroPython device workbench"
    logo={<img src={logo} className="logo" alt="RP2040" width="131" height="96" />}
  />
}
