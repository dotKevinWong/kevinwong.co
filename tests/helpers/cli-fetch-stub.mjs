// Preloaded with `node --import` into a script that a test runs as a child process, where stubFetch cannot
// reach. The Instagram media list answers with no posts and every other fetch fails at once, so the script can
// never call a real API. As in fetch-stub.mjs, the message leaves out the query string, so a token passed as
// ?access_token= never reaches the test output.
const MEDIA = "https://graph.instagram.com/v25.0/me/media";

globalThis.fetch = async (input) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const key = `${url.origin}${url.pathname}`;
  if (key === MEDIA) return Response.json({ data: [] });
  throw new Error(`unexpected fetch: ${key}`);
};
