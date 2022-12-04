import { Box, Text, VStack, Heading, Link, HStack, Tag } from "@chakra-ui/react"
import formatter from "../../lib/formatter"

interface Blog {
    posts: any
}

export const BlogPage = (props: Blog) => {
    const { posts } = props
    return (

        <Box as="section" flex="1" p="4" marginTop="6" overflow="auto">
            <VStack align="left" spacing={8} maxW="4xl">
                {posts.length > 0 ?
                    (posts.map((post: any) => (
                        <VStack align="left" key={post} spacing={1}>
                            <Link href={`/blog/` + post.slug}><Heading as="h2" size="lg">
                                {post.title}
                            </Heading></Link>
                            <HStack spacing={2} direction="row" justify="left" wrap="wrap">
                                <Text fontSize="sm" fontWeight="bold">Tags:</Text>
                                {post.tags.map((tag: any) => (
                                    <Tag key={tag} colorScheme="blue">
                                        {tag}
                                    </Tag>
                                ))}
                            </HStack>
                            <Text fontSize="sm" colorScheme="gray.600">{formatter.shortUTCDate(post.date)}</Text>
                            <Box>{post.excerpt}</Box>
                        </VStack>
                    ))) : (
                        <Text>No posts found.</Text>
                    )}
            </VStack>
        </Box>
    )
}


