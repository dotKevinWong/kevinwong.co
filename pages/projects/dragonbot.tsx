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
                <Flex wrap="wrap" direction={embedded ? "column" : "row"} align="start" gap={{ base: 4, lg: 0 }}>
                    <Box
                        bg={{ base: 'gray.100', _dark: '#111111' }}
                        flex={embedded ? undefined : "1 1 400px"}
                        maxWidth={embedded ? "100%" : "lg"}
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
                                DragonBot is a Discord bot built for Drexel University communities, featuring email verification, moderation tools, user profiles, AI Q&A, XP/leveling, polls, suggestions, YouTube notifications, scheduled messages, birthday tracking, audit logging, and a full web dashboard.
                            </Text>
                            <Heading size="md" fontWeight="extrabold">
                                Technologies Used
                            </Heading>
                            <Wrap gap="2">
                                <Tag.Root colorPalette="blue">
                                    <Tag.Label>TypeScript</Tag.Label>
                                </Tag.Root>
                                <Tag.Root colorPalette="green">
                                    <Tag.Label>Discord.js</Tag.Label>
                                </Tag.Root>
                                <Tag.Root colorPalette="cyan">
                                    <Tag.Label>Next.js</Tag.Label>
                                </Tag.Root>
                                <Tag.Root colorPalette="purple">
                                    <Tag.Label>PostgreSQL</Tag.Label>
                                </Tag.Root>
                                <Tag.Root colorPalette="orange">
                                    <Tag.Label>Drizzle ORM</Tag.Label>
                                </Tag.Root>
                                <Tag.Root colorPalette="teal">
                                    <Tag.Label>Tailwind CSS</Tag.Label>
                                </Tag.Root>
                                <Tag.Root colorPalette="yellow">
                                    <Tag.Label>OpenAI</Tag.Label>
                                </Tag.Root>
                                <Tag.Root colorPalette="red">
                                    <Tag.Label>Turborepo</Tag.Label>
                                </Tag.Root>
                            </Wrap>
                            <Heading size="md" fontWeight="extrabold">
                                Deployment
                            </Heading>
                            <Wrap gap="2">
                                <Tag.Root colorPalette="purple">
                                    <Tag.Label>Railway (Bot)</Tag.Label>
                                </Tag.Root>
                                <Tag.Root colorPalette="blue">
                                    <Tag.Label>Vercel (Web)</Tag.Label>
                                </Tag.Root>
                                <Tag.Root colorPalette="green">
                                    <Tag.Label>Neon (Database)</Tag.Label>
                                </Tag.Root>
                            </Wrap>
                            <Heading size="md" fontWeight="extrabold">
                                Links
                            </Heading>
                            <HStack gap={4}>
                                <Button asChild colorPalette="blue" variant="subtle"><Link href="https://discord.gg/KCkj4CeMtD" target="_blank">Discord</Link></Button>
                                <Button asChild colorPalette="blue" variant="subtle"><Link href="https://github.com/drexelDiscord/dragonbot" target="_blank">GitHub</Link></Button>
                            </HStack>
                        </VStack>
                    </Box>
                    <Box pt={embedded ? 4 : 0} px={embedded ? 0 : { base: '0', lg: '8' }} pb={embedded ? 4 : { base: '2', lg: '8' }} flex={embedded ? undefined : "1 1 400px"} maxWidth={embedded ? "100%" : "lg"}>
                        <Heading pb={4}>Features</Heading>
                        <VStack gap={3} align="stretch">
                            {[
                                { emoji: "checkmark", label: "checkmark", name: "Email Verification", desc: "Verify Drexel students with @drexel.edu emails, with cross-server sync across all DragonBot guilds" },
                                { emoji: "judge", label: "judge", name: "Ban Sync", desc: "Automatically propagate bans across all servers with ban sync enabled" },
                                { emoji: "cool", label: "smiling face with sunglasses", name: "User Profiles", desc: "Shareable profiles with name, pronouns, major, college, year, plan, co-ops, clubs, and more" },
                                { emoji: "robot", label: "robot", name: "AI Q&A", desc: "AI powered /ask command with per-server custom system prompts" },
                                { emoji: "bar-chart", label: "bar chart", name: "XP & Leveling", desc: "XP system with in-memory caching, leaderboards, level-up announcements, and archive/restore" },
                                { emoji: "light-bulb", label: "light bulb", name: "Suggestions", desc: "Community feature requests with status tracking and web dashboard management" },
                                { emoji: "checkmark", label: "ballot box", name: "Polls", desc: "Reaction-based polls with up to 20 options and custom emoji support" },
                                { emoji: "television", label: "television", name: "YouTube Notifications", desc: "Upload alerts for subscribed YouTube channels with custom messages" },
                                { emoji: "birthday-cake", label: "birthday cake", name: "Birthday Tracking", desc: "Set birthdays with automated per-server announcements and configurable timezone support" },
                                { emoji: "clock", label: "clock", name: "Scheduled Messages", desc: "Automated recurring messages with cron scheduling, timezone support, and embed customization" },
                                { emoji: "globe-with-meridians", label: "globe", name: "Web Dashboard", desc: "Full-featured dashboard to manage server settings, profiles, schedules, suggestions, and YouTube subscriptions" },
                                { emoji: "scroll", label: "scroll", name: "Audit Logging", desc: "Log embeds for joins, leaves, bans, kicks, message edits/deletes, role and nickname changes, and voice activity" },
                                { emoji: "waving-hand", label: "waving hand", name: "Welcome", desc: "Customizable channel and DM welcome messages" },
                                { emoji: "toolbox", label: "red toolbox", name: "Moderation Tools", desc: "Bot announcements, mod notes, message gating, and granular guild manager permissions with 12+ delegation scopes" },
                                { emoji: "party-popper", label: "party popper", name: "Fun Commands", desc: "Dice rolls, LaTeX rendering, and more" },
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