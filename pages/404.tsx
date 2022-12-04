import useSWR from "swr";
import fetcher from "../lib/fetcher";
import { Sidebar } from "../components/Sidebar";
import { Box, Text, Flex, HStack, Image, VStack, Link, Heading } from "@chakra-ui/react";

export default function Home() {
    const { data } = useSWR("/api/nowplaying", fetcher);

    return (
        <Flex
            as="section"
            direction={{ base: 'column', lg: 'row' }}
            height="100vh"
            bg="bg-canvas"
            overflowY="auto"
        >
            <title>Kevin Wong</title>
            <Sidebar />
            <Flex h="full" id="app-container">
                <Box as="section" flex="1" p="6" marginTop="4" overflow="auto">
                    <VStack align="left">
                        <Heading>404 | Page not found</Heading>
                        <Text>The page you were looking for could not be found.</Text>
                        <VStack align="left">
                            <Text>• There is an error in the URL entered into your web browser. Please check the URL and try again.</Text>
                            <Text>• The page you are looking for has been moved or deleted.</Text>
                        </VStack>
                    </VStack>
                </Box>
            </Flex>
        </Flex>
    );
}