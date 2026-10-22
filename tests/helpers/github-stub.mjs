import { mock } from "node:test";

// GitHub's side of a sign-in callback, for the integration tests that run the real Better Auth handler.
export const OWNER_PROFILE = Object.freeze({
  id: 1741711, login: "dotKevinWong", name: "Kevin Wong", email: null,
  avatar_url: "https://avatars.githubusercontent.com/u/1741711?v=4",
});
export const INTRUDER_PROFILE = Object.freeze({
  id: 999, login: "intruder", name: null, email: null, avatar_url: "https://avatars.githubusercontent.com/u/999?v=4",
});
// Where a sign-in goes to GitHub: /sign-in/social answers with this URL and its query string. The refusal tests
// check for this whole URL, not the bare host, which CodeQL flags as an incomplete URL check.
export const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";

/**
 * Stubs GitHub's three endpoints for one callback: the code exchange, the profile, and the emails list, which
 * answers 403 because sign-in asks for no scopes. Any other URL throws. Undo it with stub.mock.restore().
 */
export function stubGitHub(profile) {
  return mock.method(globalThis, "fetch", async (input) => {
    const url = typeof input === "string" ? input : input.url ?? String(input);
    if (url.startsWith("https://github.com/login/oauth/access_token")) {
      return Response.json({ access_token: "gho_test", token_type: "bearer", scope: "" });
    }
    if (url === "https://api.github.com/user") return Response.json(profile);
    if (url === "https://api.github.com/user/emails") return Response.json({ message: "Resource not accessible" }, { status: 403 });
    throw new Error(`Unexpected fetch: ${url}`);
  });
}
