/**
 * Tiny probe used by the unit suite: prints the resolved config so tests can
 * verify demo-account gating in isolated processes (production vs development).
 * This file must not print any secrets.
 */
import { config } from '../config.js';

console.log(
  JSON.stringify({
    nodeEnv: config.nodeEnv,
    isProduction: config.isProduction,
    demoMode: config.demoMode,
    cookieSecure: config.cookieSecure,
  })
);
