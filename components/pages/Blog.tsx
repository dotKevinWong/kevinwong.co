import { Box, Text, Heading, Link, HStack, Tag, Image, Stack, AspectRatio, Skeleton, VStack } from "@chakra-ui/react"
import formatter from "../../lib/formatter"

interface Blog {
    posts: any
}

export const BlogPage = (props: Blog) => {
    const { posts } = props
    return (
        <Box as="section" flex="1" p="4" margin="4" overflow="auto">
            <VStack gap={12} align="left">
                {posts.length > 0 ?
                    (posts.map((post: any) => (
                        <Box maxW="2xl" key={post}>
                            <Stack gap="16">
                                <Stack gap="6">
                                    <Link href={`/blog/` + post.slug}>
                                            <Image
                                                src={post.og_image}
                                                objectPosition="top"
                                                objectFit="cover"
                                                alt={post.title}
                                                aspectRatio={16/9}
                                                borderRadius="xl"
                                            />
                                    </Link>
                                    <Stack gap="3">
                                        <Stack gap="1">
                                            <HStack gap={2} direction="row" justify="left" wrap="wrap">
                                                {post.tags.map((tag: any) => (
                                                    <Tag.Root key={tag} colorPalette="blue">
                                                        <Tag.Label>{tag}</Tag.Label>
                                                    </Tag.Root>
                                                ))}
                                        </HStack>
                                            <Link href={`/blog/` + post.slug}>
                                                <Heading
                                                    size="xs"
                                                    fontWeight="semibold"
                                                    fontSize={{ base: 'xl', lg: '2xl' }}
                                                    lineHeight={{ base: '1.5', lg: '2rem' }}
                                                >
                                                    {post.title}
                                                </Heading>
                                            </Link>
                                            <Text fontSize="sm">{formatter.shortUTCDate(post.date)}</Text>
                                        </Stack>
                                        <Text>{post.excerpt}</Text>
                                    </Stack>
                                </Stack>
                            </Stack>

                        </Box>
                    ))) : (
                        <Text>No posts found.</Text>
                    )}
            </VStack>
        </Box>
    )
}


