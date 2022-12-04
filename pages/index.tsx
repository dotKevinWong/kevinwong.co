import { Sidebar } from "../components/Sidebar";
import { Box, Flex, useBreakpointValue } from "@chakra-ui/react";
import React from "react";
import { Navbar } from "../components/Navbar";
import { HomePage } from "../components/pages/Home";

export default function Home() {
  const isDesktop = useBreakpointValue({ base: false, lg: true })

  return (
    <div>
      <title>Kevin Wong</title>
      {isDesktop ? (
        <Box height="100vh" overflow="hidden" position="relative">
          <Flex h="full" id="app-container">
            <Sidebar />
            <Box
              as="section"
              flex="1"
              overflow="auto"
            >
              <Box
                as="section"
                flex="1"
                overflow="auto"
                maxW="4xl"
              >
                <HomePage />
              </Box>
            </Box>
          </Flex>
        </Box>
      ) : (
        <Flex
          as="section"
          direction={{ base: "column", lg: "row" }}
          height="100vh"
          bg="bg-canvas"
          overflowY="auto"
        >
          <Navbar />
          <HomePage />
        </Flex>
      )}
    </div>
  );
}