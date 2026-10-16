import { Box, Heading, Text, VStack } from "@chakra-ui/react";
import { Meta } from "../components/Meta";
import { PageShell } from "../components/PageShell";

const Page = () => {
    return (
        <Box as="section" position="relative" w="100%" p="6" marginTop="2">
        <VStack align="left">
            <Heading>404 | Page not found</Heading>
            <Text>The page you were looking for could not be found.</Text>
            <VStack align="left">
                <Text>• There is an error in the URL entered into your web browser. Please check the URL and try again.</Text>
                <Text>• The page you are looking for has been moved or deleted.</Text>
            </VStack>
        </VStack>
        </Box>
    );
};

export default function Error() {
    return (
        <>
            <Meta title="404: ERROR NOT FOUND • Kevin Wong" />
            <PageShell>
                <Page />
            </PageShell>
        </>
    );
}
