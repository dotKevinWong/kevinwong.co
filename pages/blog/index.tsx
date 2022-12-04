import { Sidebar } from "../../components/Sidebar";
import { Box, Flex, Heading, VStack, Text, HStack, Tag, Link } from "@chakra-ui/react";
import React from "react";
import { getAllPosts } from "../../lib/mdx";
import formatter from "../../lib/formatter";

export default function Blog({ posts }) {
    return (
        <Flex
            as="section"
            direction={{ base: 'column', lg: 'row' }}
            height="100vh"
            bg="bg-canvas"
            overflowY="auto"
        >
            <title>Blog • Kevin Wong</title>
            <Sidebar />
            <Flex h="full" id="app-container">
                <Box as="section" flex="1" p="4" marginTop="6" overflow="auto">
                    <VStack align="left" spacing={8} maxW="4xl">
                        {posts.length > 0 ?
                            (posts.map((post) => (
                                <VStack align="left" key={post} spacing={1}>
                                    <Link href={`/blog/` + post.slug}><Heading as="h2" size="lg">
                                        {post.title}
                                    </Heading></Link>
                                    <HStack spacing={2} direction="row" justify="left" wrap="wrap">
                                        <Text fontSize="sm" fontWeight="bold">Tags:</Text>
                                        {post.tags.map((tag) => (
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
            </Flex>
        </Flex>
    );
}

// use getStaticProps to get all the posts
export async function getStaticProps() {
    const posts = await getAllPosts();
    return { props: { posts } };
}
