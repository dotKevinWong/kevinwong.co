import { useEffect, useState } from "react";
import { Alert, Box, Button, Heading, Text, VStack } from "@chakra-ui/react";
import { FiGithub } from "react-icons/fi";
import { githubAuthorizeUrl } from "../../lib/admin/client";
import { signInErrorMessage } from "../../lib/admin/messages";
import { startGitHubSignIn } from "./api";
import { AdminCard } from "./AdminCard";

export const SignInPage = ({ error }: { error: string | null }) => {
    const [starting, setStarting] = useState(false);
    const [startError, setStartError] = useState<string | null>(null);

    // Pressing Back from GitHub restores this page from the back/forward cache with the
    // spinner still running. The setState sits in the listener, not in the effect body.
    useEffect(() => {
        const onPageShow = (event: PageTransitionEvent) => {
            if (event.persisted) setStarting(false);
        };
        window.addEventListener("pageshow", onPageShow);
        return () => window.removeEventListener("pageshow", onPageShow);
    }, []);

    async function start() {
        setStarting(true);
        setStartError(null);
        const r = await startGitHubSignIn();
        const url = r.ok ? githubAuthorizeUrl(r.body) : null;
        if (url) {
            // Leave the spinner on while the browser navigates away.
            window.location.assign(url);
            return;
        }
        setStarting(false);
        setStartError(signInErrorMessage(r.status === 429 ? "rate_limited" : "start_failed"));
    }

    const message = startError ?? signInErrorMessage(error);

    return (
        <Box as="section" flex="1" p="6" overflow="auto">
            <Heading as="h1" size="2xl" mb="4">Admin</Heading>
            <AdminCard maxW="420px">
                <VStack align="stretch" gap="4">
                    <Text>Only the site owner&apos;s GitHub account can sign in.</Text>
                    {message && (
                        <Alert.Root status="error">
                            <Alert.Indicator />
                            <Alert.Title>{message}</Alert.Title>
                        </Alert.Root>
                    )}
                    <Button colorPalette="gray" onClick={start} loading={starting} loadingText="Opening GitHub…">
                        <FiGithub /> Sign in with GitHub
                    </Button>
                </VStack>
            </AdminCard>
        </Box>
    );
};
