import { Flex, Heading, HStack, Icon, Stack, Text } from '@chakra-ui/react'
import { useRouter } from 'next/router'
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
import { NavButton } from './NavButton'
import { NowPlaying } from './NowPlaying'
import { useSidebar } from './SidebarContext'
import { ColorModeButton } from './ui/color-mode'
import { Tooltip } from './ui/tooltip'
import Link from 'next/link'

export const Sidebar = () => {
  const router = useRouter()
  const { collapsed, setCollapsed } = useSidebar()

  return (
    <Flex
      boxShadow={{ base: 'sm', _dark: 'sm-dark' }}
      w={collapsed ? '68px' : 'xs'}
      minW={collapsed ? '68px' : 'xs'}
      py={{ base: '6', sm: '10' }}
      px={collapsed ? '2' : { base: '4', sm: '6' }}
      bg={{ base: 'gray.100', _dark: '#111111' }}
      transition="all 0.2s ease-in-out"
      overflow="hidden"
      position="relative"
    >
      <Stack justify="space-between" gap="1" width="full">
        <Stack gap="8">
          {collapsed ? (
            <Stack align="center" gap="3">
              <Tooltip content="Kevin Wong" positioning={{ placement: 'right' }}>
                <Text fontWeight="bold" fontSize="lg">
                  <Link href="/">KW</Link>
                </Text>
              </Tooltip>
              <Tooltip content="Expand sidebar" positioning={{ placement: 'right' }}>
                <Flex
                  as="button"
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
              <Tooltip content="Collapse sidebar" positioning={{ placement: 'right' }}>
                <Flex
                  as="button"
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
            </Flex>
          )}
          <Stack>
            <NavButton label="I am" icon={FiSmile} collapsed={collapsed} onClick={() => router.push('/')} />
            <NavButton label="Statistics" icon={FiBarChart2} collapsed={collapsed} onClick={() => router.push('/stats')} />
            <NavButton label="Bookshelf" icon={FiBookOpen} collapsed={collapsed} onClick={() => router.push('/bookshelf')} />
            <NavButton label="Snapshots" icon={FiCamera} collapsed={collapsed} onClick={() => router.push('/snapshots')} />
            <NavButton label="Projects" icon={FiArchive} collapsed={collapsed} onClick={() => router.push('/projects')} />
            <NavButton label="Blog" icon={FiBook} collapsed={collapsed} onClick={() => router.push('/blog')} />
            <NavButton label="Contact" icon={FiAtSign} collapsed={collapsed} onClick={() => router.push('/contact')} />
          </Stack>
        </Stack>
        <NowPlaying collapsed={collapsed} />
      </Stack>
    </Flex>
  )
}
