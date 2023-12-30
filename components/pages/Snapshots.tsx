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
                    photoSrc="https://res.cloudinary.com/dseps2m53/image/upload/f_auto,q_auto/v1/kevinwong/jznxdbizbkesgmhgsbaf"
                    description="officially a member of the league. for love of country leads 🇺🇸"
                    alt="officially a member of the league. for love of country leads 🇺🇸"
                    date="November 20, 2023"
                    sourceHref="https://www.instagram.com/p/Cz44g5ntKf3/"
                    sourceName="Instagram" />
                <PhotoPost
                    photoSrc="https://res.cloudinary.com/dseps2m53/image/upload/f_auto,q_auto/v1/kevinwong/hjv7ygdusrcdxit83yh7"
                    description="we outsideee bing bong 🚶‍♂️"
                    alt="we outsideee bing bong 🚶‍♂️"
                    date="May 14, 2023"
                    sourceHref="https://www.instagram.com/p/CsPKENMpaDc/"
                    sourceName="Instagram" />
                <PhotoPost
                    photoSrc="https://res.cloudinary.com/dseps2m53/image/upload/f_auto,q_auto/v1/kevinwong/tahsfpcngtxusg7jjwbb"
                    description="with the fam enjoying our kevin from home alone moment"
                    alt="with the fam enjoying our kevin from home alone moment"
                    date="December 18, 2022"
                    sourceHref="https://www.instagram.com/p/CmUj7UEN_ci/"
                    sourceName="Instagram" />
                <PhotoPost
                    photoSrc="https://res.cloudinary.com/dseps2m53/image/upload/f_auto,q_auto/v1/kevinwong/x28sz0wvmcxhn6bw9p95"
                    description="up in the skye"
                    alt="up in the skye"
                    date="December 16, 2022"
                    sourceHref="https://www.instagram.com/p/CmPhUAvtnFA/"
                    sourceName="Instagram" />
                <PhotoPost
                    photoSrc="https://res.cloudinary.com/dseps2m53/image/upload/f_auto,q_auto/v1/kevinwong/qvkebpzto9exwag5hz4m"
                    description="my bestie is officially 2 degrees hotter"
                    alt="my bestie is officially 2 degrees hotter"
                    date="June 08, 2022"
                    sourceHref="https://www.instagram.com/p/CejR8WaO2Yf/"
                    sourceName="Instagram" />
                <PhotoPost
                    photoSrc="https://res.cloudinary.com/dseps2m53/image/upload/f_auto,q_auto/v1/kevinwong/jo0bnbi2dyha9dpnppig"
                    description="i didn't think i would be a software engineer but I used dijkstra's algorithm to find my way there"
                    alt="i didn't think i would be a software engineer but I used dijkstra's algorithm to find my way there"
                    date="June 06, 2022"
                    sourceHref="https://www.instagram.com/p/CeetaMbJlba/"
                    sourceName="Instagram" />
            </Flex>
        </Box>
    )
}

