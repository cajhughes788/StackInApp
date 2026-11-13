import { Config } from "@remotion/cli/config"

// Remotion's bundled headless Chrome never paints a frame on this Mac, so
// render with the installed Google Chrome instead.
Config.setBrowserExecutable("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
Config.setEntryPoint("src/index.ts")
