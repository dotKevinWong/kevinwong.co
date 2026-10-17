// For the Better Auth CLI only: it needs an exported instance, and lib/auth.js builds one lazily.
// Read-only check: npx --no-install auth check --config scripts/auth.config.mjs
import { getAuth } from "../lib/auth.js";

export const auth = getAuth();
