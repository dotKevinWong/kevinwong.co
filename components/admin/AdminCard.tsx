import { Box, type BoxProps } from "@chakra-ui/react";

/** The site's card look (TopTracks, GitHubStats), shared by the admin pages. */
export const AdminCard = (props: BoxProps) => (
    <Box bg={{ base: "gray.100", _dark: "#111111" }} rounded={{ sm: "lg" }} shadow={{ md: "sm" }}
        p={{ base: "6", md: "8" }} height="auto" alignSelf="flex-start" w="full" {...props} />
);
