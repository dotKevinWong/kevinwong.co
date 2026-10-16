/**
 * The SWR fetcher. A non-2xx response throws, so SWR reports it as `error`
 * rather than handing the error body to the UI as if it were data.
 */
export default async function fetcher(url) {
  const res = await fetch(url);

  if (!res.ok) {
    const error = new Error(`Request to ${url} failed with ${res.status}`);
    error.status = res.status;
    throw error;
  }

  return res.json();
}
