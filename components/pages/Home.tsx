import { Box, Image, Text, Link, HStack, VStack, useBreakpointValue } from "@chakra-ui/react"
import React from "react"


export const HomePage = () => {
    const isMobile = useBreakpointValue({ base: true, md: false })

    const justifyStyle =
        isMobile ? {
            justify: "center"
        } : {
            justify: "left"
        }

    const marginStyle = isMobile ? {
         } :
        { marginRight: 4}

    
    return (
        <Box as="section" flex="1" p="6" overflow="auto">
            <HStack
            align="start"
            wrap={isMobile ? "wrap" : "nowrap"}
            {...justifyStyle}
            >
            <Image
                height="100%"
                width="400px"
                {...marginStyle}
                marginBottom={isMobile ? 6 : 0}
                alt="Kevin Wong"
                src={"/me.jpg"}
            />
            <VStack align="left" gap={8} flex={1}>
                <VStack align="left">
                <Text>
                    <b>Business Process Consultant</b> at{" "}
                    <Link color="blue.500" href="https://sap.com" target="_blank">
                    <b>SAP</b>
                    </Link>
                </Text>
                <Text>
                    <b>Managing Partner</b> at{" "}
                    <Link color="blue.500" href="https://eienhq.com" target="_blank">
                    <b>Eien Capital Partners</b>
                    </Link>
                </Text>
                </VStack>
                <VStack align="left">
                <Text>
                    <b>Editor-in-Chief</b> at{" "}
                    <Link color="blue.500" href="https://mocktrialtips.com" target="_blank">
                    <b>Mock Trial Tips</b>
                    </Link>
                </Text>
                </VStack>
                <VStack align="left">
                <Text>
                    <b>B.S. Software Engineering</b> at{" "}
                    <Link color="blue.500" href="https://drexel.edu">
                    <b>Drexel University</b>
                    </Link>
                </Text>
                <Text>
                    <b>Alumnus, Trustee, Marketing Chair</b> at{" "}
                    <Link color="blue.500" href="https://www.romancatholichs.com" target="_blank">
                    <b>Roman Catholic High School</b>
                    </Link>
                </Text>
                <Text>
                    <b>Vice President</b> at{" "}
                    <Link color="blue.500" href="https://cahillclub.com" target="_blank">
                    <b>Cahill Club</b>
                    </Link>
                </Text>
                </VStack>
            </VStack>
            </HStack>
        </Box>
    )
}



