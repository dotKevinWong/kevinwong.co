import { Button, ButtonProps, Flex, HStack, Icon, Text } from '@chakra-ui/react'
import React from 'react'
import { Tooltip } from './ui/tooltip'

interface NavButtonProps extends ButtonProps {
  icon: React.ElementType
  label: string
  collapsed?: boolean
}

export const NavButton = (props: NavButtonProps) => {
  const { icon, label, collapsed, ...buttonProps } = props

  const button = (
    <Button
      variant="ghost"
      justifyContent={collapsed ? 'center' : 'start'}
      px={collapsed ? '0' : undefined}
      {...buttonProps}
    >
      {collapsed ? (
        <Flex justify="center">
          <Icon as={icon} boxSize="6" color="subtle" />
        </Flex>
      ) : (
        <HStack gap="3">
          <Icon as={icon} boxSize="6" color="subtle" />
          <Text>{label}</Text>
        </HStack>
      )}
    </Button>
  )

  if (collapsed) {
    return (
      <Tooltip content={label} positioning={{ placement: 'right' }}>
        {button}
      </Tooltip>
    )
  }

  return button
}