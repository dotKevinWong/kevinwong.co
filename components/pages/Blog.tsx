import { Box, Text, Heading, Link, HStack, Tag, Image, Stack, AspectRatio, Skeleton, VStack } from "@chakra-ui/react"
import formatter from "../../lib/formatter"

interface Blog {
    posts: any
}

export const BlogPage = (props: Blog) => {
    const { posts } = props
    return (
        <Box as="section" flex="1" p="4" margin="4" overflow="auto">
            <VStack spacing={12} align="left">
                {posts.length > 0 ?
                    (posts.map((post: any) => (
                        <Box maxW="2xl" key={post}>
                            <Stack spacing="16">
                                <Stack spacing="6">
                                    <Link href={`/blog/` + post.slug}>
                                        <AspectRatio ratio={16 / 9}>
                                            <Image
                                                src={post.og_image}
                                                objectPosition="top"
                                                objectFit="cover"
                                                fallback={<Skeleton />}
                                                alt={post.title}
                                                borderRadius="xl"
                                            />
                                        </AspectRatio>
                                    </Link>
                                    <Stack spacing="3">
                                        <Stack spacing="1">
                                            {/* <HStack spacing={2} direction="row" justify="left" wrap="wrap">
                                                {post.tags.map((tag: any) => (
                                                    <Tag key={tag} colorScheme="blue">
                                                        {tag}
                                                    </Tag>
                                                ))}
                                        </HStack> */}
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


