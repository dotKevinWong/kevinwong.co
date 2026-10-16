import { Box, Heading, VStack, Text, Image } from "@chakra-ui/react";

const PROFILE_URL = "https://raw.githubusercontent.com/dotKevinWong/dotKevinWong/refs/heads/main/profile";

// Both variants are rendered and CSS shows the one for the current color mode.
// Picking the src in JS would differ between the server (no theme yet) and a
// dark-mode client, and React doesn't patch attribute mismatches on hydration.
// Lazy loading lets the browser skip downloading the hidden variant.
const lightOnly = { base: "block", _dark: "none" };
const darkOnly = { base: "none", _dark: "block" };

export const GithubStats = () => {
    return (
        <Box
            maxW="420px"
            bg={{ base: 'gray.100', _dark: '#111111' }}
            rounded={{ sm: 'lg' }}
            shadow={{ md: 'sm' }}
            p={{ base: '6', md: '8' }}
            height="auto"
            alignSelf="flex-start"
        >
            <VStack align="left" gap={4}>
                <Heading>GitHub Statistics</Heading>
                <Text>Here are some statistics about my contributions on GitHub</Text>
                <Image src={`${PROFILE_URL}/stats.svg`} alt="GitHub stats" maxW="420px" loading="lazy" display={lightOnly} />
                <Image src={`${PROFILE_URL}/stats-dark.svg`} alt="GitHub stats" maxW="420px" loading="lazy" display={darkOnly} />
                <Image src={`${PROFILE_URL}/top-langs.svg`} alt="Top languages" maxW="420px" loading="lazy" display={lightOnly} />
                <Image src={`${PROFILE_URL}/top-langs-dark.svg`} alt="Top languages" maxW="420px" loading="lazy" display={darkOnly} />
            </VStack>
        </Box >
    );
};