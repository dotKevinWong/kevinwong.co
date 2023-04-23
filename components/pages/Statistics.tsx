import { Box, Flex, useBreakpointValue } from "@chakra-ui/react"
import { TopTracks } from "../TopTracks"
import { ListeningTimeline } from "../ListeningTimeline"
import { AudioFeatures } from "../AudioFeatures"
import { GithubStats } from "../GitHubStats"


export const StatisticsPage = () => {
    const isDesktop = useBreakpointValue({ base: false, lg: true })

    return (
        <Box as="section" flex="1" p="6" overflow="auto">
            <Flex direction="row" wrap="wrap" justify={isDesktop ? "flex-start" : "center"} rowGap={4} columnGap={4}>
            {/* <TopTracks/> */}
            <AudioFeatures/>
            <GithubStats/>
            </Flex>
        </Box>
    )
}


