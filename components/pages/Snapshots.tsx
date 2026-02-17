import { useCallback, useEffect, useMemo, useRef } from "react"
import { Box, Flex, Spinner, Text, useBreakpointValue } from "@chakra-ui/react"
import useSWRInfinite from "swr/infinite"
import { PhotoPost } from "../PhotoPost"

interface SnapshotMedia {
    id: string;
    position: number;
    kind: "image" | "video";
    url: string;
    publicId?: string;
    width?: number | null;
    height?: number | null;
}

interface SnapshotPost {
    id: string;
    caption: string;
    instagramUrl: string | null;
    postedAt: string | null;
    mediaCount: number;
    media: SnapshotMedia[];
}

interface SnapshotsResponse {
    posts: SnapshotPost[];
    pagination: {
        limit: number;
        hasMore: boolean;
        nextCursor: string | null;
    };
}

const fetcher = async (url: string): Promise<SnapshotsResponse> => {
    const res = await fetch(url)

    if (!res.ok) {
        throw new Error("Failed to load snapshots")
    }

    return res.json()
}

const dateFormatter = new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "2-digit",
    year: "numeric",
    timeZone: "UTC",
})

const formatPostedAt = (value: string | null) => {
    if (!value) {
        return "Unknown date"
    }

    const date = new Date(value)
    if (Number.isNaN(date.getTime())) {
        return "Unknown date"
    }

    return dateFormatter.format(date)
}

export const SnapshotsPage = () => {
    const isMobile = useBreakpointValue({ base: true, md: false })
    const pageSize = useBreakpointValue({ base: 3, sm: 4, md: 6, lg: 9, xl: 12 }) ?? 6

    const containerRef = useRef<HTMLDivElement | null>(null)
    const sentinelRef = useRef<HTMLDivElement | null>(null)

    const getKey = useCallback((pageIndex: number, previousPageData: SnapshotsResponse | null) => {
        if (previousPageData && !previousPageData.pagination.hasMore) {
            return null
        }

        const search = new URLSearchParams({ limit: String(pageSize) })
        if (pageIndex > 0) {
            const cursor = previousPageData?.pagination.nextCursor
            if (!cursor) {
                return null
            }
            search.set("cursor", cursor)
        }

        return `/api/snapshots?${search.toString()}`
    }, [pageSize])

    const { data, error, isLoading, isValidating, size, setSize } = useSWRInfinite<SnapshotsResponse>(
        getKey,
        fetcher,
        { revalidateFirstPage: false }
    )

    useEffect(() => {
        void setSize(1)
    }, [pageSize, setSize])

    const posts = useMemo(() => {
        const seen = new Set<string>()
        const merged: SnapshotPost[] = []

        ;(data || []).forEach((page) => {
            page.posts.forEach((post) => {
                if (seen.has(post.id)) {
                    return
                }

                seen.add(post.id)
                merged.push(post)
            })
        })

        return merged
    }, [data])

    const hasMore = data?.[data.length - 1]?.pagination.hasMore ?? false

    useEffect(() => {
        const root = containerRef.current
        const sentinel = sentinelRef.current

        if (!root || !sentinel || !hasMore) {
            return
        }

        const observer = new IntersectionObserver(
            (entries) => {
                const isVisible = entries.some((entry) => entry.isIntersecting)
                if (!isVisible || isValidating) {
                    return
                }

                void setSize((prev) => prev + 1)
            },
            {
                root,
                rootMargin: "400px 0px",
            }
        )

        observer.observe(sentinel)

        return () => {
            observer.disconnect()
        }
    }, [hasMore, isValidating, setSize, posts.length])

    if (isLoading && posts.length === 0) {
        return (
            <Box as="section" flex="1" p="6" overflow="auto">
                <Flex align="center" gap={3}>
                    <Spinner size="sm" />
                    <Text>Loading snapshots...</Text>
                </Flex>
            </Box>
        )
    }

    if (error) {
        return (
            <Box as="section" flex="1" p="6" overflow="auto">
                <Text color="red.500">Could not load snapshots from the database.</Text>
            </Box>
        )
    }

    if (posts.length === 0) {
        return (
            <Box as="section" flex="1" p="6" overflow="auto">
                <Text>No snapshots found yet.</Text>
            </Box>
        )
    }

    return (
        <Box as="section" flex="1" p="6" overflow="auto" ref={containerRef}>
            <Flex wrap="wrap" gap={8} justify={isMobile ? "center" : "left"} maxW="1640px">
                {posts.map((post) => (
                    <PhotoPost
                        key={post.id}
                        postId={post.id}
                        media={post.media}
                        mediaCount={post.mediaCount}
                        description={post.caption}
                        date={formatPostedAt(post.postedAt)}
                        sourceHref={post.instagramUrl}
                        sourceName="Instagram"
                    />
                ))}
            </Flex>

            <Box ref={sentinelRef} h="1px" />

            {hasMore || (isValidating && size > 1) ? (
                <Flex align="center" justify="center" py={6} gap={3}>
                    <Spinner size="sm" />
                    <Text>Loading more snapshots...</Text>
                </Flex>
            ) : null}
        </Box>
    )
}
