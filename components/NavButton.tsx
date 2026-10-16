import { Button, ButtonProps, Flex, HStack, Icon, Text } from '@chakra-ui/react'
import NextLink from 'next/link'
import { useRouter } from 'next/router'
import React from 'react'
import { Tooltip } from './ui/tooltip'

interface NavButtonProps extends Omit<ButtonProps, 'asChild'> {
  href: string
  icon: React.ElementType
  label: string
  collapsed?: boolean
}

export const NavButton = (props: NavButtonProps) => {
  const { href, icon, label, collapsed, ...buttonProps } = props
  const { pathname } = useRouter()

  // A real link styled as a button, so crawlers can follow the nav and it can be
  // opened in a new tab. Collapsed, the label only lives in the tooltip, which
  // doesn't name the link, hence the aria-label.
  const button = (
    <Button
      asChild
      variant="ghost"
      justifyContent={collapsed ? 'center' : 'start'}
      px={collapsed ? '0' : undefined}
      {...buttonProps}
    >
      <NextLink
        href={href}
        aria-label={collapsed ? label : undefined}
        aria-current={pathname === href ? 'page' : undefined}
      >
        {collapsed ? (
          <Flex justify="center">
            <Icon as={icon} boxSize="6" />
          </Flex>
        ) : (
          <HStack gap="3">
            <Icon as={icon} boxSize="6" />
            <Text>{label}</Text>
          </HStack>
        )}
      </NextLink>
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
