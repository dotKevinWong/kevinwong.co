import { Sidebar } from "../../components/Sidebar";
import { Box, Flex, Text, HStack, Wrap, Tag, Heading, useBreakpointValue, useColorModeValue, Avatar, VStack, Button, Table, Thead, Tr, Th, Tbody, Td, Container, Stack, Tabs, TabList, Tab, TabIndicator } from "@chakra-ui/react";
import React from "react";
import { Navbar } from "../../components/Navbar";
import Folder from "../../components/Folder";
import Emoji from "../../components/Emoji";
import { Meta } from "../../components/Meta";

export default function Projects() {
    const isDesktop = useBreakpointValue({ base: false, lg: true })

    const Page = () => {
        return (
            <Box as="section" position="relative" w="100%" h="100%" p="6">
                <Box pb={4}>
                    <Button as="a" colorScheme="blue" href="/projects"><Emoji symbol="backhand-index-pointing-left" label="Backhand Index Pointing Left" />Back</Button>
                </Box>
                <Flex wrap="wrap">
                    <VStack spacing={4} align="left">
                        <Box
                            bg={useColorModeValue('gray.100', 'gray.800')}
                            maxWidth="lg"
                            p={{ base: '6', md: '8' }}
                            rounded={{ sm: 'lg' }}
                            shadow={{ md: 'base' }}
                            maxH="640px"
                        >
                            <VStack spacing={4} align="right">
                                <HStack direction={{ base: 'column', md: 'row' }} spacing={{ base: '4', md: '8' }}>
                                    <Avatar size="xl" name="Cahill Club" src="/cahillclub.png" />
                                    <VStack spacing={1} align="left">
                                        <Heading textAlign="center" size="xl" fontWeight="extrabold" letterSpacing="tight">
                                            Cahill Club
                                        </Heading>
                                        <Text fontFamily="mono" fontSize="md" color={useColorModeValue('gray.600', 'gray.400')}></Text>
                                    </VStack>
                                </HStack>
                                <Text fontSize="lg" color={useColorModeValue('gray.600', 'gray.400')}>
                                    Founded in 1897, the Cahill Club is the fraternal organization of Roman Catholic High School. The club is dedicated to the promotion of the welfare of the school and the fostering of the spirit of brotherhood among its members. The club is open to any former student and alumni of Roman Catholic High School.
                                </Text>
                            </VStack>
                        </Box>
                        <Box
                            bg={useColorModeValue('gray.100', 'gray.800')}
                            maxWidth="lg"
                            p={{ base: '6', md: '8' }}
                            rounded={{ sm: 'lg' }}
                            shadow={{ md: 'base' }}
                            maxH="640px"
                            mb={4}
                        >
                            <VStack spacing={4} align="right">
                                <HStack direction={{ base: 'column', md: 'row' }} spacing={{ base: '4', md: '8' }}>
                                    <VStack spacing={1} align="left">
                                        <Heading textAlign="center" size="xl" fontWeight="extrabold" letterSpacing="tight">
                                            CahillClub.com
                                        </Heading>
                                        <Text fontFamily="mono" fontSize="md" color={useColorModeValue('gray.600', 'gray.400')}></Text>
                                    </VStack>
                                </HStack>
                                <Text fontSize="lg" color={useColorModeValue('gray.600', 'gray.400')}>
                                    The Cahill Club members portal allows members to connect, view upcoming events, and more. The website is built using Next.js, Chakra UI, Supabase, and hosted on Vercel.
                                </Text>
                                <Heading size="md" fontWeight="extrabold">
                                    Technologies Used
                                </Heading>
                                <Wrap spacing="2">
                                    <Tag size="lg" colorScheme="blue">Node.js</Tag>
                                    <Tag size="lg" colorScheme="green">Next.js</Tag>
                                    <Tag size="lg" colorScheme="yellow">Supabase</Tag>
                                    <Tag size="lg" colorScheme="teal">Chakra UI</Tag>
                                    <Tag size="lg" colorScheme="purple">Vercel</Tag>
                                </Wrap>
                                <Heading size="md" fontWeight="extrabold">
                                    Usage Statistics
                                </Heading>
                                <VStack spacing={2} align="right">
                                    <HStack><Heading size="sm" fontWeight="bold">Users: </Heading><Tag size="md" colorScheme="blue">6,500+</Tag></HStack>
                                </VStack>
                                <Heading size="md" fontWeight="extrabold">
                                    Links
                                </Heading>
                                <HStack spacing={4}>
                                    <Button as="a" colorScheme="blue" href="https://cahillclub.com" target="_blank">Website</Button>
                                </HStack>
                            </VStack>
                        </Box>
                    </VStack>
                    <Box p={{ base: '2', md: '8' }} maxW={{ base: "100%", lg: "calc(100% - 540px)" }} minW="360px">
                        <Text>Coming Soon...</Text>
                    </Box>
                </Flex>
            </Box >
        )
    }

    return (
        <div style={{ overscrollBehavior: "contain" }}>
            <Meta title="DragonBot • Kevin Wong" />
            {isDesktop ? (
                <Box height="100vh" overflow="hidden">
                    <Flex h="full" id="app-container">
                        <Sidebar />
                        <Box
                            as="section"
                            flex="1"
                            overflow="auto"
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
            )
            }
        </div >
    );
}