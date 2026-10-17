import { Badge, Heading, Table, Text } from "@chakra-ui/react";
import { formatTimestamp } from "../../lib/admin/format";
import { runStatusBadge } from "../../lib/admin/messages";
import { AdminCard } from "./AdminCard";
import type { Run } from "./types";

const COLUMNS = ["Started", "Trigger", "Status", "Imported", "Uploads", "Deferred", "Skipped", "Errors", "Error"];
const inherit = { backgroundColor: "inherit" };

export const RunsTable = ({ runs }: { runs: Run[] }) => (
    <AdminCard mb="4">
        <Heading size="md" mb="3">Recent runs</Heading>
        {runs.length === 0 ? <Text color="fg.muted">No runs recorded yet.</Text> : (
            <Table.ScrollArea>
                <Table.Root size="sm" css={inherit}>
                    <Table.Header>
                        <Table.Row css={inherit}>
                            {COLUMNS.map((name) => <Table.ColumnHeader key={name}>{name}</Table.ColumnHeader>)}
                        </Table.Row>
                    </Table.Header>
                    <Table.Body>
                        {runs.slice(0, 20).map((run) => {
                            const badge = runStatusBadge(run.status);
                            return (
                                <Table.Row key={run.id} css={inherit}>
                                    <Table.Cell whiteSpace="nowrap">{formatTimestamp(run.startedAt)}</Table.Cell>
                                    <Table.Cell>{run.dryRun ? `${run.trigger} (check)` : run.trigger}</Table.Cell>
                                    <Table.Cell><Badge colorPalette={badge.colorPalette}>{badge.label}</Badge></Table.Cell>
                                    <Table.Cell>{run.imported}</Table.Cell>
                                    <Table.Cell>{run.uploads}</Table.Cell>
                                    <Table.Cell>{run.deferred}</Table.Cell>
                                    <Table.Cell>{run.skipped}</Table.Cell>
                                    <Table.Cell>{run.errorCount}</Table.Cell>
                                    <Table.Cell truncate maxW="xs" title={run.error ?? undefined}>{run.error}</Table.Cell>
                                </Table.Row>
                            );
                        })}
                    </Table.Body>
                </Table.Root>
            </Table.ScrollArea>
        )}
    </AdminCard>
);
