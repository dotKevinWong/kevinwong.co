export type SpotifyState = "connected" | "dead" | "env" | "missing";
export type RunStatus = "running" | "ok" | "partial" | "skipped" | "failed" | "reauth_required" | "abandoned";
export type Run = {
    id: number; trigger: "cron" | "panel" | "cli"; dryRun: boolean; status: RunStatus;
    startedAt: string; finishedAt: string | null;
    fetched: number; imported: number; uploads: number; deferred: number; skipped: number; errorCount: number;
    error: string | null;
};
export type AdminEvent = "sign_in" | "sign_in_rejected" | "spotify_connected" | "spotify_connect_failed"
    | "instagram_check" | "instagram_import" | "panel_run_refused";
export type AuditRow = { id: number; at: string; event: AdminEvent; actor: string | null; details: Record<string, unknown> };
export type AdminStatus = {
    generatedAt: string;
    spotify: {
        state: SpotifyState; authorizedAt: string | null; expiresAt: string | null;
        daysLeft: number | null; // floored whole days; negative once past expiresAt
        accountMatches: boolean | null;
        scopes: string[] | null; missingScopes: string[] | null; // null when there is no spotify row (lib/admin/status.js)
        deadReason: string | null;
    };
    instagram: {
        token: null | { expiresAt: string; daysLeft: number; refreshedAt: string; expiresAtIsAssumed: boolean; deadReason: string | null };
        lastCron: Run | null;
        cronOverdue: boolean;
        lease: { held: boolean; lockedUntil: string | null }; // lockedUntil is null unless held
        library: { posts: number; files: number; bytes: number };
        uploads30d: number;
        limits: { panelCeiling: number; cronCeiling: number; monthlyLimit: number; storageLimitBytes: number };
        panel: { nextCheckAt: string | null; nextImportAt: string | null; importBlockedReason: "daily_limit" | "upload_ceiling" | null };
    };
    runs: Run[];
    activity: AuditRow[]; // the newest 20, never a sign_in_rejected row (those are counted in refusedSignIns)
    refusedSignIns: { count24h: number; latestAt: string | null; latestLogin: string | null };
};
export type SyncPost = { shortcode: string; postedAt: string; mediaCount: number };
export type SyncResult = {
    status: "ok" | "partial" | "skipped"; fetched: number; alreadyPresent: number; posts: SyncPost[];
    uploads: number; deferred: number; errorCount: number; blob?: string; resize?: string;
};
export type AdminOwner = { name: string; image: string | null; login: string };
export type AdminFlash = { spotify: "connected" | null; spotifyError: string | null };
export type AdminPageProps = { owner: AdminOwner; initialStatus: AdminStatus | null; flash: AdminFlash };
export type FetchError = Error & { status?: number };
