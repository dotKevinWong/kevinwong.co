import { Sidebar } from "../../components/Sidebar";
import { Alert, AlertIcon, Box, Flex, Text, HStack, Icon, Wrap, Tag, Heading, Stack, useBreakpointValue, useColorModeValue, Avatar, VStack, Button, Table, Thead, Tr, Th, Tbody, Td, calc } from "@chakra-ui/react";
import React from "react";
import { Navbar } from "../../components/Navbar";
import Folder from "../../components/Folder";
import Emoji from "../../components/Emoji";

export default function Projects() {
    const isDesktop = useBreakpointValue({ base: false, lg: true })

    const Page = () => {
        return (
            <Box as="section" position="relative" w="100%" h="100%" p="6" marginTop="2">
                <Box pb={4}>
                    <Button as="a" colorScheme="blue" href="/projects"><Emoji symbol="backhand-index-pointing-left" label="Backhand Index Pointing Left"/>Back</Button>
                </Box>
                <Flex wrap="wrap">
                    <Box
                        bg={useColorModeValue('gray.100', 'gray.800')}
                        maxWidth="lg"
                        p={{ base: '6', md: '8' }}
                        rounded={{ sm: 'lg' }}
                        shadow={{ md: 'base' }}
                        maxH="520px"
                    >
                        <VStack spacing={4} align="right">
                            <HStack direction={{ base: 'column', md: 'row' }} spacing={{ base: '4', md: '8' }}>
                                <Avatar size="xl" name="Kevin Wong" src="/dragonbot.png" />
                                <VStack spacing={1} align="left">
                                    <Heading textAlign="center" size="xl" fontWeight="extrabold" letterSpacing="tight">
                                        DragonBot
                                    </Heading>
                                    <Text fontFamily="mono" fontSize="md" color={useColorModeValue('gray.600', 'gray.400')}>DragonBot#5561</Text>
                                </VStack>
                            </HStack>
                            <Text fontSize="lg" color={useColorModeValue('gray.600', 'gray.400')}>
                                DragonBot is a general-purpose Discord bot that is used across multiple Drexel University discord servers.
                            </Text>
                            <Heading size="md" fontWeight="extrabold">
                                Technologies Used
                            </Heading>
                            <Wrap spacing="2">
                                <Tag size="lg" colorScheme="blue">Node.js</Tag>
                                <Tag size="lg" colorScheme="green">Discord.js</Tag>
                                <Tag size="lg" colorScheme="yellow">Firebase</Tag>
                                <Tag size="lg" colorScheme="purple">Heroku</Tag>
                            </Wrap>
                            <Heading size="md" fontWeight="extrabold">
                                Usage Statistics
                            </Heading>
                            <VStack spacing={2} align="right">
                                <HStack><Heading size="sm" fontWeight="bold">Servers: </Heading><Tag size="md" colorScheme="green">13</Tag></HStack>
                                <HStack><Heading size="sm" fontWeight="bold">Users: </Heading><Tag size="md" colorScheme="blue">6,500+</Tag></HStack>
                            </VStack>
                            <Heading size="md" fontWeight="extrabold">
                                Links
                            </Heading>
                            <HStack spacing={4}>
                                <Button as="a" colorScheme="blue" href="https://discord.gg/KCkj4CeMtD" target="_blank">Discord</Button>
                                <Button as="a" colorScheme="blue" href="https://github.com/dotKevinWong/DragonBot" target="_blank">GitHub</Button>
                            </HStack>
                        </VStack>
                    </Box>
                    <Box p={{ base: '6', md: '8' }} maxW={{ base: "100%", lg: "calc(100% - 540px)" }} minW="480px">
                        <Heading pb={4}>Features</Heading>
                        <Table variant="unstyled">
                            <Thead>
                                <Tr>
                                    <Th>Feature</Th>
                                    <Th>Description</Th>
                                </Tr>
                            </Thead>
                            <Tbody>
                                <Tr>
                                    <Td><HStack><Emoji symbol="checkmark" label="checkmark"/><Text fontWeight="bold">Verification Sync</Text></HStack></Td>
                                    <Td>Syncs the Drexel student/alumni status of a user across all servers that use DragonBot</Td>
                                </Tr>
                                <Tr>
                                    <Td><HStack><Emoji symbol="judge" label="judge"/><Text fontWeight="bold">Ban Sync</Text></HStack></Td>
                                    <Td>Syncs the ban status of a user across all servers that use DragonBot.</Td>
                                </Tr>
                                <Tr>
                                    <Td><HStack><Emoji symbol="books" label="books"/><Text fontWeight="bold">Course Information</Text></HStack></Td>
                                    <Td>Provides information about a course, pre-reqs, and more from the Drexel WebTMS system</Td>
                                </Tr>
                                <Tr>
                                    <Td><HStack><Emoji symbol="cool" label="smiling face with sunglasses"/><Text fontWeight="bold">User Profiles</Text></HStack></Td>
                                    <Td>Learn more about a member of the server, including their plan, major, co-ops, clubs, and more</Td>
                                </Tr>
                                <Tr>
                                    <Td><HStack><Emoji symbol="bar-chart" label="bar chart"/><Text fontWeight="bold">Server Statistics</Text></HStack></Td>
                                    <Td>Provides a variety of server statistics, including membercount, MEE6 leaderboard, and more.</Td>
                                </Tr>
                                <Tr>
                                    <Td><HStack><Emoji symbol="toolbox" label="red toolbox"/><Text fontWeight="bold">Moderation Tools</Text></HStack></Td>
                                    <Td>Provides a variety of moderation tools, including automated messages, new member tools, and more</Td>
                                </Tr>
                                <Tr>
                                    <Td><HStack><Emoji symbol="party-popper" label="party popper"/><Text fontWeight="bold">Fun Commands</Text></HStack></Td>
                                    <Td>Provides a variety of fun commands, including a LaTeX compiler, d20 dice, and more</Td>
                                </Tr>
                            </Tbody>
                        </Table>
                    </Box>
                </Flex>
            </Box >
        )
    }

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