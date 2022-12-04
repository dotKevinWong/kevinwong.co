
import { Sidebar } from "../../components/Sidebar";
import { Alert, AlertIcon, Box, Flex, Text } from "@chakra-ui/react";
import React, { useState } from "react";
import { Box1 } from "../../components/Box1";
import { Box2 } from "../../components/Box2";

export default function Home() {
  return (
    <Flex
      as="section"
      direction={{ base: 'column', lg: 'row' }}
      height="100vh"
      bg="bg-canvas"
      overflowY="auto"
    >      <title>Projects • Kevin Wong</title>
      <Sidebar />
      <Flex h="full" id="app-container">
        <Box as="section" flex="1" p="6" marginTop="4">
          <Alert status="warning" maxW="3xl">
            <AlertIcon />
            This page is still under construction!
          </Alert>
          <Box1 top={45} left={50} name="Soon" />
          <Box1 top={34} left={30} name="Thoughts" />
          <Box2 top={23} left={67} name="Stuff" />
        </Box>
      </Flex>
    </Flex>
  );
}