import { Sidebar } from "../../components/Sidebar";
import { Box, Flex, Text, HStack, Wrap, Tag, Heading, useBreakpointValue, Avatar, VStack, Button, AvatarGroup } from "@chakra-ui/react";
import React from "react";
import { Navbar } from "../../components/Navbar";
import Emoji from "../../components/Emoji";
import { Meta } from "../../components/Meta";
import Link from "next/link";

export const DragonBotPage = ({ embedded = false }: { embedded?: boolean }) => {
    return (
        <Box as="section" position="relative" w="100%" h="100%" p="6">
            {!embedded && (
                <Box pb={4}>
                    <Button asChild colorPalette="blue"><Link href="/projects"><Emoji symbol="backhand-index-pointing-left" label="Backhand Index Pointing Left" />Back</Link></Button>
                </Box>
            )}
                <Flex wrap="wrap" direction={embedded ? "column" : { base: "column", lg: "row" }}>
                    <Box
                        bg={{ base: 'gray.100', _dark: '#111111' }}
                        maxWidth={embedded ? "100%" : "lg"}
                        w={embedded ? "100%" : "lg"}
                        p={{ base: '6', md: '8' }}
                        rounded={{ sm: 'lg' }}
                        shadow={{ md: 'base' }}
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
                                <Button asChild colorPalette="blue" variant="subtle"><Link href="https://discord.gg/KCkj4CeMtD" target="_blank">Discord</Link></Button>
                                <Button asChild colorPalette="blue" variant="subtle"><Link href="https://github.com/dotKevinWong/DragonBot" target="_blank">GitHub</Link></Button>
                            </HStack>
                        </VStack>
                    </Box>
                    <Box p={{ base: '2', md: '8' }} maxWidth={embedded ? "100%" : "lg"} w={embedded ? "100%" : "lg"}>
                        <Heading pb={4}>Features</Heading>
                        <VStack gap={3} align="stretch">
                            {[
                                { emoji: "checkmark", label: "checkmark", name: "Verification Sync", desc: "Syncs the Drexel student/alumni status of a user across all servers that use DragonBot" },
                                { emoji: "judge", label: "judge", name: "Ban Sync", desc: "Syncs the ban status of a user across all servers that use DragonBot" },
                                { emoji: "books", label: "books", name: "Course Information", desc: "Provides information about a course, pre-reqs, and more from the Drexel WebTMS system" },
                                { emoji: "cool", label: "smiling face with sunglasses", name: "User Profiles", desc: "Learn more about a member of the server, including their plan, major, co-ops, clubs, and more" },
                                { emoji: "bar-chart", label: "bar chart", name: "Server Statistics", desc: "Provides a variety of server statistics, including membercount, MEE6 leaderboard, and more" },
                                { emoji: "toolbox", label: "red toolbox", name: "Moderation Tools", desc: "Provides a variety of moderation tools, including automated messages, new member tools, and more" },
                                { emoji: "scroll", label: "robot", name: "Logging", desc: "Logs a variety of events, including message edits, deletions, and more" },
                                { emoji: "party-popper", label: "party popper", name: "Fun Commands", desc: "Provides a variety of fun commands, including a LaTeX compiler, d20 dice, and more" },
                            ].map((feature) => (
                                <Box
                                    key={feature.name}
                                    bg={{ base: 'gray.100', _dark: '#111111' }}
                                    p={4}
                                    rounded="lg"
                                    shadow={{ md: 'base' }}
                                >
                                    <HStack gap={4} align="center">
                                        <Text fontSize="2xl" flexShrink={0}><Emoji symbol={feature.emoji} label={feature.label} /></Text>
                                        <VStack align="left" gap={1}>
                                            <Text fontWeight="bold">{feature.name}</Text>
                                            <Text fontSize="sm" color={{ base: 'gray.600', _dark: 'gray.400' }}>{feature.desc}</Text>
                                        </VStack>
                                    </HStack>
                                </Box>
                            ))}
                        </VStack>
                    </Box>
                </Flex>
            </Box >
        )
}

export default function Projects() {
    const isDesktop = useBreakpointValue({ base: false, lg: true })

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
                            <DragonBotPage />
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
                    <DragonBotPage />
                </Flex>
            )
            }
        </div >
    );
}