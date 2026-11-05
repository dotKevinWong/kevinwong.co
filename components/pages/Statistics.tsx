import { Box, Flex, Heading } from "@chakra-ui/react"
import { TopTracks } from "../TopTracks"
import { GithubStats } from "../GitHubStats"

export const StatisticsPage = () => {
    return (
        <Box as="section" p="6" overflow="auto">
            <Heading as="h1" srOnly>Statistics</Heading>
            <Flex direction="row" wrap="wrap" justify={{ base: "center", lg: "flex-start" }} rowGap={4} columnGap={4}>
            <TopTracks/>
            <GithubStats/>
            </Flex>
        </Box>
    )
}
