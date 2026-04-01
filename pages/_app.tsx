import type { AppProps } from 'next/app'
import { Provider } from "../components/ui/provider"
import { ColorModeProvider } from '../components/ui/color-mode'
import { SidebarProvider } from '../components/SidebarContext'

export default function App({ Component, pageProps }: AppProps) {
  return (
    <Provider>
      <ColorModeProvider>
        <SidebarProvider>
          <Component {...pageProps} />
        </SidebarProvider>
      </ColorModeProvider>
    </Provider>
  )
}