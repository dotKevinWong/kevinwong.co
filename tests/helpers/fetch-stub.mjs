// Replaces globalThis.fetch for one test; node:test restores it when the test ends.
//
// routes maps origin + pathname (for example "https://graph.instagram.com/v25.0/me") to a handler
// (url: URL) => Response | Promise<Response>. A URL with no route throws, and the message leaves out the
// query string, so a token passed as ?access_token= never reaches the test output.
//
// Returns the mock.method result, so stub.mock.callCount() counts every call, unrouted ones included.
export function stubFetch(t, routes) {
  return t.mock.method(globalThis, "fetch", async (input) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const key = `${url.origin}${url.pathname}`;
    if (!Object.hasOwn(routes, key)) throw new Error(`unexpected fetch: ${key}`);
    return routes[key](url);
  });
}
