import { Sidebar } from "../../components/Sidebar";
import { Alert, AlertIcon, Box, Flex, useBreakpointValue } from "@chakra-ui/react";
import React from "react";
import { Navbar } from "../../components/Navbar";
import { Box1 } from "../../components/Box1";
import { Box2 } from "../../components/Box2";

export default function Projects() {
  const isDesktop = useBreakpointValue({ base: false, lg: true })

  return (
    <div style={{ overscrollBehavior: "contain" }}>
      <title>Kevin Wong</title>
      {isDesktop ? (
        <Box height="100vh" overflow="hidden" position="relative">
          <Flex h="full" id="app-container">
            <Sidebar />
            <Box
              as="section"
              flex="1"
            >
              <Box
                as="section"
                flex="1"
                maxW="4xl"
              >
                <Box as="section" flex="1" p="6">
                  <Alert status="warning" maxW="3xl">
                    <AlertIcon />
                    This page is still under construction! Please check back later :)
                  </Alert>
                  <Box1 top={45} left={50} name="Soon" />
                  <Box1 top={34} left={30} name="Thoughts" />
                  <Box2 top={23} left={67} name="Stuff" />
                </Box>
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
          <Box as="section" flex="1" p="6" marginTop="4">
            <Alert status="warning" maxW="3xl">
              <AlertIcon />
              This page is still under construction! Please check back later :)
            </Alert>
            <Box1 top={45} left={50} name="Soon" />
            <Box1 top={34} left={30} name="Thoughts" />
            <Box2 top={23} left={67} name="Stuff" />
          </Box>
        </Flex>
      )}
    </div>
  );
}