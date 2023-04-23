import { Box, Flex } from "@chakra-ui/react"
import { TopTracks } from "../TopTracks"
import { ListeningTimeline } from "../ListeningTimeline"
import { AudioFeatures } from "../AudioFeatures"
import { GithubStats } from "../GitHubStats"


export const StatisticsPage = () => {
    return (
        <Box as="section" flex="1" p="4" marginTop="4" overflow="auto">
            <Flex direction="row" wrap="wrap" rowGap={4} columnGap={4}>
            {/* <TopTracks/> */}
            <AudioFeatures/>
            <GithubStats/>
            </Flex>
        </Box>
    )
}


