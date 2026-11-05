import { Box, type BoxProps } from "@chakra-ui/react";

/** The site's card and bar background: light gray, near-black in dark mode. */
export const SURFACE_BG = { base: "gray.100", _dark: "#111111" };

/** The site's card look (TopTracks, GitHubStats, the admin pages). */
export const Card = (props: BoxProps) => (
  <Box
    bg={SURFACE_BG}
    rounded={{ sm: "lg" }}
    shadow={{ md: "sm" }}
    p={{ base: "6", md: "8" }}
    height="auto"
    alignSelf="flex-start"
    {...props}
  />
);
