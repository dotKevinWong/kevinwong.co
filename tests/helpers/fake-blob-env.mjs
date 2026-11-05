// Points Vercel Blob at a closed local port with no retries, so an upload a test did not stub fails at once instead
// of reaching the real store. Import order does not matter: lib/blob-store.js and the SDK read these at call time, and
// this overwrites the retries default that lib/blob-store.js sets when it loads.
process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_fake_for_tests";
process.env.VERCEL_BLOB_API_URL = "http://127.0.0.1:9";
process.env.VERCEL_BLOB_RETRIES = "0";
delete process.env.BLOB_STORE_ID;
