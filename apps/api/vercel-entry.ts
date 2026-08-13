/**
 * Vercel Services validates that this entrypoint exists before it runs the API
 * service build command. The build replaces this file in Vercel's isolated
 * checkout with a dependency-complete bundle; local builds write to dist/.
 */
export { default } from "./src/index.js";
