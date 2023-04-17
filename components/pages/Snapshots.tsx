import { ExternalLinkIcon } from "@chakra-ui/icons"
import { Box, Alert, AlertIcon, Flex, Badge, Image, Text, Link, HStack, Stack, Grid, useBreakpointValue } from "@chakra-ui/react"
import { PhotoPost } from "../PhotoPost"


export const SnapshotsPage = () => {
    const isMobile = useBreakpointValue({ base: true, md: false })

    const justifyStyle =
        isMobile ? {
            justify: "center"
        } : {}

    return (
        <Box as="section" flex="1" p="6" overflow="auto">
            <Flex wrap="wrap" gap={8} justify="center">
                <PhotoPost
                    photoSrc="/snapshots/IMG_1748.jpg"
                    description="with the fam enjoying our kevin from home alone moment"
                    alt="with the fam enjoying our kevin from home alone moment"
                    date="December 18, 2022"
                    sourceHref="https://www.instagram.com/p/CmUj7UEN_ci/"
                    sourceName="Instagram" />
                <PhotoPost
                    photoSrc="/snapshots/IMG_1459.jpg"
                    description="up in the skye"
                    alt="up in the skye"
                    date="December 16, 2022"
                    sourceHref="https://www.instagram.com/p/CmPhUAvtnFA/"
                    sourceName="Instagram" />
                <PhotoPost
                    photoSrc="/snapshots/IMG_2401.jpg"
                    description="my bestie is officially 2 degrees hotter"
                    alt="my bestie is officially 2 degrees hotter"
                    date="June 08, 2022"
                    sourceHref="https://www.instagram.com/p/CejR8WaO2Yf/"
                    sourceName="Instagram" />
                <PhotoPost
                    photoSrc="/snapshots/IMG_2408.jpg"
                    description="i didn't think i would be a software engineer but I used dijkstra's algorithm to find my way there"
                    alt="i didn't think i would be a software engineer but I used dijkstra's algorithm to find my way there"
                    date="June 06, 2022"
                    sourceHref="https://www.instagram.com/p/CeetaMbJlba/"
                    sourceName="Instagram" />
            </Flex>
        </Box>
    )
}

