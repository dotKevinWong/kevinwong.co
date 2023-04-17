import { Box, Image, Text, Link, HStack, VStack, useBreakpointValue } from "@chakra-ui/react"
import React from "react"
import { TopTracks } from "../TopTracks"


export const HomePage = () => {
    const isMobile = useBreakpointValue({ base: true, md: false })

    const justifyStyle =
        isMobile ? {
            justify: "center"
        } : {
            justify: "left"
        }

    
    return (
        <Box as="section" flex="1" p="6" marginTop="4" overflow="auto">
            <HStack align="left" wrap="wrap" {...justifyStyle}>
                <Image height="100%" width="400px" marginRight={4} marginBottom={6} alt="Kevin Wong" src={"/me.jpg"} />
                <VStack align="left" marginTop={8} spacing={8}>
                    <Text><b>Business Process Consultant</b> at <Link color="blue.500" href="https://sap.com" target="_blank" isExternal><b>SAP</b></Link></Text>
                    <VStack align="left">
                        <Text><b>Editor-in-Chief</b> at <Link color="blue.500" href="https://mocktrialtips.com" target="_blank" isExternal><b>Mock Trial Tips</b></Link></Text>
                        <Text><b>Content Creator</b> at <Link color="blue.500" href="https://codingfluent.com" target="_blank" isExternal><b>CodingFluent</b></Link></Text>
                    </VStack>
                    <VStack align="left">
                        <Text><b>B.S. Software Engineering</b> at <Link color="blue.500" href="https://drexel.edu" isExternal><b>Drexel University</b></Link></Text>
                        <Text><b>Alumnus and Trustee</b> at <Link color="blue.500" href="https://www.romancatholichs.com" target="_blank" isExternal><b>Roman Catholic High School</b></Link></Text>
                    </VStack>
                </VStack>
            </HStack>
        </Box>
    )
}



