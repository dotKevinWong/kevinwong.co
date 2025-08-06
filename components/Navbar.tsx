import { Box, Button, CloseButton, Drawer, Flex, Heading, Portal, useDisclosure } from '@chakra-ui/react'
import { useRouter } from 'next/router'
import * as React from 'react'
import {
  FiMenu,
} from 'react-icons/fi'
import { Sidebar } from './Sidebar'


export const Navbar = () => {
  const router = useRouter()
  const { open, onToggle, onClose } = useDisclosure()

  return (
    <Box
      width="full"
      py="4"
      px={{ base: '4', md: '8' }}
      bg={{ base: 'gray.100', _dark: 'inherit'}}
      boxShadow={{ base: 'sm', _dark: 'sm-dark' }}
    >
      <Flex justify="space-between" align="center">
        <Heading size="2xl" fontWeight="bold"><a href="/">KEVIN WONG</a></Heading>
        <Drawer.Root size="xs" placement="start">
          <Drawer.Trigger>
            <Button variant="ghost" aria-label="Open Menu">
              <FiMenu/>
            </Button>
          </Drawer.Trigger>
          <Portal>
            <Drawer.Backdrop />
            <Drawer.Positioner>
              <Drawer.Content>
                <Drawer.CloseTrigger asChild pos="bottom">
                  <CloseButton />
                </Drawer.CloseTrigger>
                <Sidebar />
              </Drawer.Content>
            </Drawer.Positioner>
          </Portal>
        </Drawer.Root >
      </Flex >
    </Box >
  )
}

