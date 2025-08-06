import {
  Flex,
  HStack,
  VStack,
  Text,
  Link,
  Container,
  Image,
} from "@chakra-ui/react";
import * as React from 'react'
import useSWR from "swr";
import fetcher from "../lib/fetcher";
import { FiExternalLink } from "react-icons/fi";

export const NowPlaying = () => {
  const { data } = useSWR("/api/nowplaying", fetcher);

  return(
  <Container as="footer">
      <Flex
        justify="space-between"
        align="center"
        fontWeight="medium"
        fontSize="sm"
      >
        <VStack align="left">
        <Text color="black.800" fontWeight="extrabold">{data?.songUrl ? "Spotify – Now Playing" : "Spotify"}</Text>
        <HStack gap={2} color={{ base: 'gray.500', _dark: 'gray.400' }}>
          <Link as="a" href={data?.albumUrl} target="_blank"><Image width="64px" mr="2" src={data?.songUrl ? data?.albumImageUrl : "/album.png"} alt={data?.songUrl ? data?.album : "Not Playing"}/></Link>
          <VStack align="left" gap={1}>
            {data?.songUrl ? (
              <>
                <Link as="a" href={data?.songUrl} target="_blank">{data.title}<FiExternalLink/></Link>
                <Link as="a" href={data?.artistUrl} target="_blank">{data.artist}</Link>
                <Link as="a" href={data?.albumUrl} target="_blank">{data.album}</Link>
              </>
            ) : (
              <>
                <Text fontWeight="bold">Not Playing</Text>
              </>
            )}
          </VStack>
        </HStack>
        </VStack>
      </Flex>
  </Container>
  )
}