// Independent reference model: a cycle-by-cycle pipeline that moves instructions between
// latches and checks hazards each cycle. It shares no timing formulas with script.js
// (which computes each instruction's cycles directly), so agreement is meaningful.
//
// Takes assembled instructions, returns { total, stageAt, path }.
// stageAt[i][cycle] = 'IF'|'ID'|'EX'|'MEM'|'WB' for dynamic instruction i.

function simulateOracle(instrs, cap) {
    const path = [];
    let pc = 0;
    while (pc < instrs.length && path.length < cap) {
        path.push(instrs[pc]);
        pc = instrs[pc].op === 'j' ? instrs[pc].target : pc + 1;
    }
    const n = path.length;
    const isControl = ins => ins.op === 'beq' || ins.op === 'j';
    const stageAt = path.map(() => ({}));
    const wroteBack = new Array(n).fill(false);

    let next = 0;
    let cur = { IF: null, ID: null, EX: null, MEM: null, WB: null };
    let blocked = null; // { resolve: cycle | null } while a branch/jump is in flight
    if (n > 0) cur.IF = next++;

    let t = 1;
    for (;;) {
        if (Object.values(cur).every(v => v === null) && next >= n) break;
        Object.keys(cur).forEach(s => { if (cur[s] !== null) stageAt[cur[s]][t] = s; });

        // The register file is written in the first half of WB, so a reader in ID this
        // cycle already sees what the instruction in WB writes.
        if (cur.WB !== null) wroteBack[cur.WB] = true;

        let idProceeds = false;
        if (cur.ID !== null) {
            idProceeds = path[cur.ID].srcs.every(src => {
                if (src.n === 0) return true;
                for (let w = cur.ID - 1; w >= 0; w--) {
                    const d = path[w].dest;
                    if (d && d.n === src.n) return wroteBack[w];
                }
                return true;
            });
        }

        const nxt = { IF: null, ID: null, EX: null, MEM: cur.EX, WB: cur.MEM };
        if (idProceeds) {
            nxt.EX = cur.ID;
            if (isControl(path[cur.ID])) blocked.resolve = path[cur.ID].op === 'j' ? t : t + 1;
        }
        const idFree = cur.ID === null || idProceeds;
        if (idFree) {
            nxt.ID = cur.IF;
            if (cur.IF !== null && isControl(path[cur.IF])) blocked = { resolve: null };
        } else {
            nxt.ID = cur.ID;
            nxt.IF = cur.IF; // held behind the stalled instruction
        }
        if (blocked && blocked.resolve !== null && t >= blocked.resolve) blocked = null;
        if (idFree && !blocked && next < n) nxt.IF = next++;

        cur = nxt;
        t++;
    }
    return { total: t - 1, stageAt, path };
}

module.exports = { simulateOracle };
