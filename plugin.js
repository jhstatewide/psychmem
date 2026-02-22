/**
 * PsychMem OpenCode Plugin
 *
 * Entry point for OpenCode's plugin system when installed via npm.
 *
 * Add to opencode.json:
 * {
 *   "plugin": ["psychmem"]
 * }
 */

import { createOpenCodePlugin, parsePluginConfig } from 'psychmem/adapters/opencode';

export const PsychMem = async (ctx) => {
  return await createOpenCodePlugin(ctx, parsePluginConfig());
};
