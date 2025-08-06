import { Sidebar } from "../../components/Sidebar";
import { Box, Flex, Text, HStack, Wrap, Tag, Heading, useBreakpointValue, Avatar, VStack, Button, Table, AvatarGroup } from "@chakra-ui/react";
import React from "react";
import { Navbar } from "../../components/Navbar";
import Emoji from "../../components/Emoji";
import { Meta } from "../../components/Meta";

export default function Projects() {
    const isDesktop = useBreakpointValue({ base: false, lg: true })

    const Page = () => {
        return (
            <Box as="section" position="relative" w="100%" h="100%" p="6">
                <Box pb={4}>
                    <Button asChild colorPalette="blue"><a href="/projects"><Emoji symbol="backhand-index-pointing-left" label="Backhand Index Pointing Left" />Back</a></Button>
                </Box>
                <Flex wrap="wrap">
                    <Box
                        bg={{ base: 'white', _dark: 'gray.800' }}
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
                                        <Avatar.Image src="/dragonbot.png" alt="DragonBot" />
                                        <Avatar.Fallback>DB</Avatar.Fallback>
                                    </Avatar.Root>
                                </AvatarGroup>
                                <VStack gap={1} align="left">
                                    <Heading size="2xl" fontWeight="extrabold" letterSpacing="tight">
                                        DragonBot
                                    </Heading>
                                    <Text fontFamily="mono" fontSize="lg" color={{ base: 'gray.600', _dark: 'gray.400' }}>DragonBot#5561</Text>
                                </VStack>
                            </HStack>
                            <Text fontSize="lg" color={{ base: 'gray.600', _dark: 'gray.400' }}>
                                DragonBot is a general-purpose Discord bot that is used across multiple Drexel University discord servers.
                            </Text>
                            <Heading size="md" fontWeight="extrabold">
                                Technologies Used
                            </Heading>
                            <Wrap gap="2">
                                <Tag.Root colorPalette="blue">
                                    <Tag.Label>Node.js</Tag.Label>
                                </Tag.Root>
                                <Tag.Root colorPalette="green">
                                    <Tag.Label>Discord.js</Tag.Label>
                                </Tag.Root>
                                <Tag.Root colorPalette="yellow">
                                    <Tag.Label>Firebase</Tag.Label>
                                </Tag.Root>
                                <Tag.Root colorPalette="purple">
                                    <Tag.Label>Heroku</Tag.Label>
                                </Tag.Root>
                            </Wrap>
                            <Heading size="md" fontWeight="extrabold">
                                Usage Statistics
                            </Heading>
                            <VStack gap={2} align="right">
                                <HStack><Heading size="sm" fontWeight="bold">Servers: </Heading><Tag.Root colorPalette="green"><Tag.Label>13</Tag.Label></Tag.Root></HStack>
                                <HStack><Heading size="sm" fontWeight="bold">Users: </Heading><Tag.Root colorPalette="blue"><Tag.Label>6,500+</Tag.Label></Tag.Root></HStack>
                            </VStack>
                            <Heading size="md" fontWeight="extrabold">
                                Links
                            </Heading>
                            <HStack gap={4}>
                                <Button asChild colorPalette="blue" variant="subtle"><a href="https://discord.gg/KCkj4CeMtD" target="_blank">Discord</a></Button>
                                <Button asChild colorPalette="blue" variant="subtle"><a href="https://github.com/dotKevinWong/DragonBot" target="_blank">GitHub</a></Button>
                            </HStack>
                        </VStack>
                    </Box>
                    <Box p={{ base: '2', md: '8' }} maxW={{ base: "100%", lg: "calc(100% - 540px)" }} minW="360px">
                        <Heading pb={4}>Features</Heading>
                        <Table.Root>
                            <Table.Header>
                                <Table.Row>
                                    <Table.Cell>Feature</Table.Cell>
                                    <Table.Cell>Description</Table.Cell>
                                </Table.Row>
                            </Table.Header>
                            <Table.Body>
                                <Table.Row>
                                    <Table.Cell><HStack><Emoji symbol="checkmark" label="checkmark" /><Text fontWeight="bold">Verification Sync</Text></HStack></Table.Cell>
                                    <Table.Cell>Syncs the Drexel student/alumni status of a user across all servers that use DragonBot</Table.Cell>
                                </Table.Row>
                                <Table.Row>
                                    <Table.Cell><HStack><Emoji symbol="judge" label="judge" /><Text fontWeight="bold">Ban Sync</Text></HStack></Table.Cell>
                                    <Table.Cell>Syncs the ban status of a user across all servers that use DragonBot.</Table.Cell>
                                </Table.Row>
                                <Table.Row>
                                    <Table.Cell><HStack><Emoji symbol="books" label="books" /><Text fontWeight="bold">Course Information</Text></HStack></Table.Cell>
                                    <Table.Cell>Provides information about a course, pre-reqs, and more from the Drexel WebTMS system</Table.Cell>
                                </Table.Row>
                                <Table.Row>
                                    <Table.Cell><HStack><Emoji symbol="cool" label="smiling face with sunglasses" /><Text fontWeight="bold">User Profiles</Text></HStack></Table.Cell>
                                    <Table.Cell>Learn more about a member of the server, including their plan, major, co-ops, clubs, and more</Table.Cell>
                                </Table.Row>
                                <Table.Row>
                                    <Table.Cell><HStack><Emoji symbol="bar-chart" label="bar chart" /><Text fontWeight="bold">Server Statistics</Text></HStack></Table.Cell>
                                    <Table.Cell>Provides a variety of server statistics, including membercount, MEE6 leaderboard, and more.</Table.Cell>
                                </Table.Row>
                                <Table.Row>
                                    <Table.Cell><HStack><Emoji symbol="toolbox" label="red toolbox" /><Text fontWeight="bold">Moderation Tools</Text></HStack></Table.Cell>
                                    <Table.Cell>Provides a variety of moderation tools, including automated messages, new member tools, and more</Table.Cell>
                                </Table.Row>
                                <Table.Row>
                                    <Table.Cell><HStack><Emoji symbol="scroll" label="robot" /><Text fontWeight="bold">Logging</Text></HStack></Table.Cell>
                                    <Table.Cell>Logs a variety of events, including message edits, deletions, and more</Table.Cell>
                                </Table.Row>
                                <Table.Row>
                                    <Table.Cell><HStack><Emoji symbol="party-popper" label="party popper" /><Text fontWeight="bold">Fun Commands</Text></HStack></Table.Cell>
                                    <Table.Cell>Provides a variety of fun commands, including a LaTeX compiler, d20 dice, and more</Table.Cell>
                                </Table.Row>
                            </Table.Body>
                        </Table.Root>
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