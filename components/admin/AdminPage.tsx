import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import useSWR from "swr";
import { Alert, Avatar, Box, Button, CloseButton, Flex, Heading, HStack, Spinner, Text } from "@chakra-ui/react";
import { FiLogOut } from "react-icons/fi";
import fetcher from "../../lib/fetcher";
import { formatTimestamp } from "../../lib/admin/format";
import { spotifyFlashMessage } from "../../lib/admin/messages";
import { signOut } from "./api";
import { ActivityLog } from "./ActivityLog";
import { InstagramCard } from "./InstagramCard";
import { RunsTable } from "./RunsTable";
import { SpotifyCard } from "./SpotifyCard";
import type { AdminPageProps, AdminStatus, FetchError } from "./types";

export const AdminPage = ({ owner, initialStatus, flash }: AdminPageProps) => {
    const router = useRouter();
    // Every lost-session path ends here. The sign-in page's getServerSideProps checks the session again on the server.
    const goToSignIn = () => { void router.replace("/admin/sign-in"); };

    const { data, error, mutate } = useSWR<AdminStatus, FetchError>("/api/admin/status", fetcher, {
        fallbackData: initialStatus ?? undefined,
        refreshInterval: 30_000,
        // A status that rendered on the server isn't fetched again at once; a failed one is.
        revalidateOnMount: initialStatus === null,
        onError: (err) => { if (err.status === 401) goToSignIn(); },
    });

    const [signingOut, setSigningOut] = useState(false);
    const [signOutFailed, setSignOutFailed] = useState(false);
    const [flashDismissed, setFlashDismissed] = useState(false);
    const flashMessage = spotifyFlashMessage(flash);

    // Take the reconnect result out of the address bar so a reload doesn't repeat the flash.
    // Shallow routing keeps the props, so the alert stays until it is dismissed.
    useEffect(() => {
        if (router.query.spotify !== undefined || router.query.spotify_error !== undefined) {
            void router.replace("/admin", undefined, { shallow: true });
        }
    }, [router]);

    async function handleSignOut() {
        setSigningOut(true);
        setSignOutFailed(false);
        const r = await signOut();
        if (r.ok || r.signedOut) {
            // Leave the spinner on while the router navigates away.
            goToSignIn();
            return;
        }
        setSigningOut(false);
        setSignOutFailed(true);
    }

    return (
        <Box as="section" flex="1" p="6" overflow="auto">
            <Flex justify="space-between" align="center" wrap="wrap" gap="4" mb="6">
                <Heading as="h1" size="2xl">Admin</Heading>
                <HStack gap="3">
                    <Avatar.Root size="sm">
                        <Avatar.Image src={owner.image ?? undefined} alt="" />
                        <Avatar.Fallback name={owner.name} />
                    </Avatar.Root>
                    <Text fontWeight="medium">@{owner.login}</Text>
                    <Button size="sm" variant="outline" loading={signingOut} onClick={handleSignOut}>
                        <FiLogOut /> Sign out
                    </Button>
                </HStack>
            </Flex>
            {signOutFailed && <Text color="red.500" mb="4">Sign-out failed. Try again.</Text>}

            {flashMessage && !flashDismissed && (
                <Alert.Root status={flashMessage.status} mb="4">
                    <Alert.Indicator />
                    <Alert.Content>
                        <Alert.Title>{flashMessage.title}</Alert.Title>
                        <Alert.Description>{flashMessage.description}</Alert.Description>
                    </Alert.Content>
                    <CloseButton size="sm" aria-label="Dismiss" onClick={() => setFlashDismissed(true)} />
                </Alert.Root>
            )}

            {!data && error && (
                <Alert.Root status="error" mb="4">
                    <Alert.Indicator />
                    <Alert.Content>
                        <Alert.Title>Couldn&apos;t load the status</Alert.Title>
                        <Alert.Description>The page keeps retrying on its own. Press Try again to retry now.</Alert.Description>
                    </Alert.Content>
                    <Button size="sm" onClick={() => void mutate()}>Try again</Button>
                </Alert.Root>
            )}
            {!data && !error && (
                <Flex align="center" gap={3}><Spinner size="sm" /><Text>Loading status...</Text></Flex>
            )}
            {data && error && error.status !== 401 && (
                <Alert.Root status="warning" mb="4">
                    <Alert.Indicator />
                    <Alert.Content>
                        <Alert.Title>Couldn&apos;t refresh the status</Alert.Title>
                        <Alert.Description>{`Showing the status from ${formatTimestamp(data.generatedAt)}.`}</Alert.Description>
                    </Alert.Content>
                </Alert.Root>
            )}

            {data && (
                <>
                    <Flex wrap="wrap" rowGap={4} columnGap={4} mb="4">
                        <SpotifyCard spotify={data.spotify} />
                        <InstagramCard instagram={data.instagram} generatedAt={data.generatedAt}
                            onChanged={() => void mutate()} onSignedOut={goToSignIn} />
                    </Flex>
                    <RunsTable runs={data.runs} />
                    <ActivityLog activity={data.activity} refusedSignIns={data.refusedSignIns} />
                    <Text color="fg.muted" fontSize="sm" mt="4">
                        Status as of {formatTimestamp(data.generatedAt)}. Refreshes every 30 seconds.
                    </Text>
                </>
            )}
        </Box>
    );
};
