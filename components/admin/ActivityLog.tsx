import { Heading, Stack, Text } from "@chakra-ui/react";
import { formatCount, formatTimestamp } from "../../lib/admin/format";
import { activityLabel, detailsSummary } from "../../lib/admin/messages";
import { AdminCard } from "./AdminCard";
import type { AdminStatus } from "./types";

export const ActivityLog = ({ activity, refusedSignIns }: {
    activity: AdminStatus["activity"];
    refusedSignIns: AdminStatus["refusedSignIns"];
}) => (
    <AdminCard>
        <Heading size="md" mb="3">Activity</Heading>
        {/* Counted separately from the rows: recentAdminEvents leaves refusals out, so a burst of them
            can't push real events out of the 20. */}
        {refusedSignIns.count24h > 0 && (
            <>
                <Text fontWeight="medium">Refused sign-ins in the last 24 hours: {formatCount(refusedSignIns.count24h)}</Text>
                {refusedSignIns.latestAt && (
                    <Text color="fg.muted" fontSize="sm" mb="3">
                        {`Latest: ${refusedSignIns.latestLogin ?? "unknown"}, ${formatTimestamp(refusedSignIns.latestAt)}`}
                    </Text>
                )}
            </>
        )}
        {activity.length === 0 ? <Text color="fg.muted">No activity yet.</Text> : (
            <Stack gap="3">
                {activity.slice(0, 20).map((row) => (
                    <Stack key={row.id} direction={{ base: "column", md: "row" }} gap={{ base: 0, md: 3 }}>
                        <Text color="fg.muted">{formatTimestamp(row.at)}</Text>
                        <Text fontWeight="medium">{activityLabel(row.event)}</Text>
                        <Text color="fg.muted">{detailsSummary(row.details)}</Text>
                    </Stack>
                ))}
            </Stack>
        )}
    </AdminCard>
);
