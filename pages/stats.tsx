import { Sidebar } from "../components/Sidebar";
import { Box, Flex, useBreakpointValue } from "@chakra-ui/react";
import React from "react";
import { Navbar } from "../components/Navbar";
import { StatisticsPage } from "../components/pages/Statistics";
import { Meta } from "../components/Meta";

export default function Statistics() {
    const isDesktop = useBreakpointValue({ base: false, lg: true })

    return (
        <div>
            <Meta title="Statistics • Kevin Wong" />
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
                                marginLeft={8}
                                marginRight={8}
                            >
                                <StatisticsPage />
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
                    <StatisticsPage />
                </Flex>
            )}
        </div>
    );
}