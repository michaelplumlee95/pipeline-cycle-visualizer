// Entry point: node tests/run.js
const fs = require('fs');
const path = require('path');
const { summary } = require('./lib');

const started = Date.now();
fs.readdirSync(__dirname)
    .filter(f => f.endsWith('.test.js'))
    .sort()
    .forEach(f => require(path.join(__dirname, f)));

const ok = summary();
console.log(`elapsed: ${((Date.now() - started) / 1000).toFixed(1)}s`);
process.exit(ok ? 0 : 1);
