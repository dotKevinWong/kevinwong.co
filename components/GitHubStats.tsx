import { Box, Heading, VStack, Text, Image, useColorModeValue } from "@chakra-ui/react";

export const GithubStats = () => {
    return (
        <Box
            maxW="460px"
            bg={useColorModeValue('white', 'gray.800')}
            rounded={{ sm: 'lg' }}
            shadow={{ md: 'base' }}
            p={{ base: '6', md: '8' }}
            maxH="600px"
        >
            <VStack align="left" spacing={4}>
                <Heading>GitHub Statistics</Heading>
                <Text maxW="420px">Here are some statistics about my contributions on GitHub</Text>
                <Image src="https://github-readme-stats.vercel.app/api?username=dotkevinwong&show_icons=true&count_private=true" alt="GitHub Stats" maxW="420px" />
                <Image src="https://github-readme-stats.vercel.app/api/top-langs/?username=dotkevinwong&layout=compact" alt="GitHub Stats" maxW="420px" />
            </VStack>
        </Box >
    );
};