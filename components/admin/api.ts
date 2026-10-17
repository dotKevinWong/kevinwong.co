import { postJson as postJsonRaw } from "../../lib/admin/client";
import type { SyncResult } from "./types";

export type PostResult<T> = { ok: boolean; status: number; body: T | null; signedOut: boolean };

/** lib/admin/client.js's postJson, with the response body typed by the caller. */
export function postJson<T>(url: string, body: unknown): Promise<PostResult<T>> { return postJsonRaw(url, body) as Promise<PostResult<T>>; }

/** Asks Better Auth for GitHub's authorize URL. callbackURL stays relative: Better Auth checks it against the trusted origins. */
export function startGitHubSignIn(): Promise<PostResult<{ url?: unknown }>> {
    return postJson("/api/auth/sign-in/social", { provider: "github", callbackURL: "/admin" });
}

/** The panel's Check (dryRun: true) and Import (dryRun: false). The server fixes every other run parameter. */
export function runInstagramSync(dryRun: boolean): Promise<PostResult<SyncResult>> {
    return postJson<SyncResult>("/api/admin/instagram/sync", { dryRun });
}

/** Ends the session. Better Auth accepts only a JSON body, and its origin check passes on a same-origin fetch POST. */
export function signOut(): Promise<PostResult<{ success: boolean }>> {
    return postJson<{ success: boolean }>("/api/auth/sign-out", {});
}
