import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Box, Button, Flex, Heading, Spinner, Text } from "@chakra-ui/react"
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
    // Where the posts are made. UTC would put anything posted after about 8pm
    // Eastern on the next day, unlike Instagram.
    timeZone: "America/New_York",
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

// Three rows of however many 320px cards fit across the section.
const pageSizeFor = (containerWidth: number) => {
    const columns = Math.max(1, Math.floor((containerWidth + 32) / (320 + 32)))
    return Math.max(3, Math.min(12, columns * 3))
}

export const SnapshotsPage = () => {
    // Null until the section has been measured, and no request goes out before
    // then. It is measured once: a new size changes every SWR key, which would
    // throw away the pages already loaded.
    const [pageSize, setPageSize] = useState<number | null>(null)
    const sentinelRef = useRef<HTMLDivElement | null>(null)

    const measureSection = useCallback((node: HTMLDivElement | null) => {
        if (node) {
            setPageSize((current) => current ?? pageSizeFor(node.clientWidth))
        }
    }, [])

    const getKey = useCallback((pageIndex: number, previousPageData: SnapshotsResponse | null) => {
        if (pageSize === null) {
            return null
        }

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

    const { data, error, isLoading, isValidating, setSize } = useSWRInfinite<SnapshotsResponse>(
        getKey,
        fetcher,
        { revalidateFirstPage: false }
    )

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

    const loadedPages = data?.length ?? 0
    const hasMore = data?.[data.length - 1]?.pagination.hasMore ?? false
    const canLoadMore = hasMore && !isValidating

    const loadMore = useCallback(() => {
        void setSize(loadedPages + 1)
    }, [loadedPages, setSize])

    // The sentinel covers the last 220px of the grid. With no explicit root the
    // observer is clipped by every scrolling ancestor as well as the viewport,
    // so it works in whichever layout the page is in. It also reports once on
    // observe(), so a first page that doesn't fill a tall screen keeps loading
    // until it does. After an error it stops, and the button below retries.
    useEffect(() => {
        const sentinel = sentinelRef.current
        if (!sentinel || !canLoadMore || error || typeof IntersectionObserver === "undefined") {
            return
        }

        const observer = new IntersectionObserver((entries) => {
            if (entries.some((entry) => entry.isIntersecting)) {
                observer.disconnect()
                loadMore()
            }
        })
        observer.observe(sentinel)

        return () => {
            observer.disconnect()
        }
    }, [canLoadMore, error, loadMore])

    let content: ReactNode

    if (posts.length === 0) {
        if (pageSize === null || isLoading) {
            content = (
                <Flex align="center" gap={3}>
                    <Spinner size="sm" />
                    <Text>Loading snapshots...</Text>
                </Flex>
            )
        } else if (error) {
            content = <Text color="red.500">Could not load snapshots from the database.</Text>
        } else {
            content = <Text>No snapshots found yet.</Text>
        }
    } else {
        content = (
            <>
                <Flex position="relative" wrap="wrap" gap={8} justify={{ base: "center", md: "left" }} maxW="1640px">
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
                    <Box
                        ref={sentinelRef}
                        aria-hidden
                        position="absolute"
                        left="0"
                        right="0"
                        bottom="0"
                        h="220px"
                        pointerEvents="none"
                    />
                </Flex>

                {/* The button stays mounted while a page loads, so pressing it
                    doesn't drop keyboard focus; it just ignores presses until then. */}
                {hasMore ? (
                    <Flex direction="column" align="center" py={6} gap={3}>
                        {error && !isValidating ? <Text color="red.500">Could not load more snapshots.</Text> : null}
                        <Button
                            variant="outline"
                            size="sm"
                            aria-disabled={isValidating || undefined}
                            onClick={isValidating ? undefined : loadMore}
                        >
                            {isValidating ? <Spinner size="sm" /> : null}
                            {isValidating ? "Loading more snapshots..." : "Load more"}
                        </Button>
                    </Flex>
                ) : null}
            </>
        )
    }

    return (
        <Box as="section" flex="1" p="6" overflow="auto" ref={measureSection}>
            <Heading as="h1" srOnly>Snapshots</Heading>
            {content}
        </Box>
    )
}
