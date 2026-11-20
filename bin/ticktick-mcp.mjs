#!/usr/bin/env node
import { runCli } from '../src/mcp-server.mjs';

runCli().catch((error) => {
  process.stderr.write(`[ticktick-mcp] ${error?.stack || error}\n`);
  process.exitCode = 1;
});
