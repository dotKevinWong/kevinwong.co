import {
  Box,
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

type NowPlayingResponse = {
  album?: string;
  albumImageUrl?: string;
  artist?: string;
  artistUrl?: string;
  isPlaying?: boolean;
  songUrl?: string;
  albumUrl?: string;
  title?: string;
  currentDuration?: number;
  totalDuration?: number;
};

const formatDuration = (ms: number) => {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");

  return `${minutes}:${seconds}`;
};

export const NowPlaying = () => {
  const { data } = useSWR<NowPlayingResponse>("/api/nowplaying", fetcher, {
    refreshInterval: 15000,
    revalidateOnFocus: true,
    revalidateOnReconnect: true,
    dedupingInterval: 1000,
  });
  const [displayProgressMs, setDisplayProgressMs] = React.useState(0);

  React.useEffect(() => {
    if (!data?.songUrl) {
      setDisplayProgressMs(0);
      return;
    }

    setDisplayProgressMs(Math.max(0, data.currentDuration ?? 0));
  }, [data?.songUrl, data?.currentDuration, data?.title]);

  React.useEffect(() => {
    if (!data?.songUrl || !data?.isPlaying) {
      return;
    }

    const totalDuration = Math.max(0, data.totalDuration ?? 0);
    const intervalId = window.setInterval(() => {
      setDisplayProgressMs((previous) => {
        if (totalDuration <= 0) {
          return previous + 1000;
        }

        return Math.min(previous + 1000, totalDuration);
      });
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [data?.songUrl, data?.isPlaying, data?.totalDuration]);

  const totalDuration = Math.max(0, data?.totalDuration ?? 0);
  const currentDuration = totalDuration > 0 ? Math.min(displayProgressMs, totalDuration) : displayProgressMs;
  const progressWidth = totalDuration > 0 ? `${(currentDuration / totalDuration) * 100}%` : "0%";

  return(
  <Container as="footer">
      <Flex
        justify="space-between"
        align="center"
        fontWeight="medium"
        fontSize="sm"
      >
        <VStack align="left" width="100%">
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
        {data?.songUrl ? (
          <Box width="100%" mt={2}>
            <Box h="6px" bg="gray.200" borderRadius="full" overflow="hidden">
              <Box h="100%" bg="green.400" width={progressWidth} transition="width 0.9s linear" />
            </Box>
            <HStack justify="space-between" mt={1}>
              <Text fontSize="xs">{formatDuration(currentDuration)}</Text>
              <Text fontSize="xs">{formatDuration(totalDuration)}</Text>
            </HStack>
          </Box>
        ) : null}
        </VStack>
      </Flex>
  </Container>
  )
}
