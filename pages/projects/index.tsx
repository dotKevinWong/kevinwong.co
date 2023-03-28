import { Sidebar } from "../../components/Sidebar";
import { Alert, AlertIcon, Box, Flex, Stack, useBreakpointValue } from "@chakra-ui/react";
import React from "react";
import { Navbar } from "../../components/Navbar";
import { Box1 } from "../../components/Box1";
import { Box2 } from "../../components/Box2";
import Folder from "../../components/Folder";
import { Icon } from "@chakra-ui/icon";

export default function Projects() {
  const isDesktop = useBreakpointValue({ base: false, lg: true })

  return (
    <div style={{ overscrollBehavior: "contain" }}>
      <title>Kevin Wong</title>
      {isDesktop ? (
        <Box height="100vh" overflow="hidden">
          <Flex h="full" id="app-container">
            <Sidebar />
            <Box
              as="section"
              flex="1"
            >
                <Box as="section" position="relative" w="100%" h="100%" p="6" marginTop="4">
                  <Flex h="100%">
                  <Box>
                  <Alert status="warning" maxW="3xl">
                    <AlertIcon />
                    This page is still under construction! Please check back later :)
                  </Alert>
                  </Box>
                  <Folder initialPosition={{ x: 40, y: 45 }} imageSrc="/gray_folder.png" title="Soon" size={128} />
                  <Folder initialPosition={{ x: 15, y: 34 }} imageSrc="/gray_folder.png" title="Thoughts" size={128} />
                  <Folder initialPosition={{ x: 57, y: 27 }} imageSrc="/yellow_folder.png" title="Stuff" size={128} />
                  </Flex>
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
            <Folder initialPosition={{ x: 40, y: 45 }} imageSrc="/gray_folder.png" title="Soon" size={128} />
            <Folder initialPosition={{ x: 15, y: 34 }} imageSrc="/gray_folder.png" title="Thoughts" size={128} />
            <Folder initialPosition={{ x: 57, y: 27 }} imageSrc="/yellow_folder.png" title="Stuff" size={128} />
          </Box>
        </Flex>
      )}
    </div>
  );
}