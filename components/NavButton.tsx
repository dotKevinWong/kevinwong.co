import { Button, ButtonProps, HStack, Icon, Text } from '@chakra-ui/react'
import React from 'react'

interface NavButtonProps extends ButtonProps {
  icon: React.ElementType
  label: string
}

export const NavButton = (props: NavButtonProps) => {
  const { icon, label, ...buttonProps } = props
  return (
    <Button variant="ghost" justifyContent="start" {...buttonProps}>
      <HStack gap="3">
        <Icon as={icon} boxSize="6" color="subtle" />
        <Text>{label}</Text>
      </HStack>
    </Button>
  )
}