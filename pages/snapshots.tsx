import { Sidebar } from "../components/Sidebar";
import { Alert, AlertIcon, Box, Flex, Heading } from "@chakra-ui/react";
import React from "react";

export default function Contact() {
    return (
        <Flex
            as="section"
            direction={{ base: 'column', lg: 'row' }}
            height="100vh"
            bg="bg-canvas"
            overflowY="auto"
        >
            <Sidebar />
            <title>Snapshots • Kevin Wong</title>
            <Flex h="full" id="app-container">
                <Box as="section" flex="1" p="6" marginTop="4" overflow="auto">
                    <Alert status="warning" maxW="3xl">
                        <AlertIcon />
                        This page is still under construction! Please check back later :)
                    </Alert>
                </Box>
            </Flex>
        </Flex>
    );
}