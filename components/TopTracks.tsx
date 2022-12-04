import { ExternalLinkIcon } from "@chakra-ui/icons";
import {
    Box,
    Heading,
    VStack,
    Image,
    Text,
    useColorModeValue as mode,
    Table,
    Thead,
    Tr,
    Th,
    Tbody,
    Td,
    HStack,
    Link,
} from "@chakra-ui/react";
import * as React from 'react'
import useSWR from "swr";
import fetcher from "../lib/fetcher";

export const TopTracks = () => {
    const { data } = useSWR("/api/toptracks", fetcher);

    return (

        <Box maxW="md">
            <VStack align="left">
                <Heading>Top Tracks</Heading>
                <Text>Curious to what I&#39;m currently listening to? Here are my current top tracks</Text>
                {/* Create a table of top spotify tracks from the /api/toptracks API endpoint with album cover, artist, track name */}
                <Table>
                    <Thead>
                        <Tr>
                            <Th></Th> {/* Album Cover */}
                            <Th></Th> {/* Track Name */}
                        </Tr>
                    </Thead>
                    <Tbody>
                        {data?.tracks.map((item: { albumImageUrl: string; album: string; name: string; artist: string; songUrl: string; albumUrl: string, artistUrl: string }, index: React.Key) => (
                            <Tr key={index}>
                                <Td>
                                    <Link as="a" href={item.albumUrl} target="_blank" rel="noreferrer"><Image boxSize="64px" src={item.albumImageUrl} alt={item.album}></Image></Link>
                                </Td>
                                <Td>
                                    <Link as="a" href={item.songUrl} target="_blank" rel="noreferrer"><Text fontWeight="bold">{item.name} <ExternalLinkIcon/></Text></Link>
                                    <Link as="a" href={item.albumUrl} target="_blank" rel="noreferrer"><Text colorScheme="gray">{item.album}</Text></Link>
                                    <Link as="a" href={item.artistUrl} target="_blank" rel="noreferrer"><Text fontWeight="bold">{item.artist}</Text></Link>
                                </Td>
                            </Tr>
                        ))}
                    </Tbody>
                </Table>
            </VStack>
        </Box>
    );
};