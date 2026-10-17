import { postJson as postJsonRaw } from "../../lib/admin/client";

export type PostResult<T> = { ok: boolean; status: number; body: T | null; signedOut: boolean };

/** lib/admin/client.js's postJson, with the response body typed by the caller. */
export function postJson<T>(url: string, body: unknown): Promise<PostResult<T>> { return postJsonRaw(url, body) as Promise<PostResult<T>>; }

/** Asks Better Auth for GitHub's authorize URL. callbackURL stays relative: Better Auth checks it against the trusted origins. */
export function startGitHubSignIn(): Promise<PostResult<{ url?: unknown }>> {
    return postJson("/api/auth/sign-in/social", { provider: "github", callbackURL: "/admin" });
}
