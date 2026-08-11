#!/usr/bin/env node
// Thin launcher: runs the TypeScript CLI directly via tsx. This is a
// development-mode distribution (works anywhere inside the monorepo with
// node_modules installed); a packaged/compiled binary is future work once
// the CLI needs to be distributed outside this checkout.
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const platformRoot = join(here, "..", "..");
const tsxBin = join(platformRoot, "node_modules", ".bin", "tsx");
const entry = join(here, "..", "src", "index.ts");

const result = spawnSync(tsxBin, [entry, ...process.argv.slice(2)], { stdio: "inherit" });
process.exit(result.status ?? 1);
