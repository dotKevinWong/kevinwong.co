import { Box, Heading, VStack, Text, Image } from "@chakra-ui/react";
import { useColorMode } from './ui/color-mode'

export const GithubStats = () => {
    // fetch the current color mode
    const { colorMode: ColorMode } = useColorMode();
    return (
        <Box
            maxW="420px"
            bg={{ base: 'gray.100', _dark: '#111111' }}
            rounded={{ sm: 'lg' }}
            shadow={{ md: 'base' }}
            p={{ base: '6', md: '8' }}
            height="auto"
            alignSelf="flex-start"
        >
            <VStack align="left" gap={4}>
                <Heading>GitHub Statistics</Heading>
                <Text>Here are some statistics about my contributions on GitHub</Text>
                { ColorMode === 'dark' ? (
                    <Image src="https://raw.githubusercontent.com/dotKevinWong/dotKevinWong/refs/heads/main/profile/stats-dark.svg" alt="GitHub Stats" maxW="420px" />
                ) : (
                    <Image src="https://raw.githubusercontent.com/dotKevinWong/dotKevinWong/refs/heads/main/profile/stats.svg" alt="GitHub Stats" maxW="420px" />
                )}
                { ColorMode === 'dark' ? (
                    <Image src="https://raw.githubusercontent.com/dotKevinWong/dotKevinWong/refs/heads/main/profile/top-langs-dark.svg" alt="GitHub Stats" maxW="420px" />
                ) : (
                    <Image src="https://raw.githubusercontent.com/dotKevinWong/dotKevinWong/refs/heads/main/profile/top-langs.svg" alt="GitHub Stats" maxW="420px" />
                )}
            </VStack>
        </Box >
    );
};