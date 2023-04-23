import { MDXProvider } from '@mdx-js/react';
import { Sidebar } from '../../components/Sidebar';
import {
    Avatar,
    Box,
    Button,
    Flex,
    Heading,
    HStack,
    Text,
    Image,
    VStack,
    Stack,
    Link,
    List,
    ListItem,
    ListIcon,
    OrderedList,
    UnorderedList,
    Table,
    Thead,
    Tbody,
    Tr,
    Th,
    Td,
    Divider,
    useBreakpointValue
} from '@chakra-ui/react';
import React from "react";
import { serialize } from 'next-mdx-remote/serialize';
import { MDXRemote } from 'next-mdx-remote';
import { getPost, getPosts } from '../../lib/mdx';
import formatter from '../../lib/formatter';
import { Navbar } from '../../components/Navbar';
import { Meta } from '../../components/Meta';

const components = {
    Avatar,
    Box,
    Button,
    Flex,
    Heading,
    HStack,
    Text,
    Image,
    VStack,
    Stack,
    Link,
    List,
    ListItem,
    ListIcon,
    OrderedList,
    UnorderedList,
    Table,
    Thead,
    Tbody,
    Tr,
    Th,
    Td,
    Divider,
    useBreakpointValue
};

function Post({ source, meta }: any) {
    return (
        <Box
            as="section"
            flex="1"
            overflow="auto"
            maxW="4xl"
        >
            <Box as="section" flex="1" p="6" marginTop="2" overflow="auto" maxW="5xl">
                <VStack align="left" spacing={8}>
                    <Heading>{meta.title}</Heading>
                    <HStack>
                        <Avatar size="sm" name="Kevin Wong" src={meta.author_avatar} />
                        <Text>{meta.author} / </Text>
                        <Text>{formatter.shortUTCDate(meta.date)}</Text>
                    </HStack>
                    <MDXRemote {...source} components={components} />
                </VStack>
            </Box>
        </Box>
    )
}

export default function Slug({ source, meta }: any) {
    const isDesktop = useBreakpointValue({ base: false, lg: true })

    return (
        <>
            <Meta title={`${meta.title} • Kevin Wong`} ogImage={meta.og_image} ogDesc={meta.excerpt} />
            {isDesktop ? (
                <Box height="100vh" overflow="hidden" position="relative">
                    <Flex h="full" id="app-container">
                        <Sidebar />
                        <Box
                            as="section"
                            flex="1"
                            overflow="auto"
                            marginLeft={4}
                        >
                            <Post source={source} meta={meta} />
                        </Box>
                    </Flex>
                </Box>
            ) : (
                <Flex
                    as="section"
                    direction={{ base: "column", lg: "row" }}
                    height="100vh"
                    bg="bg-canvas"
                    overflowY="auto"
                >
                    <Navbar />
                    <Post source={source} meta={meta} />
                </Flex>
            )}
        </>
    );
};

export async function getStaticProps({ params: { id } }: any) {
    // MDX text - can be from a local file, database, anywhere
    // const source = 'Some **mdx** text, with a component <Heading>Bruh</Heading> <Image src="/me.jpg" width="200px" height="200px"/>';
    const { content, meta } = await getPost(id);

    const mdxSource = await serialize(content);
    return { props: { source: mdxSource, meta: meta } };
}

export async function getStaticPaths() {
    const posts = await getPosts();
    const paths = posts.map((post) => ({
        params: { id: post.replace('.mdx', '') },
    }));

    return { paths, fallback: false };
}