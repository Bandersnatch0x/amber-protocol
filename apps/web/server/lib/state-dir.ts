/**
 * Canonical state directory name used by Amber Protocol.
 *
 * Server libraries that need to read session, gate, route, or lens data
 * should resolve paths through this constant rather than hardcoding '.amber'.
 */
export const AMBER_STATE_DIR = '.amber' as const;
