import { Box, Button, Flex, Heading, HStack, Image, Stack, Tag, Text, Wrap } from "@chakra-ui/react";
import React from "react";
import { LuArrowUpRight } from "react-icons/lu";
import type { Project } from "./data";

const groupBg = { base: "blackAlpha.50", _dark: "whiteAlpha.50" };
const groupBorder = { base: "blackAlpha.100", _dark: "whiteAlpha.100" };

export const ProjectLogo = ({ project, size }: { project: Project; size: string }) => (
  <Box
    boxSize={size}
    flexShrink={0}
    borderRadius="22%"
    overflow="hidden"
    bg="white"
    p={project.logoFit === "contain" ? "3px" : 0}
    boxShadow="0 1px 3px rgba(0,0,0,0.18), 0 0 0 0.5px rgba(0,0,0,0.12)"
  >
    <Image src={project.logo} alt="" boxSize="full" objectFit={project.logoFit} draggable={false} />
  </Box>
);

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <Stack as="section" gap="2">
    <Heading as="h2" fontSize="sm" fontWeight="semibold">
      {title}
    </Heading>
    {children}
  </Stack>
);

/** A macOS-style grouped list: a rounded box of rows separated by inset hairlines. */
const Group = ({ children }: { children: React.ReactNode }) => (
  <Box
    borderRadius="lg"
    borderWidth="1px"
    borderColor={groupBorder}
    bg={groupBg}
    css={{ "& > * + *": { borderTopWidth: "1px", borderColor: "inherit" } }}
  >
    {children}
  </Box>
);

export const ProjectDetail = ({ project }: { project: Project }) => (
  <Stack gap="6" p={{ base: "5", md: "6" }} maxW="3xl" fontSize="sm" lineHeight="1.55">
    <Flex gap="4" align="center">
      <ProjectLogo project={project} size="64px" />
      <Box minW="0">
        <Heading as="h1" fontSize="2xl" fontWeight="bold" letterSpacing="tight" lineHeight="1.2">
          {project.name}
        </Heading>
        <Text fontFamily="mono" fontSize="sm" color="fg.muted">
          {project.subtitle}
        </Text>
      </Box>
    </Flex>

    <HStack gap="2" wrap="wrap">
      {project.links.map((link, i) => (
        <Button
          key={link.href}
          asChild
          size="sm"
          colorPalette="blue"
          variant={i === 0 ? "solid" : "outline"}
          borderRadius="md"
        >
          <a href={link.href} target="_blank" rel="noopener noreferrer">
            {link.label}
            <LuArrowUpRight />
          </a>
        </Button>
      ))}
    </HStack>

    {project.sections.map((section) => (
      <Section key={section.title} title={section.title}>
        <Text color={{ base: "gray.700", _dark: "gray.300" }}>{section.body}</Text>
      </Section>
    ))}

    {project.tagGroups.map((group) => (
      <Section key={group.title} title={group.title}>
        <Wrap gap="1.5">
          {group.tags.map((tag) => (
            <Tag.Root key={tag.label} colorPalette={tag.color} variant="subtle" borderRadius="full" size="md">
              <Tag.Label>{tag.label}</Tag.Label>
            </Tag.Root>
          ))}
        </Wrap>
      </Section>
    ))}

    {project.stats && (
      <Section title="Usage Statistics">
        <Group>
          {project.stats.map((stat) => (
            <Flex key={stat.label} justify="space-between" px="3.5" py="2.5">
              <Text>{stat.label}</Text>
              <Text fontWeight="semibold" fontVariantNumeric="tabular-nums">
                {stat.value}
              </Text>
            </Flex>
          ))}
        </Group>
      </Section>
    )}

    {project.features && (
      <Section title="Features">
        <Group>
          {project.features.map((feature) => (
            <Flex key={feature.name} gap="3" align="center" px="3.5" py="3">
              <Image src={`/emojis/${feature.emoji}.png`} alt="" boxSize="6" flexShrink={0} />
              <Box minW="0">
                <Text fontWeight="semibold">{feature.name}</Text>
                <Text color="fg.muted" fontSize="xs" lineHeight="1.45">
                  {feature.desc}
                </Text>
              </Box>
            </Flex>
          ))}
        </Group>
      </Section>
    )}
  </Stack>
);
