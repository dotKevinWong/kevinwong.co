import { Flex, Heading, HStack, Icon, Stack, Text } from '@chakra-ui/react'
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
import { LuPanelLeftClose, LuPanelLeftOpen } from 'react-icons/lu'
import { SWRConfig, type Middleware } from 'swr'
import { useMediaQuery } from './desktop/hooks'
import { NavButton } from './NavButton'
import { NowPlaying } from './NowPlaying'
import { useSidebar } from './SidebarContext'
import { ColorModeButton } from './ui/color-mode'
import { Tooltip } from './ui/tooltip'
import Link from 'next/link'

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
      bg={{ base: 'gray.100', _dark: '#111111' }}
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
              <Tooltip content="Expand sidebar" positioning={{ placement: 'right' }}>
                <Flex
                  as="button"
                  aria-label="Expand sidebar"
                  onClick={() => setCollapsed(false)}
                  align="center"
                  justify="center"
                  w="28px"
                  h="28px"
                  borderRadius="sm"
                  color={{ base: 'gray.500', _dark: 'gray.400' }}
                  _hover={{ color: { base: 'gray.900', _dark: 'gray.100' } }}
                  transition="color 0.15s ease"
                  cursor="pointer"
                >
                  <Icon as={LuPanelLeftOpen} boxSize="5" />
                </Flex>
              </Tooltip>
            </Stack>
          ) : (
            <Flex align="center" justify="space-between" marginLeft={4}>
              <HStack gap="4">
                <Heading size="2xl" fontWeight="bold"><Link href="/">KEVIN WONG</Link></Heading>
                <ColorModeButton />
              </HStack>
              {!inDrawer && (
                <Tooltip content="Collapse sidebar" positioning={{ placement: 'right' }}>
                  <Flex
                    as="button"
                    aria-label="Collapse sidebar"
                    onClick={() => setCollapsed(true)}
                    align="center"
                    justify="center"
                    w="28px"
                    h="28px"
                    borderRadius="sm"
                    color={{ base: 'gray.500', _dark: 'gray.400' }}
                    _hover={{ color: { base: 'gray.900', _dark: 'gray.100' } }}
                    transition="color 0.15s ease"
                    cursor="pointer"
                    flexShrink={0}
                  >
                    <Icon as={LuPanelLeftClose} boxSize="5" />
                  </Flex>
                </Tooltip>
              )}
            </Flex>
          )}
          <Stack>
            <NavButton label="I am" icon={FiSmile} collapsed={isCollapsed} href="/" />
            <NavButton label="Statistics" icon={FiBarChart2} collapsed={isCollapsed} href="/stats" />
            <NavButton label="Bookshelf" icon={FiBookOpen} collapsed={isCollapsed} href="/bookshelf" />
            <NavButton label="Snapshots" icon={FiCamera} collapsed={isCollapsed} href="/snapshots" />
            <NavButton label="Projects" icon={FiArchive} collapsed={isCollapsed} href="/projects" />
            <NavButton label="Blog" icon={FiBook} collapsed={isCollapsed} href="/blog" />
            <NavButton label="Contact" icon={FiAtSign} collapsed={isCollapsed} href="/contact" />
          </Stack>
        </Stack>
        <SWRConfig value={nowPlayingConfig}>
          <NowPlaying collapsed={isCollapsed} />
        </SWRConfig>
      </Stack>
    </Flex>
  )
}
