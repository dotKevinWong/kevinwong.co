import { Box, Flex } from "@chakra-ui/react"
import { TopTracks } from "../TopTracks"
import { ListeningTimeline } from "../ListeningTimeline"
import { AudioFeatures } from "../AudioFeatures"


export const StatisticsPage = () => {
    return (
        <Box as="section" flex="1" p="4" marginTop="6" overflow="auto">
            <Flex direction="row" wrap="wrap" justify="space-between" rowGap={4}>
            {/* <TopTracks />  */}
            <AudioFeatures/>
            </Flex>
        </Box>
    )
}


