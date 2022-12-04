import { Sidebar } from "../components/Sidebar";
import { Box, Flex } from "@chakra-ui/react";
import React from "react";
import useSWR from "swr";
import fetcher from "../lib/fetcher";
import { TopTracks } from "../components/TopTracks";

export default function Stats() {
    const { data } = useSWR("/api/toptracks", fetcher);

    return (
        <Flex
            as="section"
            direction={{ base: 'column', lg: 'row' }}
            height="100vh"
            bg="bg-canvas"
            overflowY="auto"
        >
            <title>Statistics • Kevin Wong</title>
            <Sidebar/>
            <Flex h="full" id="app-container">
                <Box as="section" flex="1" p="4" marginTop="6" overflow="auto">
                    <TopTracks />
                </Box>
            </Flex>
        </Flex>
    );
}