import Header from '@/rp2040/com/Header'
import Main from '@/rp2040/com/Main'
import Footer from '@/rp2040/com/Footer'
import { DeviceProvider } from '@/rp2040/lib/DeviceContext'

import '@/shared/layout.css'


export default function App() {
  return (
    <DeviceProvider>
      <Header />
      <Main />
      <Footer />
    </DeviceProvider>
  )
}