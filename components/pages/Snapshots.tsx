import { Box, Alert, AlertIcon } from "@chakra-ui/react"


export const SnapshotsPage = () => {
    return (
        <Box as="section" flex="1" p="6" overflow="auto">
            <Alert status="warning" maxW="3xl">
                <AlertIcon />
                This page is still under construction! Please check back later :)
            </Alert>
        </Box>
    )
}

