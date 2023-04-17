import { Sidebar } from "../components/Sidebar";
import { Box, Flex, Heading, Text, useBreakpointValue, VStack } from "@chakra-ui/react";
import React from "react";
import { Navbar } from "../components/Navbar";

const Page = () => {
    return (
        <Box as="section" position="relative" w="100%" h="100%" p="6" marginTop="2">
        <VStack align="left">
            <Heading>404 | Page not found</Heading>
            <Text>The page you were looking for could not be found.</Text>
            <VStack align="left">
                <Text>• There is an error in the URL entered into your web browser. Please check the URL and try again.</Text>
                <Text>• The page you are looking for has been moved or deleted.</Text>
            </VStack>
        </VStack>
        </Box>
    );
};


export default function Error() {
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
                            >
                                <Page />
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
                    <Page />
                </Flex>
            )}
        </div>
    );
}