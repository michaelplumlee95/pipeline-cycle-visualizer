// Loads the REAL script.js into a vm sandbox with a tiny stub DOM, so tests
// exercise the shipped code instead of a hand-copied duplicate.
//
// script.js keeps everything inside a DOMContentLoaded closure. Rather than
// editing it, the harness appends a test-only export line just before the
// closing `});` at load time.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

// PIPE_SCRIPT lets the mutation check point the suite at a broken copy.
const SCRIPT_PATH = process.env.PIPE_SCRIPT || path.join(__dirname, '..', 'script.js');

const EXPORTS = `
globalThis.__pipe = {
    assemble, simulate, escapeHtml, examples, maxInstructions,
    getProgramText: () => programText,
};
`;

function loadSource(scriptPath) {
    const src = fs.readFileSync(scriptPath || SCRIPT_PATH, 'utf8');
    const idx = src.lastIndexOf('});');
    if (idx < 0) throw new Error('harness: could not find closing "});" in script.js');
    return src.slice(0, idx) + EXPORTS + src.slice(idx);
}

// --- Stub DOM ---------------------------------------------------------------

class StubElement {
    constructor(id, doc) {
        this.id = id;
        this._doc = doc;
        this._html = '';
        this.value = '';
        this.dataset = {};
        this.listeners = {};
        this.children = [];
        this._classes = new Set();
        this.htmlWrites = 0;
        const self = this;
        this.classList = {
            toggle(c, on) { on ? self._classes.add(c) : self._classes.delete(c); },
            contains(c) { return self._classes.has(c); },
        };
    }
    get innerHTML() { return this._html; }
    set innerHTML(v) {
        this._html = String(v);
        this.htmlWrites++;
        this._doc._reparse(this);
    }
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
    dispatch(type, extra) {
        const ev = Object.assign({ target: this, type }, extra);
        (this.listeners[type] || []).forEach(fn => fn(ev));
    }
    closest(sel) { return this._matches(sel) ? this : null; }
    _matches(sel) {
        // Supports: ".cls", "[data-x]", "[data-x=\"v\"]"
        let m = /^\.([\w-]+)$/.exec(sel);
        if (m) return this._classes.has(m[1]);
        m = /^\[data-([\w-]+)(?:="([^"]*)")?\]$/.exec(sel);
        if (!m) return false;
        const key = m[1].replace(/-(\w)/g, (_, c) => c.toUpperCase());
        if (!(key in this.dataset)) return false;
        return m[2] === undefined || this.dataset[key] === m[2];
    }
}

class StubDocument {
    constructor() {
        this.byId = {};
        this.listeners = {};
        this.all = []; // pseudo-elements parsed out of rendered markup (tr, td, li)
    }
    element(id) { return (this.byId[id] = this.byId[id] || new StubElement(id, this)); }
    getElementById(id) { return this.byId[id] || null; }
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
    dispatch(type, target) { (this.listeners[type] || []).forEach(fn => fn({ target, type })); }
    querySelectorAll(sel) { return this.all.filter(e => e._matches(sel)); }

    // When a container's innerHTML changes, rebuild pseudo-elements for the
    // nodes tests care about (rows, cells, list items).
    _reparse(container) {
        this.all = this.all.filter(e => e._owner !== container);
        container.children = [];
        const tagRe = /<(tr|td|li)\b([^>]*)>/g;
        let m;
        while ((m = tagRe.exec(container._html))) {
            const attrs = {};
            const attrRe = /([\w-]+)="([^"]*)"/g;
            let a;
            while ((a = attrRe.exec(m[2]))) attrs[a[1]] = a[2];
            const el = new StubElement(null, this);
            el.tag = m[1];
            el._owner = container;
            (attrs.class || '').split(/\s+/).filter(Boolean).forEach(c => el._classes.add(c));
            for (const [k, v] of Object.entries(attrs)) {
                if (k.startsWith('data-')) el.dataset[k.slice(5).replace(/-(\w)/g, (_, c) => c.toUpperCase())] = v;
            }
            container.children.push(el);
            this.all.push(el);
        }
    }
}

// --- App factory ------------------------------------------------------------

function createApp(opts = {}) {
    const doc = new StubDocument();
    ['example-select', 'program-input', 'program-errors', 'stage-legend',
        'cycle-table-container', 'summary', 'explanation-list'].forEach(id => doc.element(id));

    const sandbox = { document: doc, console, Math, JSON, parseInt, String, Set, Map, Array, Object };
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(loadSource(opts.scriptPath), sandbox, { filename: 'script.js' });
    (doc.listeners.DOMContentLoaded || []).forEach(fn => fn());

    const raw = sandbox.__pipe;
    if (!raw) throw new Error('harness: export hook failed');
    // Values crossing the vm boundary carry the sandbox's Array/Object
    // prototypes, which strict deepEqual rejects; clone them into this realm.
    const clone = v => (v && typeof v === 'object') ? JSON.parse(JSON.stringify(v)) : v;
    const api = {
        maxInstructions: raw.maxInstructions,
        assemble: text => clone(raw.assemble(text)),
        simulate: instrs => clone(raw.simulate(instrs)),
        escapeHtml: raw.escapeHtml,
        examples: clone(raw.examples),
        getProgramText: raw.getProgramText,
    };

    const select = doc.getElementById('example-select');
    const input = doc.getElementById('program-input');
    return {
        doc, api,
        el: id => doc.getElementById(id),
        html: id => doc.getElementById(id).innerHTML,
        // Same path a user takes: edit the textarea, fire 'input'.
        type(text) { input.value = text; input.dispatch('input', { target: input }); },
        chooseExample(id) { select.value = id; select.dispatch('change', { target: select }); },
        select, input,
        rows: () => doc.all.filter(e => e.tag === 'tr' && e._classes.has('cycle-row')),
        cells: () => doc.all.filter(e => e.tag === 'td'),
    };
}

module.exports = { createApp, loadSource, SCRIPT_PATH };
