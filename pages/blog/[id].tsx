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
    Link as ChakraLink,
    LinkProps,
    List,
    ListItem,
    Table,
    Separator,
    AvatarGroup
} from '@chakra-ui/react';
import type { GetStaticPropsContext, InferGetStaticPropsType } from 'next';
import Link from 'next/link';
import { serialize } from 'next-mdx-remote/serialize';
import { MDXRemote, type MDXRemoteProps } from 'next-mdx-remote';
import { getPost, getPosts } from '../../lib/mdx';
import { shortUTCDate } from '../../lib/formatter';
import { Meta } from '../../components/Meta';
import { PageShell } from '../../components/PageShell';
import Emoji from '../../components/Emoji';

// Cast because the MDX component-map type rejects Chakra's compound components
// (Avatar, List and Table are plain objects of parts), even though MDX resolves
// <Table.Root> and the like through them at runtime.
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
    // Posts use <Link> for external links. A bare next/link <a> inherits the
    // body text color from Chakra's reset, so it wouldn't look like a link.
    Link: (props: LinkProps) => <ChakraLink color="blue.500" rel="noopener noreferrer" {...props} />,
    List,
    ListItem,
    Table,
    Separator
} as unknown as MDXRemoteProps['components'];

type PostProps = InferGetStaticPropsType<typeof getStaticProps>;

function Post({ source, meta }: PostProps) {
    return (
        <Box
            as="section"
            flex="1"
            overflow="auto"
            maxW="4xl"
            marginLeft={{ lg: 4 }}
        >
            <Box as="section" flex="1" p="6" marginTop="2" overflow="auto" maxW="5xl">
                <Button asChild colorPalette="blue" marginBottom="4">
                    <Link href="/blog" passHref>
                        <Emoji symbol="backhand-index-pointing-left" label="Backhand Index Pointing Left" />
                        Back
                    </Link>
                </Button>
                <VStack align="left" gap={8}>

                    <Heading as="h1">{meta.title}</Heading>
                    <HStack>
                        <AvatarGroup>
                            <Avatar.Root size="sm">
                                <Avatar.Image src={meta.author_avatar} alt={meta.author} />
                                <Avatar.Fallback name={meta.author} />
                            </Avatar.Root>
                        </AvatarGroup>
                        <Text>{meta.author} / </Text>
                        <Text>{shortUTCDate(meta.date)}</Text>
                    </HStack>
                    <MDXRemote {...source} components={components} />
                </VStack>
            </Box>
        </Box>
    )
}

export default function Slug({ source, meta }: PostProps) {
    return (
        <>
            <Meta title={`${meta.title} • Kevin Wong`} ogImage={meta.og_image} ogDesc={meta.excerpt} />
            <PageShell>
                <Post source={source} meta={meta} />
            </PageShell>
        </>
    );
};

// getStaticPaths lists every post with fallback: false, so params is always set.
export async function getStaticProps({ params }: GetStaticPropsContext<{ id: string }>) {
    const { content, meta } = await getPost(params!.id);

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
