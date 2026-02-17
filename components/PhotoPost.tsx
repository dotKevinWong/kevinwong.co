import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AspectRatio, Badge, Box, Flex, IconButton, Image, Link, Spinner, Text, chakra } from "@chakra-ui/react"
import { FiChevronLeft, FiChevronRight, FiExternalLink, FiInstagram } from "react-icons/fi"

const INSTAGRAM_MIN_RATIO = 4 / 5
const INSTAGRAM_MAX_RATIO = 1.91

interface SnapshotMedia {
    id: string;
    position: number;
    kind: "image" | "video";
    url: string;
    publicId?: string;
    width?: number | null;
    height?: number | null;
}

interface MediaResponse {
    media: SnapshotMedia[];
}

interface PhotoPostProps {
    postId: string;
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

export const PhotoPost = (props: PhotoPostProps) => {
    const [mediaIndex, setMediaIndex] = useState(0)
    const [mediaByPosition, setMediaByPosition] = useState<Record<number, SnapshotMedia>>(() => buildMediaByPosition(props.media))
    const [isLoadingMedia, setIsLoadingMedia] = useState(false)
    const pendingPositionsRef = useRef<Set<number>>(new Set())

    useEffect(() => {
        setMediaIndex(0)
        setMediaByPosition(buildMediaByPosition(props.media))
        pendingPositionsRef.current.clear()
        setIsLoadingMedia(false)
    }, [props.postId, props.media])

    const mediaCount = Math.max(props.mediaCount, props.media.length)
    const normalizedIndex = normalizeIndex(mediaIndex, mediaCount)
    const activeMedia = mediaByPosition[normalizedIndex]

    const loadMediaAtPosition = useCallback(async (position: number) => {
        if (mediaCount <= 0 || mediaByPosition[position]) {
            return
        }

        if (pendingPositionsRef.current.has(position)) {
            return
        }

        pendingPositionsRef.current.add(position)
        setIsLoadingMedia(true)

        try {
            const res = await fetch(`/api/snapshots/${props.postId}/media?position=${position}&limit=1`)
            if (!res.ok) {
                throw new Error("Failed to fetch media")
            }

            const payload = await res.json() as MediaResponse
            if (!Array.isArray(payload.media)) {
                return
            }

            setMediaByPosition((prev) => {
                const next = { ...prev }
                payload.media.forEach((item) => {
                    next[item.position] = item
                })
                return next
            })
        } catch (error) {
            console.error("[PhotoPost/loadMediaAtPosition]", error)
        } finally {
            pendingPositionsRef.current.delete(position)
            setIsLoadingMedia(pendingPositionsRef.current.size > 0)
        }
    }, [mediaByPosition, mediaCount, props.postId])

    const goToPosition = useCallback(async (nextPosition: number) => {
        const nextIndex = normalizeIndex(nextPosition, mediaCount)

        if (mediaCount > 1 && !mediaByPosition[nextIndex]) {
            await loadMediaAtPosition(nextIndex)
        }

        setMediaIndex(nextIndex)

        if (mediaCount > 2) {
            const prefetchIndex = normalizeIndex(nextIndex + 1, mediaCount)
            void loadMediaAtPosition(prefetchIndex)
        }
    }, [loadMediaAtPosition, mediaByPosition, mediaCount])

    const handlePrevious = () => {
        void goToPosition(mediaIndex - 1)
    }

    const handleNext = () => {
        void goToPosition(mediaIndex + 1)
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
            shadow={{ md: "base" }} bg={{ base: "gray.100", _dark: "#111111" }}>
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
                    ) : mediaCount > 0 ? (
                        <Flex borderRadius="md" align="center" justify="center" direction="column" gap={2}
                            bg={{ base: "gray.200", _dark: "gray.700" }}>
                            {isLoadingMedia ? <Spinner size="sm" /> : null}
                            <Text fontSize="sm" color={{ base: "gray.700", _dark: "gray.200" }}>Loading media...</Text>
                        </Flex>
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
                        const isLoaded = Boolean(mediaByPosition[index])

                        return (
                            <chakra.button
                                key={`${props.postId}-${index}`}
                                type="button"
                                aria-label={`View media ${index + 1}`}
                                onClick={() => void goToPosition(index)}
                                w="2"
                                h="2"
                                borderRadius="full"
                                opacity={isLoaded ? 1 : 0.6}
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
