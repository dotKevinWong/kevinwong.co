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
            <Flex wrap="wrap" gap={8} justify={isMobile ? "center" : "left"} maxW="1640px">
                <PhotoPost
                    photoSrc="https://res.cloudinary.com/dseps2m53/image/upload/w_1000,ar_1:1,c_fill,g_auto/v1736439818/kevinwong/jub98pifpiahjvlvjglm.jpg"
                    description="favorite moment when the mummers came up and said “ayy you got that shit on”"
                    alt="favorite moment when the mummers came up and said ayy you got that shit on"
                    date="January 01, 2025"
                    sourceHref="https://www.instagram.com/p/DETWepspuWQ/"
                    sourceName="Instagram" />
                <PhotoPost
                    photoSrc="https://res.cloudinary.com/dseps2m53/image/upload/w_1000,ar_1:1,c_fill,g_auto/v1736439810/kevinwong/gwuruuwsvqerfkdwpbwc.jpg"
                    description="2024: this and yap"
                    alt="2024: this and yap"
                    date="December 31, 2024"
                    sourceHref="https://www.instagram.com/p/DEQ4bOpJ6Ei/"
                    sourceName="Instagram" />
                <PhotoPost
                    photoSrc="https://res.cloudinary.com/dseps2m53/image/upload/w_1000,ar_1:1,c_fill,g_auto/v1736439818/kevinwong/osijurswvf1gufhkyrwp.jpg"
                    description="squad-ed up with gung gung (公公), go go (哥哥), and @matthewhhyoung – thanks to General Wong, I went from hitting 1 clay to 6 clays in my second round 😭"
                    alt="squad-ed up with gung gung (公公), go go (哥哥), and @matthewhhyoung"
                    date="November 10, 2024"
                    sourceHref="https://www.instagram.com/p/DCNUV04Jmv-/"
                    sourceName="Instagram" />
                <PhotoPost
                    photoSrc="https://res.cloudinary.com/dseps2m53/image/upload/w_1000,ar_1:1,c_fill,g_auto/v1736439809/kevinwong/z2hpqrhsffdordzaicp3.jpg"
                    description="🇬🇧 serving royal looks from across the pond at fall ball 2024 👑"
                    alt="🇬🇧 serving royal looks from across the pond at fall ball 2024 👑"
                    date="November 03, 2024"
                    sourceHref="https://www.instagram.com/p/DB6SJJLJCi9/"
                    sourceName="Instagram" />
                <PhotoPost
                    photoSrc="https://res.cloudinary.com/dseps2m53/image/upload/w_1000,ar_1:1,c_fill,g_auto/v1736439808/kevinwong/itnrd9w7d4b6fjq9gay0.jpg"
                    description="roman catholic high school greater philadelphia area leadership award 2k24"
                    alt="roman catholic high school greater philadelphia area leadership award 2k24"
                    date="October 17, 2024"
                    sourceHref="https://www.instagram.com/p/DBP9MdzJk77"
                    sourceName="Instagram" />
                <PhotoPost
                    photoSrc="https://res.cloudinary.com/dseps2m53/image/upload/w_1000,ar_1:1,c_fill,g_auto/v1736439804/kevinwong/wuwscthe1mbvzsdsu8zz.jpg"
                    description="first time playing golf but i need lessons ⛳️"
                    alt="first time playing golf but i need lessons ⛳️"
                    date="July 13, 2024"
                    sourceHref="https://www.instagram.com/p/C9YhxvpJswh/"
                    sourceName="Instagram" />
                <PhotoPost
                    photoSrc="https://res.cloudinary.com/dseps2m53/image/upload/w_1000,ar_1:1,c_fill,g_auto/v1736439815/kevinwong/yf5fbymnvnvglujo7dty.jpg"
                    description="at the junior summer kickoff party"
                    alt="at the junior summer kickoff party"
                    date="June 20, 2024"
                    sourceHref="https://www.instagram.com/p/C8dVHBuJYZt/?img_index=1"
                    sourceName="Instagram" />
                <PhotoPost
                    photoSrc="https://res.cloudinary.com/dseps2m53/image/upload/w_1000,ar_1:1,c_fill,g_auto/v1736439809/kevinwong/sslqy4fowqmytfaxljzn.jpg"
                    description="at the opening of matisse and renoir sipping red wine with my red wine bow tie"
                    alt="at the opening of matisse and renoir sipping red wine with my red wine bow tie"
                    date="June 18, 2024"
                    sourceHref="https://www.instagram.com/p/C8YPDhZJzil/"
                    sourceName="Instagram" />
                <PhotoPost
                    photoSrc="https://res.cloudinary.com/dseps2m53/image/upload/w_1000,ar_1:1,c_fill,g_auto/v1736439813/kevinwong/bgcnynfjkvy3z9w0u8o0.jpg"
                    description="acrobate et jeune arlequin"
                    alt="acrobate et jeune arlequin"
                    date="May 10, 2024"
                    sourceHref="https://www.instagram.com/p/C6z1OjXt7Tx/"
                    sourceName="Instagram" />
                <PhotoPost
                    photoSrc="https://res.cloudinary.com/dseps2m53/image/upload/w_1000,ar_1:1,c_fill,g_auto/v1736439808/kevinwong/vtto4xgaaqbcthb8ikvj.jpg"
                    description="ul juniors & young friends of the art museum take on art-ish 🎭"
                    alt="ul juniors & young friends of the art museum take on art-ish 🎭"
                    date="April 21, 2024"
                    sourceHref="https://www.instagram.com/p/C6ApdlitfVt/"
                    sourceName="Instagram" />
                <PhotoPost
                    photoSrc="https://res.cloudinary.com/dseps2m53/image/upload/w_1000,ar_1:1,c_fill,g_auto/v1/kevinwong/jznxdbizbkesgmhgsbaf"
                    description="officially a member of the league. for love of country leads 🇺🇸"
                    alt="officially a member of the league. for love of country leads 🇺🇸"
                    date="November 20, 2023"
                    sourceHref="https://www.instagram.com/p/Cz44g5ntKf3/"
                    sourceName="Instagram" />
                <PhotoPost
                    photoSrc="https://res.cloudinary.com/dseps2m53/image/upload/w_1000,ar_1:1,c_fill,g_auto/v1/kevinwong/hjv7ygdusrcdxit83yh7"
                    description="we outsideee bing bong 🚶‍♂️"
                    alt="we outsideee bing bong 🚶‍♂️"
                    date="May 14, 2023"
                    sourceHref="https://www.instagram.com/p/CsPKENMpaDc/"
                    sourceName="Instagram" />
                <PhotoPost
                    photoSrc="https://res.cloudinary.com/dseps2m53/image/upload/w_1000,ar_1:1,c_fill,g_auto/v1/kevinwong/tahsfpcngtxusg7jjwbb"
                    description="with the fam enjoying our kevin from home alone moment"
                    alt="with the fam enjoying our kevin from home alone moment"
                    date="December 18, 2022"
                    sourceHref="https://www.instagram.com/p/CmUj7UEN_ci/"
                    sourceName="Instagram" />
                <PhotoPost
                    photoSrc="https://res.cloudinary.com/dseps2m53/image/upload/w_1000,ar_1:1,c_fill,g_auto/v1/kevinwong/x28sz0wvmcxhn6bw9p95"
                    description="up in the skye"
                    alt="up in the skye"
                    date="December 16, 2022"
                    sourceHref="https://www.instagram.com/p/CmPhUAvtnFA/"
                    sourceName="Instagram" />
                <PhotoPost
                    photoSrc="https://res.cloudinary.com/dseps2m53/image/upload/w_1000,ar_1:1,c_fill,g_auto/v1/kevinwong/qvkebpzto9exwag5hz4m"
                    description="my bestie is officially 2 degrees hotter"
                    alt="my bestie is officially 2 degrees hotter"
                    date="June 08, 2022"
                    sourceHref="https://www.instagram.com/p/CejR8WaO2Yf/"
                    sourceName="Instagram" />
                <PhotoPost
                    photoSrc="https://res.cloudinary.com/dseps2m53/image/upload/w_1000,ar_1:1,c_fill,g_auto/v1/kevinwong/jo0bnbi2dyha9dpnppig"
                    description="i didn't think i would be a software engineer but I used dijkstra's algorithm to find my way there"
                    alt="i didn't think i would be a software engineer but I used dijkstra's algorithm to find my way there"
                    date="June 06, 2022"
                    sourceHref="https://www.instagram.com/p/CeetaMbJlba/"
                    sourceName="Instagram" />
            </Flex>
        </Box>
    )
}

