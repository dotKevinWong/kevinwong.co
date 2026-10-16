import { defineConfig } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextCoreWebVitals,
  ...nextTs,
  {
    // Vendored Chakra CLI snippets (`npx @chakra-ui/cli snippet add`): kept
    // as generated so they can be re-pulled, including their empty
    // `interface FooProps extends BarProps {}` declarations.
    files: ["components/ui/**"],
    rules: {
      "@typescript-eslint/no-empty-object-type": "off",
    },
  },
]);
