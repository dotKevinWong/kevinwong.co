import { Flex, Icon } from '@chakra-ui/react'
import { LuPanelLeftClose, LuPanelLeftOpen } from 'react-icons/lu'
import { Tooltip } from './ui/tooltip'

/** The sidebar's expand (collapsed rail) and collapse (full sidebar) buttons. */
export const SidebarToggle = ({ action, onClick }: { action: 'expand' | 'collapse'; onClick: () => void }) => {
  const label = action === 'expand' ? 'Expand sidebar' : 'Collapse sidebar'
  return (
    <Tooltip content={label} positioning={{ placement: 'right' }}>
      <Flex
        as="button"
        aria-label={label}
        onClick={onClick}
        align="center"
        justify="center"
        w="28px"
        h="28px"
        borderRadius="sm"
        color={{ base: 'gray.500', _dark: 'gray.400' }}
        _hover={{ color: { base: 'gray.900', _dark: 'gray.100' } }}
        transition="color 0.15s ease"
        cursor="pointer"
        flexShrink={action === 'collapse' ? 0 : undefined}
      >
        <Icon as={action === 'expand' ? LuPanelLeftOpen : LuPanelLeftClose} boxSize="5" />
      </Flex>
    </Tooltip>
  )
}
