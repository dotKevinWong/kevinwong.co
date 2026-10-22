import { Alert, Badge, Button, Heading, HStack, Progress, Text, VStack } from "@chakra-ui/react";
import { daysBetween, daysLeftLabel, formatDate, percentOf } from "../../lib/admin/format";
import { spotifyBadge } from "../../lib/admin/messages";
import { AdminCard } from "./AdminCard";
import type { AdminStatus } from "./types";

// Mirrors SPOTIFY_SCOPES in lib/spotify-token.js, which imports the database pool.
const SCOPE_COUNT = 3;

export const SpotifyCard = ({ spotify }: { spotify: AdminStatus["spotify"] }) => {
    const b = spotifyBadge(spotify.state);
    const hasRow = spotify.state === "connected" || spotify.state === "dead";
    const missing = spotify.missingScopes ?? [];
    const { daysLeft } = spotify;
    const palette = daysLeft === null || daysLeft <= 14 ? "red" : daysLeft <= 30 ? "orange" : "green";

    return (
        <AdminCard maxW="420px">
            <VStack align="stretch" gap="3">
                <HStack gap="3">
                    <Heading>Spotify</Heading>
                    <Badge colorPalette={b.colorPalette}>{b.label}</Badge>
                </HStack>

                {spotify.state === "dead" && (
                    <Alert.Root status="error">
                        <Alert.Indicator />
                        <Alert.Content>
                            <Alert.Title>Spotify rejected the token</Alert.Title>
                            <Alert.Description>
                                {`Reason: ${spotify.deadReason}. Now Playing and Top Tracks stay empty until you reconnect.`}
                            </Alert.Description>
                        </Alert.Content>
                    </Alert.Root>
                )}
                {spotify.state === "missing" && <Text>No Spotify token is stored. Reconnect to connect the account.</Text>}

                {spotify.authorizedAt && spotify.expiresAt && (
                    <>
                        <Progress.Root
                            value={percentOf(Math.max(daysLeft ?? 0, 0), daysBetween(spotify.authorizedAt, spotify.expiresAt) ?? 180)}
                            size="sm" colorPalette={palette}>
                            <Progress.Label mb="1">{daysLeftLabel(daysLeft, { estimated: true })}</Progress.Label>
                            <Progress.Track><Progress.Range /></Progress.Track>
                        </Progress.Root>
                        <Text color="fg.muted" fontSize="sm">{`Approved ${formatDate(spotify.authorizedAt)}`}</Text>
                    </>
                )}

                {spotify.accountMatches === true && <Text>Account: the site&apos;s Spotify account</Text>}
                {spotify.accountMatches === false && (
                    <Text color="red.500">Account: a different Spotify account. Reconnect with the site&apos;s account.</Text>
                )}

                {hasRow && (
                    <>
                        <Text>{`Scopes: ${SCOPE_COUNT - missing.length} of ${SCOPE_COUNT}`}</Text>
                        {missing.length > 0 && <Text color="red.500">{`Missing: ${missing.join(", ")}`}</Text>}
                    </>
                )}

                {/* A form POST sends Origin, which the authorize route's same-origin check (lib/admin/spotify-reconnect.js)
                    needs, and passes lint (an <a> to /api/... doesn't). */}
                <form method="post" action="/api/admin/spotify/authorize">
                    <Button type="submit" variant={spotify.state === "connected" ? "outline" : "solid"}
                        colorPalette={spotify.state === "connected" ? "gray" : "green"}>Reconnect</Button>
                </form>
                <Text color="fg.muted" fontSize="sm">Opens Spotify&apos;s Approve page, then comes back here.</Text>
            </VStack>
        </AdminCard>
    );
};
