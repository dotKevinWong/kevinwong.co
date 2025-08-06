import type { AppProps } from 'next/app'
import { Provider } from "../components/ui/provider"
import { defaultSystem } from '@chakra-ui/react'
import { ColorModeProvider } from '../components/ui/color-mode'

export default function App({ Component, pageProps }: AppProps) {
  return (
    <Provider>
      <ColorModeProvider>
        <Component {...pageProps} />
      </ColorModeProvider>
    </Provider>
  )
}