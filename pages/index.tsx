import { Sidebar } from "../components/Sidebar";
import { Box, Flex, useBreakpointValue } from "@chakra-ui/react";
import React from "react";
import { Navbar } from "../components/Navbar";
import { HomePage } from "../components/pages/Home";
import { Meta } from "../components/Meta";

export default function Home() {
  const isDesktop = useBreakpointValue({ base: false, lg: true })

  return (
    <div>
      <Meta title="Kevin Wong" ogDesc="I'm Kevin, a Software Engineer based in Philly. 2022 B.S. Software Engineering from Drexel University. Consultant at SAP."/>
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