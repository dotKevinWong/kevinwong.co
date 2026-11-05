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
import { FiExternalLink, FiMusic } from "react-icons/fi";
import { Tooltip } from "./ui/tooltip";
import { formatDuration, useNowPlaying } from "./hooks";

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

// measureKey: a stable value to re-measure on. The title passes a fresh children array on every
// render (text + icon), so without it the marquee would re-measure on every 1 s progress tick.
const MarqueeText = ({ children, href, measureKey }: { children: React.ReactNode; href?: string; measureKey?: string }) => {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [shouldScroll, setShouldScroll] = React.useState(false);
  const [offset, setOffset] = React.useState(0);

  React.useEffect(() => {
    ensureMarqueeStyle();
  }, []);

  const measureDep = measureKey ?? children;
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
  }, [measureDep]);

  return (
    <div ref={containerRef} style={{ overflow: "hidden", whiteSpace: "nowrap", maxWidth: "100%" }}>
      <Link
        as="a"
        href={href}
        target="_blank"
        rel="noopener noreferrer"
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

export const NowPlaying = ({ collapsed = false }: { collapsed?: boolean }) => {
  // The bar restarts only when the song, its position or its title changes, not
  // on every poll, so a poll that returns the same state doesn't make it jump.
  const { data, current: currentDuration, total: totalDuration, pct } = useNowPlaying({
    poll: true,
    resetOnChangeOf: "track",
  });
  const progressWidth = `${pct}%`;

  const tooltipLabel = data?.songUrl
    ? `${data.title} by ${data.artist}`
    : "Not Playing";

  if (collapsed) {
    return (
      <Flex justify="center">
        <Tooltip content={tooltipLabel} positioning={{ placement: 'right' }}>
          <Link as="a" href={data?.songUrl || undefined} target="_blank" rel="noopener noreferrer">
            {data?.songUrl ? (
              <Image
                width="40px"
                height="40px"
                borderRadius="md"
                loading="lazy"
                src={data.albumImageUrl || "/album.png"}
                alt={data.album}
              />
            ) : (
              <Flex
                w="40px"
                h="40px"
                align="center"
                justify="center"
                borderRadius="md"
                bg={{ base: 'gray.200', _dark: 'gray.800' }}
              >
                <FiMusic size={18} />
              </Flex>
            )}
          </Link>
        </Tooltip>
      </Flex>
    );
  }

  return(
  <Container as="footer">
      <Flex
        justify="space-between"
        align="center"
        fontWeight="medium"
        fontSize="sm"
      >
        <VStack align="left" width="100%">
        <Text fontWeight="extrabold">{data?.songUrl ? "Spotify – Now Playing" : "Spotify"}</Text>
        <HStack gap={2} color={{ base: 'gray.500', _dark: 'gray.400' }}>
          <Link as="a" href={data?.albumUrl} target="_blank" rel="noopener noreferrer"><Image width="64px" mr="2" loading="lazy" src={(data?.songUrl && data.albumImageUrl) || "/album.png"} alt={data?.songUrl ? data?.album : "Not Playing"}/></Link>
          <VStack align="left" gap={1} overflow="hidden" maxW="calc(100% - 80px)">
            {data?.songUrl ? (
              <>
                <MarqueeText href={data?.songUrl} measureKey={data.title}>{data.title} <FiExternalLink style={{ display: "inline", verticalAlign: "middle" }} /></MarqueeText>
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
