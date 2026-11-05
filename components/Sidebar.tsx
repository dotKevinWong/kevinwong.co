import { Flex, HStack, Stack, Text } from '@chakra-ui/react'
import * as React from 'react'
import {
  FiArchive,
  FiAtSign,
  FiBarChart2,
  FiBook,
  FiBookOpen,
  FiCamera,
  FiSmile,
} from 'react-icons/fi'
import type { IconType } from 'react-icons'
import { SWRConfig, type Middleware } from 'swr'
import { useMediaQuery } from './hooks'
import { SURFACE_BG } from './Card'
import { NavButton } from './NavButton'
import { NAV_ITEMS } from './navItems'
import { NowPlaying } from './NowPlaying'
import { SidebarToggle } from './SidebarToggle'
import { useSidebar } from './SidebarContext'
import { SiteTitle } from './SiteTitle'
import { ColorModeButton } from './ui/color-mode'
import { Tooltip } from './ui/tooltip'
import Link from 'next/link'

const NAV_ICONS: Record<string, IconType> = {
  '/': FiSmile,
  '/stats': FiBarChart2,
  '/bookshelf': FiBookOpen,
  '/snapshots': FiCamera,
  '/projects': FiArchive,
  '/blog': FiBook,
  '/contact': FiAtSign,
}

// SWR fetches nothing for a null key and fetches straight away once a real key
// comes back, so this pauses a widget's polling without unmounting it.
const pauseWhen = (paused: boolean): Middleware => (useSWRNext) => (key, fetcher, config) =>
  useSWRNext(paused ? null : key, fetcher, config)

export const Sidebar = ({ inDrawer = false }: { inDrawer?: boolean }) => {
  const { collapsed, setCollapsed } = useSidebar()

  // In drawer context, never show collapsed state
  const isCollapsed = inDrawer ? false : collapsed

  // PageShell hides the desktop sidebar below `lg` (64em) with CSS but keeps it
  // mounted, so on phones its NowPlaying would poll every 15s for nobody. Hold
  // its requests until the sidebar is on screen; unmounting it instead would
  // make the widget pop in after hydration on desktop. `isLarge` is false while
  // hydrating, so desktop starts polling right after.
  const isLarge = useMediaQuery('(min-width: 64em)')
  const nowPlayingConfig = React.useMemo(
    () => ({ use: [pauseWhen(!inDrawer && !isLarge)] }),
    [inDrawer, isLarge],
  )

  return (
    <Flex
      boxShadow="sm"
      w={isCollapsed ? '68px' : 'xs'}
      minW={isCollapsed ? '68px' : 'xs'}
      h={inDrawer ? 'full' : undefined}
      py={{ base: '6', sm: '10' }}
      px={isCollapsed ? '2' : { base: '4', sm: '6' }}
      bg={SURFACE_BG}
      transition="all 0.2s ease-in-out"
      overflow="hidden"
      position="relative"
    >
      <Stack justify="space-between" gap="1" width="full">
        <Stack gap="8">
          {isCollapsed ? (
            <Stack align="center" gap="3">
              <Tooltip content="Kevin Wong" positioning={{ placement: 'right' }}>
                <Text fontWeight="bold" fontSize="lg">
                  <Link href="/">KW</Link>
                </Text>
              </Tooltip>
              <SidebarToggle action="expand" onClick={() => setCollapsed(false)} />
            </Stack>
          ) : (
            <Flex align="center" justify="space-between" marginLeft={4}>
              <HStack gap="4">
                <SiteTitle />
                <ColorModeButton />
              </HStack>
              {!inDrawer && (
                <SidebarToggle action="collapse" onClick={() => setCollapsed(true)} />
              )}
            </Flex>
          )}
          <Stack>
            {NAV_ITEMS.map(({ href, label }) => (
              <NavButton key={href} label={label} icon={NAV_ICONS[href]} collapsed={isCollapsed} href={href} />
            ))}
          </Stack>
        </Stack>
        <SWRConfig value={nowPlayingConfig}>
          <NowPlaying collapsed={isCollapsed} />
        </SWRConfig>
      </Stack>
    </Flex>
  )
}
