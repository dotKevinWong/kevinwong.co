import { Sidebar } from "../../components/Sidebar";
import { Box, Flex, Text, HStack, Wrap, Tag, Heading, useBreakpointValue, Avatar, VStack, Button, AvatarGroup } from "@chakra-ui/react";
import React from "react";
import { Navbar } from "../../components/Navbar";
import Emoji from "../../components/Emoji";
import { Meta } from "../../components/Meta";
import Link from "next/link";

export default function Projects() {
    const isDesktop = useBreakpointValue({ base: false, lg: true })

    const Page = () => {
        return (
            <Box as="section" position="relative" w="100%" h="100%" p="6">
                <Box pb={4}>
                    <Button asChild colorPalette="blue"><Link href="/projects"><Emoji symbol="backhand-index-pointing-left" label="Backhand Index Pointing Left" />Back</Link></Button>              
                </Box>
                <Flex wrap="wrap">
                    <VStack gap={4} align="left">
                        <Box
                            bg={{ base: 'gray.100', _dark: 'gray.800' }}
                            maxWidth="lg"
                            p={{ base: '6', md: '8' }}
                            rounded={{ sm: 'lg' }}
                            shadow={{ md: 'base' }}
                            maxH="640px"
                        >
                            <VStack gap={4} align="right">
                                <HStack direction={{ base: 'column', md: 'row' }} gap={{ base: '4', md: '8' }}>
                                    <AvatarGroup>
                                        <Avatar.Root size="2xl">
                                            <Avatar.Image src="/cahillclub.png" alt="Cahill Club" />
                                            <Avatar.Fallback>CC</Avatar.Fallback>
                                        </Avatar.Root>
                                    </AvatarGroup>
                                    <VStack gap={1} align="left">
                                        <Heading textAlign="center" size="xl" fontWeight="extrabold" letterSpacing="tight">
                                            Cahill Club
                                        </Heading>
                                        <Text fontFamily="mono" fontSize="md" color={{ base: 'gray.600', _dark: 'gray.400' }}></Text>
                                    </VStack>
                                </HStack>
                                <Text fontSize="lg" color={{ base: 'gray.600', _dark: 'gray.400' }}>
                                    Founded in 1897, the Cahill Club is the fraternal organization of Roman Catholic High School. The club is dedicated to the promotion of the welfare of the school and the fostering of the spirit of brotherhood among its members. The club is open to any former student and alumni of Roman Catholic High School.
                                </Text>
                            </VStack>
                        </Box>
                        <Box
                            bg={{ base: 'gray.100', _dark: 'gray.800' }}
                            maxWidth="lg"
                            p={{ base: '6', md: '8' }}
                            rounded={{ sm: 'lg' }}
                            shadow={{ md: 'base' }}
                            maxH="640px"
                            mb={4}
                        >
                            <VStack gap={4} align="right">
                                <HStack direction={{ base: 'column', md: 'row' }} gap={{ base: '4', md: '8' }}>
                                    <VStack gap={1} align="left">
                                        <Heading textAlign="center" size="xl" fontWeight="extrabold" letterSpacing="tight">
                                            CahillClub.com
                                        </Heading>
                                        <Text fontFamily="mono" fontSize="md" color={{ base: 'gray.600', _dark: 'gray.400' }}></Text>
                                    </VStack>
                                </HStack>
                                <Text fontSize="lg" color={{ base: 'gray.600', _dark: 'gray.400' }}>
                                    The Cahill Club members portal allows members to connect, view upcoming events, and more. The website is built using Next.js, Chakra UI, Supabase, and hosted on Vercel.
                                </Text>
                                <Heading size="md" fontWeight="extrabold">
                                    Technologies Used
                                </Heading>
                                <Wrap gap="2">
                                    <Tag.Root colorPalette="blue">
                                        <Tag.Label>Node.js</Tag.Label>
                                    </Tag.Root>
                                    <Tag.Root colorPalette="green">
                                        <Tag.Label>Next.js</Tag.Label>
                                    </Tag.Root>
                                    <Tag.Root colorPalette="teal">
                                        <Tag.Label>Supabase</Tag.Label>
                                    </Tag.Root>
                                    <Tag.Root colorPalette="yellow">
                                        <Tag.Label>Chakra UI</Tag.Label>
                                    </Tag.Root>
                                    <Tag.Root colorPalette="purple">
                                        <Tag.Label>Vercel</Tag.Label>
                                    </Tag.Root>
                                </Wrap>
                                <Heading size="md" fontWeight="extrabold">
                                    Usage Statistics
                                </Heading>
                                <VStack gap={2} align="right">
                                    <HStack><Heading size="sm" fontWeight="bold">Users: </Heading><Tag.Root colorPalette="blue"><Tag.Label>6,500+</Tag.Label></Tag.Root></HStack>
                                </VStack>
                                <Heading size="md" fontWeight="extrabold">
                                    Links
                                </Heading>
                                <HStack gap={4}>
                                    <Button asChild colorPalette="blue" variant="subtle"><Link href="https://cahillclub.com" target="_blank">Website</Link></Button>
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