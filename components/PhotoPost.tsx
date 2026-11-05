import { useCallback, useMemo, useState } from "react"
import { AspectRatio, Badge, Box, Flex, IconButton, Image, Link, Text, chakra } from "@chakra-ui/react"
import { FiChevronLeft, FiChevronRight, FiExternalLink, FiInstagram } from "react-icons/fi"
import { SURFACE_BG } from "./Card"

// Instagram's feed range, from 3:4 portrait to 1.91:1 landscape. lib/image-resize.js
// keeps 3:4 photos whole, so the frame shouldn't crop them to 4:5.
const INSTAGRAM_MIN_RATIO = 3 / 4
const INSTAGRAM_MAX_RATIO = 1.91

export interface SnapshotMedia {
    id: string;
    position: number;
    kind: "image" | "video";
    url: string;
    publicId?: string;
    width?: number | null;
    height?: number | null;
}

interface PhotoPostProps {
    postId: string;
    // Every slide of the post, from /api/snapshots.
    media: SnapshotMedia[];
    mediaCount: number;
    description: string;
    date: string;
    sourceHref?: string | null;
    sourceName?: string;
}

const normalizeIndex = (index: number, count: number) => {
    if (count <= 0) {
        return 0
    }

    return ((index % count) + count) % count
}

const buildMediaByPosition = (media: SnapshotMedia[]) => {
    return media.reduce<Record<number, SnapshotMedia>>((acc, item) => {
        acc[item.position] = item
        return acc
    }, {})
}

// The dots show a slide at full opacity once it is "seen": the same slides that
// used to be fetched on demand. That is slide 0 at first, then each slide moved
// to, plus the one after it in a carousel of three or more.
const initialSeen = () => new Set([0])

export const PhotoPost = (props: PhotoPostProps) => {
    const [mediaIndex, setMediaIndex] = useState(0)
    const [seenPositions, setSeenPositions] = useState<Set<number>>(initialSeen)

    // Snapshots keys each card by post id, so a different post remounts it. This
    // starts the carousel over when the same post is handed a new media array.
    const [shownMedia, setShownMedia] = useState(props.media)
    if (shownMedia !== props.media) {
        setShownMedia(props.media)
        setMediaIndex(0)
        setSeenPositions(initialSeen())
    }

    const mediaByPosition = useMemo(() => buildMediaByPosition(props.media), [props.media])
    const mediaCount = Math.max(props.mediaCount, props.media.length)
    const normalizedIndex = normalizeIndex(mediaIndex, mediaCount)
    const activeMedia = mediaByPosition[normalizedIndex]

    const goToPosition = useCallback((nextPosition: number) => {
        const nextIndex = normalizeIndex(nextPosition, mediaCount)

        setMediaIndex(nextIndex)

        const newlySeen = [nextIndex]
        if (mediaCount > 2) {
            newlySeen.push(normalizeIndex(nextIndex + 1, mediaCount))
        }
        setSeenPositions((prev) => (
            newlySeen.every((position) => prev.has(position)) ? prev : new Set([...prev, ...newlySeen])
        ))
    }, [mediaCount])

    const handlePrevious = () => {
        goToPosition(mediaIndex - 1)
    }

    const handleNext = () => {
        goToPosition(mediaIndex + 1)
    }

    const sourceName = props.sourceName || "Instagram"
    const altText = props.description || activeMedia?.publicId || "Snapshot"

    const activeRatio = useMemo(() => {
        if (!activeMedia?.width || !activeMedia?.height) {
            return 1
        }

        const ratio = activeMedia.width / activeMedia.height
        return Math.min(INSTAGRAM_MAX_RATIO, Math.max(INSTAGRAM_MIN_RATIO, ratio))
    }, [activeMedia])

    return (
        <Box p="5" maxW="320px" w={{ base: "100%", sm: "320px" }} borderWidth="1px" minH="320px" rounded={{ sm: "lg" }}
            shadow={{ md: "sm" }} bg={SURFACE_BG}>
            <Box position="relative">
                <AspectRatio ratio={activeRatio} maxH="400px">
                    {activeMedia ? (
                        activeMedia.kind === "video" ? (
                            <chakra.video
                                borderRadius="md"
                                src={activeMedia.url}
                                controls
                                playsInline
                                preload="metadata"
                                style={{ width: "100%", height: "100%", objectFit: "cover" }}
                            />
                        ) : (
                            <Image
                                borderRadius="md"
                                src={activeMedia.url}
                                alt={altText}
                                loading="lazy"
                                objectFit="cover"
                                w="100%"
                                h="100%"
                            />
                        )
                    ) : (
                        <Flex borderRadius="md" align="center" justify="center" bg={{ base: "gray.200", _dark: "gray.700" }}>
                            <Text fontSize="sm" color={{ base: "gray.700", _dark: "gray.200" }}>No media available</Text>
                        </Flex>
                    )}
                </AspectRatio>

                {mediaCount > 1 ? (
                    <>
                        <IconButton
                            aria-label="Previous media"
                            size="sm"
                            variant="solid"
                            position="absolute"
                            left="2"
                            top="50%"
                            transform="translateY(-50%)"
                            onClick={handlePrevious}
                        >
                            <FiChevronLeft />
                        </IconButton>
                        <IconButton
                            aria-label="Next media"
                            size="sm"
                            variant="solid"
                            position="absolute"
                            right="2"
                            top="50%"
                            transform="translateY(-50%)"
                            onClick={handleNext}
                        >
                            <FiChevronRight />
                        </IconButton>
                    </>
                ) : null}
            </Box>

            {mediaCount > 1 ? (
                <Flex mt={2} gap={1} justify="center">
                    {Array.from({ length: mediaCount }).map((_, index) => {
                        const isSeen = seenPositions.has(index) && Boolean(mediaByPosition[index])

                        return (
                            <chakra.button
                                key={`${props.postId}-${index}`}
                                type="button"
                                aria-label={`View media ${index + 1}`}
                                onClick={() => goToPosition(index)}
                                w="2"
                                h="2"
                                borderRadius="full"
                                opacity={isSeen ? 1 : 0.6}
                                bg={index === normalizedIndex ? "pink.500" : "gray.400"}
                            />
                        )
                    })}
                </Flex>
            ) : null}

            <Flex align="baseline" mt={3}>
                <Badge colorPalette="pink">
                    <FiInstagram />
                    {props.sourceHref ? (
                        <Link href={props.sourceHref} target="_blank" rel="noreferrer">
                            {sourceName} <FiExternalLink />
                        </Link>
                    ) : (
                        <Text as="span">{sourceName}</Text>
                    )}
                </Badge>
            </Flex>
            <Text mt={2} whiteSpace="pre-line">
                {props.description || "(no caption)"}
            </Text>
            <Text mt={2} fontWeight="light">{props.date}</Text>
        </Box>
    )
}
