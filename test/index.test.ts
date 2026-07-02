// Aggregator: importing a suite registers its node:test cases; the runner then
// executes them all when this file is run via `tsx test/index.test.ts`.
import './api.test';
import './cli.test';
import './convert.test';
import './debun.test';
import './log.test';
import './transpile.test';
import './version.test';
