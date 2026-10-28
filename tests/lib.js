// Minimal test runner pieces: no dependencies, exits non-zero on failure.
const assert = require('node:assert/strict');

const state = { pass: 0, fail: 0, failures: [], notes: [], suite: '' };

function suite(name) {
    state.suite = name;
    console.log(`\n== ${name}`);
}

function test(name, fn) {
    try {
        fn();
        state.pass++;
        console.log(`  ok   ${name}`);
    } catch (err) {
        state.fail++;
        state.failures.push({ suite: state.suite, name, err });
        console.log(`  FAIL ${name}\n       ${String(err && err.message || err).split('\n').join('\n       ')}`);
    }
}

// Informational output that never fails the run (e.g. optimality statistics).
function note(msg) {
    state.notes.push(`[${state.suite}] ${msg}`);
    console.log(`  note ${msg}`);
}

// Deterministic PRNG so random tests reproduce; seed is printed on failure.
function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function summary() {
    console.log('\n----------------------------------------');
    console.log(`${state.pass} passed, ${state.fail} failed`);
    if (state.failures.length) {
        console.log('\nFailures:');
        state.failures.forEach(f => console.log(` - [${f.suite}] ${f.name}`));
    }
    return state.fail === 0;
}

module.exports = { assert, suite, test, note, mulberry32, summary, state };
