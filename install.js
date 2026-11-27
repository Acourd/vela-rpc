#!/usr/bin/env node
/**
 * Vela RPC — Zero-Friction Installer Entrypoint
 * Interactive in human terminals; deterministic & non-blocking with `--yes` or inside AI agents.
 */

import { runSetupWizard } from './core/installer.js';

runSetupWizard(process.argv.slice(2)).catch((err) => {
  console.error('Setup error:', err.message);
  process.exit(1);
});
