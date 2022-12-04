import {
  Flex,
  HStack,
  VStack,
  Text,
  Link,
  useColorModeValue as mode,
  Container,
  Image,
} from "@chakra-ui/react";
import * as React from 'react'
import { ExternalLinkIcon } from "@chakra-ui/icons";
import useSWR from "swr";
import fetcher from "../lib/fetcher";

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
        <HStack spacing={2} color={mode("gray.500", "gray.400")}>
          <Link href={data?.albumUrl} isExternal><Image width="64px" mr="2" src={data?.songUrl ? data?.albumImageUrl : "/album.png"} alt={data?.songUrl ? data?.album : "Not Playing"}/></Link>
          <VStack align="left" spacing={1}>
            {data?.songUrl ? (
              <>
                <Link href={data?.songUrl} isExternal><Text size="xs">{data.title} <ExternalLinkIcon/></Text></Link>
                <Link href={data?.artistUrl} isExternal><Text>{data.artist}</Text></Link>
                <Link href={data?.albumUrl} isExternal><Text>{data.album}</Text></Link>
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