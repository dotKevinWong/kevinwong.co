import { Box, Button, Container, Drawer, DrawerContent, DrawerOverlay, Flex, Heading, HStack, Stack, Text, useBreakpointValue, useColorMode, useColorModeValue, useDisclosure } from '@chakra-ui/react'
import { useRouter } from 'next/router'
import * as React from 'react'
import {
  FiArchive,
  FiAtSign,
  FiBarChart2,
  FiBook,
  FiCamera,
  FiMoon,
  FiSmile,
  FiSun
} from 'react-icons/fi'
import { NavButton } from './NavButton'
import { NowPlaying } from './NowPlaying'
import { ToggleButton } from './ToggleButton'


export const Sidebar = () => {
  const { colorMode, toggleColorMode } = useColorMode()
  const router = useRouter()
  const isDesktop = useBreakpointValue({ base: false, lg: true })
  const { isOpen, onToggle, onClose } = useDisclosure()

  return (
    <>
      {isDesktop ? (
        <Flex as="section" minH="10vh" bg="bg-canvas">
          <Flex
            flex="1"
            bg="bg-surface"
            boxShadow={useColorModeValue('sm', 'sm-dark')}
            maxW={{ base: 'full', sm: 'xs' }}
            py={{ base: '6', sm: '10' }}
            px={{ base: '4', sm: '6' }}
          >
            <Stack justify="space-between" spacing="1" width="full">
              <Stack spacing="8" shouldWrapChildren>
                <HStack spacing="4" marginLeft={4}>
                  <Heading as="h1" size="lg">KEVIN WONG</Heading>
                  <Button onClick={() => toggleColorMode()}>{colorMode === 'light' ? <FiMoon /> : <FiSun />}</Button>
                </HStack>
                <Stack>
                  <NavButton label="I am" icon={FiSmile} onClick={() => router.push('/')} />
                  <NavButton label="Statistics" icon={FiBarChart2} onClick={() => router.push('/stats')} />
                  <NavButton label="Snapshots" icon={FiCamera} onClick={() => router.push('/snapshots')} />
                  <NavButton label="Projects" icon={FiArchive} onClick={() => router.push('/projects')} />
                  <NavButton label="Blog" icon={FiBook} onClick={() => router.push('/blog')} />
                  <NavButton label="Contact" icon={FiAtSign} onClick={() => router.push('/contact')} />
                </Stack>
              </Stack>
              <NowPlaying />
            </Stack>
          </Flex>
        </Flex>
      ) : (
        <>
   <Box
      width="full"
      py="4"
      px={{ base: '4', md: '8' }}
      bg="bg-surface"
      boxShadow={useColorModeValue('sm', 'sm-dark')}
    >
      <Flex justify="space-between">
        <Heading as="h1" size="lg">KEVIN WONG</Heading>
            <ToggleButton isOpen={isOpen} aria-label="Open Menu" onClick={onToggle} />
            <Drawer
              isOpen={isOpen}
              placement="left"
              onClose={onClose}
              isFullHeight
              preserveScrollBarGap
              // Only disabled for showcase
              trapFocus={false}
            >
              <DrawerOverlay />
              <DrawerContent>
                <Flex
                  flex="1"
                  bg="bg-surface"
                  boxShadow={useColorModeValue('sm', 'sm-dark')}
                  maxW={{ base: 'full', sm: 'xs' }}
                  py={{ base: '6', sm: '10' }}
                  px={{ base: '4', sm: '6' }}
                >
                  <Stack justify="space-between" spacing="1" width="full">
                    <Stack spacing="8" shouldWrapChildren>
                      <HStack spacing="4" marginLeft={4}>
                        <Heading as="h1" size="lg">KEVIN WONG</Heading>
                        <Button onClick={() => toggleColorMode()}>{colorMode === 'light' ? <FiMoon /> : <FiSun />}</Button>
                      </HStack>
                      <Stack>
                        <NavButton label="I am" icon={FiSmile} onClick={() => router.push('/')} />
                        <NavButton label="Statistics" icon={FiBarChart2} onClick={() => router.push('/stats')} />
                        <NavButton label="Snapshots" icon={FiCamera} onClick={() => router.push('/snapshots')} />
                        <NavButton label="Projects" icon={FiArchive} onClick={() => router.push('/projects')} />
                        <NavButton label="Blog" icon={FiBook} onClick={() => router.push('/blog')} />
                        <NavButton label="Contact" icon={FiAtSign} onClick={() => router.push('/contact')} />
                      </Stack>
                    </Stack>
                    <NowPlaying />
                  </Stack>
                </Flex>
              </DrawerContent>
            </Drawer>
          </Flex>
        </Box>
        </>
      )}
    </>
  )
}

