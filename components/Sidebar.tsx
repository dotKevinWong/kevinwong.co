import { Flex, Heading, HStack, Stack} from '@chakra-ui/react'
import { useRouter } from 'next/router'
import * as React from 'react'
import {
  FiArchive,
  FiAtSign,
  FiBarChart2,
  FiBook,
  FiCamera,
  FiSmile,
} from 'react-icons/fi'
import { NavButton } from './NavButton'
import { NowPlaying } from './NowPlaying'
import { ColorModeButton } from './ui/color-mode'
import Link from 'next/link'

export const Sidebar = () => {
  const router = useRouter()

  return (
    <Flex
      flex="1"
      boxShadow={{ base: 'sm', _dark: 'sm-dark' }}
      maxW={{ base: 'full', sm: 'xs' }}
      py={{ base: '6', sm: '10' }}
      px={{ base: '4', sm: '6' }}
      bg={{ base: 'gray.100', _dark: 'inherit' }}
    >
      <Stack justify="space-between" gap="1" width="full">
        <Stack gap="8" >
          <HStack gap="4" marginLeft={4}>
            <Heading size="2xl" fontWeight="bold"><Link href="/">KEVIN WONG</Link></Heading>
            <ColorModeButton />
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