
import {
    Box,
    Heading,
    VStack,
    Image,
    Text,
    Table,
    Link,
    List,
} from "@chakra-ui/react";
import * as React from 'react'
import useSWR from "swr";
import fetcher from "../lib/fetcher";
import { FiExternalLink } from "react-icons/fi";

export const TopTracks = () => {
    const { data } = useSWR("/api/toptracks", fetcher);

    return (

        <Box
            maxW="420px"
            bg={{ base: 'gray.100', _dark: 'gray.800' }}
            rounded={{ sm: 'lg' }}
            shadow={{ md: 'base' }}
            p={{ base: '6', md: '8' }}
            height="auto"
            alignSelf="flex-start"
        >
            <VStack align="left">
                <Heading>Top Tracks</Heading>
                <Text mb={4}>Curious to what I&#39;m currently listening to? Here are my current top tracks</Text>
                <Table.Root
                    css={{
                        "backgroundColor": 'inherit',
                        "width": '100%',
                    }}
                >
                    <Table.Body>
                        {data?.tracks.map((item: { albumImageUrl: string; album: string; name: string; artist: string; songUrl: string; albumUrl: string, artistUrl: string }, index: React.Key) => (
                            <Table.Row key={index} css={{
                                "backgroundColor": 'inherit',
                                "width": '100%',
                            }}>
                                <Table.Cell>
                                    <Link as="a" href={item.albumUrl} target="_blank" rel="noreferrer"><Image boxSize="96px" objectFit='scale-down' src={item.albumImageUrl} alt={item.album}></Image></Link>
                                </Table.Cell>
                                <Table.Cell >
                                    <List.Root unstyled>
                                        <List.Item>
                                            <Link as="a" href={item.songUrl} target="_blank" rel="noreferrer"><Text fontWeight="bold">{item.name}</Text><FiExternalLink /></Link>
                                        </List.Item>
                                        <List.Item>
                                            <Link as="a" href={item.albumUrl} target="_blank" rel="noreferrer"><Text colorScheme="gray">{item.album}</Text></Link>
                                        </List.Item>
                                        <List.Item>
                                            <Link as="a" href={item.artistUrl} target="_blank" rel="noreferrer"><Text fontWeight="bold">{item.artist}</Text></Link>
                                        </List.Item>
                                    </List.Root>
                                </Table.Cell>
                            </Table.Row>
                        ))}
                    </Table.Body>
                </Table.Root>
            </VStack>
        </Box>
    );
};
