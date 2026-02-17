import { useCallback, useEffect, useMemo, useRef, useState } from "react"
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

const getScrollContainers = (node: HTMLElement | null): HTMLElement[] => {
    if (!node) {
        return []
    }

    const containers: HTMLElement[] = [node]
    let parent: HTMLElement | null = node.parentElement

    while (parent) {
        const style = window.getComputedStyle(parent)
        const overflowY = style.overflowY
        if (overflowY === "auto" || overflowY === "scroll") {
            containers.push(parent)
        }

        parent = parent.parentElement
    }

    return [...new Set(containers)]
}

export const SnapshotsPage = () => {
    const isMobile = useBreakpointValue({ base: true, md: false })
    const [pageSize, setPageSize] = useState(6)

    const containerRef = useRef<HTMLDivElement | null>(null)
    const scrollContainersRef = useRef<HTMLElement[]>([])
    const hasUserScrolledRef = useRef(false)
    const loadRequestedRef = useRef(false)

    const recomputePageSize = useCallback(() => {
        const el = containerRef.current
        if (!el) {
            return
        }

        const containerWidth = el.clientWidth
        if (containerWidth <= 0) {
            return
        }

        const columns = Math.max(1, Math.floor((containerWidth + 32) / (320 + 32)))
        const dynamicLimit = Math.max(3, Math.min(12, columns * 3))
        setPageSize((prev) => prev === dynamicLimit ? prev : dynamicLimit)
    }, [])

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
        recomputePageSize()

        const el = containerRef.current
        if (!el) {
            return
        }

        if (typeof ResizeObserver !== "undefined") {
            const observer = new ResizeObserver(() => {
                recomputePageSize()
            })
            observer.observe(el)

            return () => {
                observer.disconnect()
            }
        }

        const onResize = () => recomputePageSize()
        window.addEventListener("resize", onResize)

        return () => {
            window.removeEventListener("resize", onResize)
        }
    }, [recomputePageSize])

    useEffect(() => {
        hasUserScrolledRef.current = false
        loadRequestedRef.current = false
        void setSize(1)
    }, [pageSize, setSize])

    useEffect(() => {
        if (!isValidating) {
            loadRequestedRef.current = false
        }
    }, [isValidating])

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

    const getRemainingScroll = useCallback((el: HTMLElement) => {
        return el.scrollHeight - el.scrollTop - el.clientHeight
    }, [])

    const maybeLoadMore = useCallback(() => {
        const containers = scrollContainersRef.current
        if (!containers.length || !hasMore || isValidating || loadRequestedRef.current || !hasUserScrolledRef.current) {
            return
        }

        const remainingScroll = Math.min(...containers.map((el) => getRemainingScroll(el)))
        if (remainingScroll > 220) {
            return
        }

        loadRequestedRef.current = true
        void setSize((prev) => prev + 1)
    }, [getRemainingScroll, hasMore, isValidating, setSize])

    useEffect(() => {
        maybeLoadMore()
    }, [posts.length, maybeLoadMore])

    useEffect(() => {
        const node = containerRef.current
        if (!node) {
            return
        }

        const containers = getScrollContainers(node)
        scrollContainersRef.current = containers

        const onElementScroll = (event: Event) => {
            const currentTarget = event.currentTarget as HTMLElement
            if (currentTarget.scrollTop > 8) {
                hasUserScrolledRef.current = true
            }
            maybeLoadMore()
        }

        const onWindowScroll = () => {
            if (window.scrollY > 8) {
                hasUserScrolledRef.current = true
            }
            maybeLoadMore()
        }

        containers.forEach((el) => el.addEventListener("scroll", onElementScroll, { passive: true }))
        window.addEventListener("scroll", onWindowScroll, { passive: true })
        maybeLoadMore()

        return () => {
            containers.forEach((el) => el.removeEventListener("scroll", onElementScroll))
            window.removeEventListener("scroll", onWindowScroll)
        }
    }, [maybeLoadMore, pageSize])

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

            {isValidating && hasMore ? (
                <Flex align="center" justify="center" py={6} gap={3}>
                    <Spinner size="sm" />
                    <Text>Loading more snapshots...</Text>
                </Flex>
            ) : null}
        </Box>
    )
}
