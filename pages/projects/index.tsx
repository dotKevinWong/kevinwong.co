import { Sidebar } from "../../components/Sidebar";
import { Alert, AlertIcon, Box, Flex, Stack, useBreakpointValue } from "@chakra-ui/react";
import React from "react";
import { Navbar } from "../../components/Navbar";
import Folder from "../../components/Folder";

const Page = () => {
  return (
    <Box as="section" position="relative" w="100%" h="100%" p="6" marginTop="4">
    <Flex h="100%">
    <Folder initialPosition={{ x: 38, y: 48 }} imageSrc="/dragonbot_folder.png" title="DragonBot" href="/projects/dragonbot" size={128} />
    <Folder initialPosition={{ x: 12, y: 32 }} imageSrc="/gray_folder.png" title="Thoughts" size={128} />
    <Folder initialPosition={{ x: 57, y: 12 }} imageSrc="/yellow_folder.png" title="Stuff" size={128} />
    </Flex>
</Box>
  );
};



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
              <Page />
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
          <Page />
        </Flex>
      )}
    </div>
  );
}