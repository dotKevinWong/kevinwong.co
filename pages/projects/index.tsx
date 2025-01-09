import { Sidebar } from "../../components/Sidebar";
import { Alert, AlertDescription, AlertIcon, AlertTitle, Box, Flex, useBreakpointValue } from "@chakra-ui/react";
import React from "react";
import { Navbar } from "../../components/Navbar";
import Folder from "../../components/Folder";
import { Meta } from "../../components/Meta";

const MyAlert = () => {
  const isMobile = useBreakpointValue({ base: true, md: false })

  const alertStyles = isMobile
    ? {
      top: "0",
      left: "50%",
      transform: "translateX(-50%)",
      marginTop: "2",
    }
    : {
    }

  return (
    <Alert
      status="info"
      position="absolute"
      w="100%"
      maxW="360px"
      borderRadius="md"
      boxShadow="md"
      {...alertStyles}
    >
      <AlertIcon />
      <Box>
      <AlertTitle mr={2}>Hint:</AlertTitle>
      <AlertDescription>
      Double click on the folders to open them
      </AlertDescription>
      </Box>
    </Alert>
  )
}

const Page = () => {
  return (
    <Box as="section" position="relative" w="100%" h="100%" p="6" >
      <Flex h="100%">
        <MyAlert />
        <Folder initialPosition={{ x: 38, y: 48 }} imageSrc="/dragonbot_folder.png" title="DragonBot" href="/projects/dragonbot" size={128} />
        <Folder initialPosition={{ x: 12, y: 32 }} imageSrc="/cahillclub_folder.png" title="Cahill Club" href="/projects/cahillclub" size={128} />
        {/* <Folder initialPosition={{ x: 12, y: 32 }} imageSrc="/gray_folder.png" title="Thoughts" href="#" size={128} />
        <Folder initialPosition={{ x: 57, y: 12 }} imageSrc="/yellow_folder.png" title="Stuff" href="#" size={128} /> */}
      </Flex>
    </Box>
  );
};

export default function Projects() {
  const isDesktop = useBreakpointValue({ base: false, lg: true })

  return (
    <div style={{ overscrollBehavior: "contain" }}>
      <Meta title="Projects • Kevin Wong" />
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