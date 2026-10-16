import { Box, Heading, Image, Text, Link, HStack, VStack } from "@chakra-ui/react"


export const HomePage = () => {
    // The mobile/desktop differences are responsive props rather than a
    // `useBreakpointValue` switch, so the server-rendered HTML already matches.
    return (
        <Box as="section" flex="1" p="6" overflow="auto">
            <Heading as="h1" srOnly>Kevin Wong</Heading>
            <HStack
            align="start"
            wrap={{ base: "wrap", md: "nowrap" }}
            justify={{ base: "center", md: "left" }}
            >
            {/* me.jpg is square: the aspect ratio reserves its space before it loads. */}
            <Image
                width="400px"
                height="auto"
                aspectRatio={1}
                marginRight={{ md: 4 }}
                marginBottom={{ base: 6, md: 0 }}
                alt="Kevin Wong"
                src={"/me.jpg"}
            />
            <VStack align="left" gap={8} flex={1}>
                <VStack align="left">
                <Text>
                    <b>Business Process Consultant</b> at{" "}
                    <Link color="blue.500" href="https://sap.com" target="_blank" rel="noopener noreferrer">
                    <b>SAP</b>
                    </Link>
                </Text>
                <Text>
                    <b>Managing Partner</b> at{" "}
                    <Link color="blue.500" href="https://eienhq.com" target="_blank" rel="noopener noreferrer">
                    <b>Eien Capital Partners</b>
                    </Link>
                </Text>
                </VStack>
                <VStack align="left">
                <Text>
                    <b>Editor-in-Chief</b> at{" "}
                    <Link color="blue.500" href="https://mocktrialtips.com" target="_blank" rel="noopener noreferrer">
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
                    <Link color="blue.500" href="https://www.romancatholichs.com" target="_blank" rel="noopener noreferrer">
                    <b>Roman Catholic High School</b>
                    </Link>
                </Text>
                <Text>
                    <b>Vice President</b> at{" "}
                    <Link color="blue.500" href="https://cahillclub.com" target="_blank" rel="noopener noreferrer">
                    <b>Cahill Club</b>
                    </Link>
                </Text>
                </VStack>
            </VStack>
            </HStack>
        </Box>
    )
}



