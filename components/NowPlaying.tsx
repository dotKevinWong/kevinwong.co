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

const marqueeStyleId = "marquee-keyframes";
const ensureMarqueeStyle = () => {
  if (typeof document === "undefined") return;
  if (document.getElementById(marqueeStyleId)) return;
  const style = document.createElement("style");
  style.id = marqueeStyleId;
  style.textContent = `
    @keyframes np-marquee {
      0%, 20% { transform: translateX(0); }
      50%, 70% { transform: translateX(var(--marquee-offset)); }
      100% { transform: translateX(0); }
    }
  `;
  document.head.appendChild(style);
};

const MarqueeText = ({ children, href }: { children: React.ReactNode; href?: string }) => {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [shouldScroll, setShouldScroll] = React.useState(false);
  const [offset, setOffset] = React.useState(0);

  React.useEffect(() => {
    ensureMarqueeStyle();
  }, []);

  React.useEffect(() => {
    const check = () => {
      if (containerRef.current) {
        const overflow = containerRef.current.scrollWidth - containerRef.current.clientWidth;
        setShouldScroll(overflow > 0);
        setOffset(overflow > 0 ? -overflow - 10 : 0);
      }
    };
    // Delay check slightly so layout is settled
    const timer = setTimeout(check, 100);
    window.addEventListener("resize", check);
    return () => { clearTimeout(timer); window.removeEventListener("resize", check); };
  }, [children]);

  return (
    <div ref={containerRef} style={{ overflow: "hidden", whiteSpace: "nowrap", maxWidth: "100%" }}>
      <Link
        as="a"
        href={href}
        target="_blank"
        style={{
          display: "inline-block",
          ["--marquee-offset" as string]: `${offset}px`,
          animation: shouldScroll ? "np-marquee 10s ease-in-out infinite" : "none",
        }}
      >
        <span style={{ whiteSpace: "nowrap" }}>{children}</span>
      </Link>
    </div>
  );
};

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
          <VStack align="left" gap={1} overflow="hidden" maxW="calc(100% - 80px)">
            {data?.songUrl ? (
              <>
                <MarqueeText href={data?.songUrl}>{data.title} <FiExternalLink style={{ display: "inline", verticalAlign: "middle" }} /></MarqueeText>
                <MarqueeText href={data?.artistUrl}>{data.artist}</MarqueeText>
                <MarqueeText href={data?.albumUrl}>{data.album}</MarqueeText>
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
