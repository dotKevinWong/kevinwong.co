import { Button, Flex, Heading, HStack, Stack, useColorMode, useColorModeValue as mode } from '@chakra-ui/react'
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


export const Sidebar = () => {
  const { colorMode, toggleColorMode } = useColorMode()
  const router = useRouter()

  return (
    <Flex
      flex="1"
      // bg="bg-surface"
      boxShadow={mode('sm', 'sm-dark')}
      maxW={{ base: 'full', sm: 'xs' }}
      py={{ base: '6', sm: '10' }}
      px={{ base: '4', sm: '6' }}
      bg={mode("gray.100", "inherit")}
    >
      <Stack justify="space-between" spacing="1" width="full">
        <Stack spacing="8" shouldWrapChildren>
          <HStack spacing="4" marginLeft={4}>
            <Heading as="a" size="lg" href="/">KEVIN WONG</Heading>
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
  )
}