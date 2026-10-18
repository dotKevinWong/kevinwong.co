import { useEffect, useRef, useState } from "react";
import { Alert, Badge, Box, Button, CloseButton, Dialog, Flex, Heading, Link, List, Portal, Progress, Text, VStack }
    from "@chakra-ui/react";
import { daysLeftLabel, formatBytes, formatCount, formatDate, formatTimestamp, percentOf } from "../../lib/admin/format";
import { INSTAGRAM_TOKEN_REMEDY, checkNotice, importConfirmText, importNotice, panelAvailability, runStatusBadge,
    syncErrorMessage } from "../../lib/admin/messages";
import { runInstagramSync } from "./api";
import { AdminCard } from "./AdminCard";
import type { AdminStatus, SyncResult } from "./types";

type Notice = { status: "info" | "success" | "warning" | "error"; text: string };

const LISTED_POSTS = 10;
const postsLabel = (n: number) => `${n} ${n === 1 ? "post" : "posts"}`;

export const InstagramCard = ({ instagram, generatedAt, onChanged, onSignedOut }: {
    instagram: AdminStatus["instagram"];
    generatedAt: string;
    onChanged: () => void;
    onSignedOut: () => void;
}) => {
    const { token, lastCron, lease, library, limits } = instagram;
    const a = panelAvailability(instagram.panel, generatedAt, limits);
    const [busy, setBusy] = useState<null | "check" | "import">(null);
    const [checkResult, setCheckResult] = useState<SyncResult | null>(null);
    const [notice, setNotice] = useState<Notice | null>(null);
    const [confirmOpen, setConfirmOpen] = useState(false);
    // A successful import unmounts the dialog and the button that opened it, so focus moves to the result instead
    // of falling back to the page.
    const noticeRef = useRef<HTMLDivElement>(null);
    const focusNotice = useRef(false);
    useEffect(() => {
        if (!focusNotice.current || !notice) return;
        focusNotice.current = false;
        noticeRef.current?.focus();
    }, [notice]);
    // A Check whose Blob or resizer check failed doesn't offer Import: the import would fail on it.
    const checkAllowsImport = checkResult ? checkNotice(checkResult).importAllowed : false;

    const uploadsPalette = instagram.uploads30d >= limits.cronCeiling ? "red"
        : instagram.uploads30d >= limits.panelCeiling ? "orange" : "green";
    const storagePct = percentOf(library.bytes, limits.storageLimitBytes);
    const storagePalette = storagePct >= 90 ? "red" : storagePct >= 75 ? "orange" : "green";
    const cronBadge = lastCron ? runStatusBadge(lastCron.status) : null;

    async function run(dryRun: boolean) {
        setBusy(dryRun ? "check" : "import");
        setNotice(null);
        const result = await runInstagramSync(dryRun);
        setBusy(null);
        if (result.signedOut) return onSignedOut();
        if (result.ok && result.body) {
            if (dryRun) {
                const { status, text } = checkNotice(result.body);
                setCheckResult(result.body); setNotice({ status, text });
            } else {
                focusNotice.current = true;
                setCheckResult(null); setConfirmOpen(false);
                setNotice(importNotice(result.body));
            }
        } else {
            if (!dryRun) setConfirmOpen(false);
            setNotice({ status: "error", text: syncErrorMessage(result) });
        }
        onChanged();
    }

    return (
        <AdminCard maxW="520px">
            <VStack align="stretch" gap="3">
                <Heading>Instagram</Heading>

                {token === null ? <Text>No Instagram token is stored.</Text> : (
                    <>
                        <Text>{`Token: ${daysLeftLabel(token.daysLeft, { estimated: token.expiresAtIsAssumed })}`}</Text>
                        <Text color="fg.muted" fontSize="sm">{`Refreshed ${formatTimestamp(token.refreshedAt)}`}</Text>
                        {token.deadReason && (
                            <Alert.Root status="error">
                                <Alert.Indicator />
                                <Alert.Content>
                                    <Alert.Title>Instagram rejected the token</Alert.Title>
                                    <Alert.Description>
                                        {`Reason: ${token.deadReason}. The sync has stopped. ${INSTAGRAM_TOKEN_REMEDY}`}
                                    </Alert.Description>
                                </Alert.Content>
                            </Alert.Root>
                        )}
                    </>
                )}

                {instagram.cronOverdue && (
                    <Alert.Root status="warning">
                        <Alert.Indicator />
                        <Alert.Content>
                            <Alert.Title>No cron run in 36 hours</Alert.Title>
                            <Alert.Description>
                                The daily sync has not recorded a run in 36 hours. Check the cron job in the Vercel dashboard.
                            </Alert.Description>
                        </Alert.Content>
                    </Alert.Root>
                )}

                {lastCron && cronBadge ? (
                    <>
                        <Flex align="center" gap="2" wrap="wrap">
                            <Text>{`Last cron run ${formatTimestamp(lastCron.startedAt)}`}</Text>
                            <Badge colorPalette={cronBadge.colorPalette}>{cronBadge.label}</Badge>
                        </Flex>
                        <Text color="fg.muted" fontSize="sm">
                            {`Imported ${lastCron.imported}, uploads ${lastCron.uploads}, deferred ${lastCron.deferred}, skipped ${lastCron.skipped}, errors ${lastCron.errorCount}`}
                        </Text>
                        {lastCron.error && <Text color="red.500" lineClamp={2}>{lastCron.error}</Text>}
                    </>
                ) : <Text>No cron run recorded yet.</Text>}

                {lease.held && (
                    <Text color="fg.muted" fontSize="sm">{`A sync is running now (lease until ${formatTimestamp(lease.lockedUntil)}).`}</Text>
                )}

                <Text>{`${formatCount(library.posts)} posts, ${formatCount(library.files)} files`}</Text>

                <Progress.Root value={percentOf(instagram.uploads30d, limits.monthlyLimit)} size="sm" colorPalette={uploadsPalette}>
                    <Progress.Label mb="1">
                        {`Uploads, last 30 days: ${formatCount(instagram.uploads30d)} of ${formatCount(limits.monthlyLimit)}`}
                    </Progress.Label>
                    <Progress.Track><Progress.Range /></Progress.Track>
                </Progress.Root>
                <Text color="fg.muted" fontSize="sm">
                    {`Panel imports stop at ${formatCount(limits.panelCeiling)}; the daily sync stops at ${formatCount(limits.cronCeiling)}.`}
                </Text>

                <Progress.Root value={storagePct} size="sm" colorPalette={storagePalette}>
                    <Progress.Label mb="1">
                        {`Storage: ${formatBytes(library.bytes)} of ${formatBytes(limits.storageLimitBytes)}`}
                    </Progress.Label>
                    <Progress.Track><Progress.Range /></Progress.Track>
                </Progress.Root>

                <VStack align="flex-start" gap="2">
                    <Button onClick={() => run(true)} loading={busy === "check"} loadingText="Checking…"
                        disabled={!a.canCheck || busy !== null}>Check for new posts</Button>
                    {a.checkHint && <Text color="fg.muted" fontSize="sm">{a.checkHint}</Text>}
                    {!a.canImport && a.importHint && <Text color="fg.muted" fontSize="sm">{a.importHint}</Text>}
                </VStack>

                {notice && (
                    // An error is announced at once; any other result politely.
                    <Alert.Root status={notice.status} role={notice.status === "error" ? "alert" : "status"}
                        ref={noticeRef} tabIndex={-1}>
                        <Alert.Indicator />
                        <Alert.Description>{notice.text}</Alert.Description>
                    </Alert.Root>
                )}

                {checkResult && (
                    <>
                        {checkResult.posts.length > 0 && (
                            <List.Root unstyled gap="1">
                                {checkResult.posts.slice(0, LISTED_POSTS).map((p) => (
                                    <List.Item key={p.shortcode}>
                                        <Flex gap="2" wrap="wrap" align="baseline">
                                            <Text>{formatDate(p.postedAt)}</Text>
                                            <Text color="fg.muted">{`${p.mediaCount} ${p.mediaCount === 1 ? "file" : "files"}`}</Text>
                                            <Link href={`https://www.instagram.com/p/${p.shortcode}/`} target="_blank"
                                                rel="noopener noreferrer">{p.shortcode}</Link>
                                        </Flex>
                                    </List.Item>
                                ))}
                                {checkResult.posts.length > LISTED_POSTS && (
                                    <List.Item><Text color="fg.muted">{`and ${checkResult.posts.length - LISTED_POSTS} more`}</Text></List.Item>
                                )}
                            </List.Root>
                        )}
                        {/* Every dry run reports both, with or without posts: Step 14 of the Deploy B runbook reads them as
                            the proof that Blob and sharp work in the deployed function. */}
                        {checkResult.blob && <Text color="fg.muted" fontSize="sm">{`Blob: ${checkResult.blob}`}</Text>}
                        {checkResult.resize && <Text color="fg.muted" fontSize="sm">{`Resize: ${checkResult.resize}`}</Text>}

                        {checkResult.posts.length > 0 && (
                            <>
                                <Button colorPalette="blue" alignSelf="flex-start" onClick={() => setConfirmOpen(true)}
                                    disabled={!a.canImport || !checkAllowsImport || busy !== null}>
                                    Import {postsLabel(checkResult.posts.length)}
                                </Button>
                                <Dialog.Root role="alertdialog" open={confirmOpen} onOpenChange={(e) => setConfirmOpen(e.open)}
                                    closeOnInteractOutside={busy !== "import"} closeOnEscape={busy !== "import"}
                                    finalFocusEl={() => (focusNotice.current ? noticeRef.current : null)}>
                                    <Portal>
                                        <Dialog.Backdrop />
                                        <Dialog.Positioner>
                                            <Dialog.Content>
                                                <Dialog.Header>
                                                    <Dialog.Title>Import {postsLabel(checkResult.posts.length)}?</Dialog.Title>
                                                </Dialog.Header>
                                                <Dialog.Body>
                                                    {/* The dialog's aria-describedby points here. */}
                                                    <Dialog.Description asChild>
                                                        <Box>
                                                            <Text>{importConfirmText(checkResult, instagram)}</Text>
                                                            <Text mt="2">
                                                                Posts that appeared since the check are included, within the same 25-upload cap.
                                                            </Text>
                                                        </Box>
                                                    </Dialog.Description>
                                                </Dialog.Body>
                                                <Dialog.Footer>
                                                    <Dialog.ActionTrigger asChild>
                                                        <Button variant="outline" disabled={busy === "import"}>Cancel</Button>
                                                    </Dialog.ActionTrigger>
                                                    <Button colorPalette="blue" loading={busy === "import"} loadingText="Importing…"
                                                        onClick={() => run(false)}>Import</Button>
                                                </Dialog.Footer>
                                                <Dialog.CloseTrigger asChild><CloseButton size="sm" /></Dialog.CloseTrigger>
                                            </Dialog.Content>
                                        </Dialog.Positioner>
                                    </Portal>
                                </Dialog.Root>
                            </>
                        )}
                    </>
                )}
            </VStack>
        </AdminCard>
    );
};
