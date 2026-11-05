import { Box, Button, CloseButton, Drawer, Flex, Portal } from '@chakra-ui/react'
import {
  FiMenu,
} from 'react-icons/fi'
import { Sidebar } from './Sidebar'
import { SURFACE_BG } from './Card'
import { SiteTitle } from './SiteTitle'


export const Navbar = () => {

  return (
    <Box
      width="full"
      py="4"
      px={{ base: '4', md: '8' }}
      bg={SURFACE_BG}
      boxShadow="sm"
    >
      <Flex justify="space-between" align="center">
        <SiteTitle />
        <Drawer.Root size="xs" placement="start">
          <Drawer.Trigger asChild>
            <Button variant="ghost" aria-label="Open Menu">
              <FiMenu/>
            </Button>
          </Drawer.Trigger>
          <Portal>
            <Drawer.Backdrop />
            <Drawer.Positioner>
              <Drawer.Content>
                <Drawer.CloseTrigger asChild>
                  <CloseButton />
                </Drawer.CloseTrigger>
                <Sidebar inDrawer />
              </Drawer.Content>
            </Drawer.Positioner>
          </Portal>
        </Drawer.Root >
      </Flex >
    </Box >
  )
}
