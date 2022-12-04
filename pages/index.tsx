import useSWR from "swr";
import fetcher from "../lib/fetcher";
import { Sidebar } from "../components/Sidebar";
import { Box, Text, Flex, HStack, Image, VStack, Link, Container, Stack } from "@chakra-ui/react";

export default function Home() {
  const { data } = useSWR("/api/nowplaying", fetcher);

  return (
    <Flex
      as="section"
      direction={{ base: 'column', lg: 'row' }}
      height="100vh"
      bg="bg-canvas"
      overflowY="auto"
    >
      <title>Kevin Wong</title>
      <Sidebar/>
      <Flex h="full" id="app-container">
        <Box as="section" flex="1" p="6" marginTop="4" overflow="auto">
          <HStack align="left" wrap="wrap" justify="left">
            <Image height="400px" marginRight={4} marginBottom={6} alt="Kevin Wong" src={"/me.jpg"} />
            <VStack align="left" marginTop={8} spacing={8}>
              <Text><b>Business Process Consultant</b> at <Link color="blue.500" href="https://sap.com" target="_blank" isExternal><b>SAP</b></Link></Text>
              <VStack align="left">
                <Text><b>Editor-in-Chief</b> at <Link color="blue.500" href="https://mocktrialtips.com" target="_blank" isExternal><b>Mock Trial Tips</b></Link></Text>
                <Text><b>Content Creator</b> at <Link color="blue.500" href="https://codingfluent.com" target="_blank" isExternal><b>CodingFluent</b></Link></Text>
              </VStack>
              <VStack align="left">
                <Text><b>B.S. Software Engineering</b> at <Link color="blue.500" href="https://drexel.edu" isExternal><b>Drexel University</b></Link></Text>
                <Text><b>Alumnus and Trustee</b> at <Link color="blue.500" href="https://romancatholichs.com" target="_blank" isExternal><b>Roman Catholic High School</b></Link></Text>
              </VStack>
            </VStack>
          </HStack>
        </Box>
      </Flex>
    </Flex>
  );
}