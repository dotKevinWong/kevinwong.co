// Import this before loading a pages/api/* file in a test. Those files import lib modules without an extension,
// which Next resolves and plain Node does not, so a relative specifier that was not found is retried with ".js".
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (error?.code !== "ERR_MODULE_NOT_FOUND" || !/^\.\.?\//.test(specifier)) throw error;
      return nextResolve(`${specifier}.js`, context);
    }
  },
});
