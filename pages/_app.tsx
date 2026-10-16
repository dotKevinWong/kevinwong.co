import type { AppProps } from 'next/app'
import { Provider } from "../components/ui/provider"
import { SidebarProvider } from '../components/SidebarContext'

export default function App({ Component, pageProps }: AppProps) {
  return (
    <Provider>
      <SidebarProvider>
        <Component {...pageProps} />
      </SidebarProvider>
    </Provider>
  )
}