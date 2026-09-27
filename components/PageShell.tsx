import { Box, Flex } from "@chakra-ui/react";
import React from "react";
import { Navbar } from "./Navbar";
import { Sidebar } from "./Sidebar";

/**
 * Sidebar on large screens, Navbar below that. Unlike a `useBreakpointValue`
 * switch, the choice is made in CSS, so the server-rendered HTML already has the
 * right layout and there is no mobile-to-desktop flash while hydrating.
 */
export const PageShell = ({
  children,
  scroll = true,
}: {
  children: React.ReactNode;
  /** Set to false when the page manages its own scrolling. */
  scroll?: boolean;
}) => (
  <Flex direction={{ base: "column", lg: "row" }} h="100dvh" overflow="hidden">
    <Flex hideBelow="lg" flexShrink={0}>
      <Sidebar />
    </Flex>
    <Box hideFrom="lg" flexShrink={0}>
      <Navbar />
    </Box>
    <Box as="main" flex="1" minW="0" minH="0" position="relative" overflow={scroll ? "auto" : "hidden"}>
      {children}
    </Box>
  </Flex>
);
