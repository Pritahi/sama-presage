/* Pure logic shared by the browser UI and the tests. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SamaLogic = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const GATE = { minPulseConf: 0.4, minBreathConf: 0.45 };

  /** Decide if the current reading is good enough to count toward the baseline. */
  function evaluateGate(state) {
    // state: {validationCode, pulse:{value,confidence}, breath:{value,confidence}, source}
    if (!state) return { ok: false, reason: 'no-data' };
    if (state.validationCode !== 0) return { ok: false, reason: 'validation' };
    const p = state.pulse, b = state.breath;
    const okConf = (x, min) => x.confidence == null || x.confidence >= min; // breathing samples carry no confidence
    const pulseOk = p && p.value > 0 && okConf(p, GATE.minPulseConf);
    const breathOk = b && b.value > 0 && okConf(b, GATE.minBreathConf);
    if (!pulseOk && !breathOk) return { ok: false, reason: 'low-confidence' };
    return { ok: true, reason: 'ok' };
  }

  /** Baseline countdown: only ticks while the gate is open. */
  function tickGate(progress, gate, dtSec, targetSec) {
    const next = Object.assign({}, progress);
    if (gate.ok) next.good = Math.min(targetSec, (next.good || 0) + dtSec);
    else next.paused = (next.paused || 0) + dtSec;
    next.done = next.good >= targetSec;
    return next;
  }

  function mean(a) { return a.length ? a.reduce((x, y) => x + y, 0) / a.length : null; }

  /** Pacer: phase for a pattern like [5,5] or [4,4,4,4] or [4,2,6] at time t seconds. */
  const PATTERNS = {
    sama: { id: 'sama', steps: [['inhale', 5], ['exhale', 5]] },
    box: { id: 'box', steps: [['inhale', 4], ['hold', 4], ['exhale', 4], ['hold', 4]] },
    shanti: { id: 'shanti', steps: [['inhale', 4], ['hold', 2], ['exhale', 6]] },
  };
  function pacerPhase(patternId, t) {
    const p = PATTERNS[patternId] || PATTERNS.sama;
    const total = p.steps.reduce((s, x) => s + x[1], 0);
    let r = ((t % total) + total) % total;
    for (const [name, len] of p.steps) {
      if (r < len) return { phase: name, progress: r / len, cycle: total };
      r -= len;
    }
    return { phase: p.steps[0][0], progress: 0, cycle: total };
  }
  function pacerBreathsPerMinute(patternId) {
    const p = PATTERNS[patternId] || PATTERNS.sama;
    return 60 / p.steps.reduce((s, x) => s + x[1], 0);
  }

  /**
   * Non-diagnostic comparison of rehearsal vs the user's own baseline.
   * Inputs: arrays of {pulse, breath} samples that passed the gate.
   * Output only describes change relative to the person's own baseline.
   */
  function computeReadiness(baseline, rehearsal) {
    const bp = mean(baseline.map((s) => s.pulse).filter(Boolean));
    const rp = mean(rehearsal.map((s) => s.pulse).filter(Boolean));
    const bb = mean(baseline.map((s) => s.breath).filter(Boolean));
    const rb = mean(rehearsal.map((s) => s.breath).filter(Boolean));
    if (bp == null && bb == null) return { enough: false };
    if (rp == null && rb == null) return { enough: false };
    const pulseDelta = bp != null && rp != null ? rp - bp : null;
    const breathDelta = bb != null && rb != null ? rb - bb : null;
    let label = 'steady';
    if ((breathDelta != null && breathDelta <= -1.5) || (pulseDelta != null && pulseDelta <= -3)) label = 'settled';
    else if ((breathDelta != null && breathDelta >= 1.5) || (pulseDelta != null && pulseDelta >= 3)) label = 'active';
    return {
      enough: true,
      label,
      baseline: { pulse: bp, breath: bb },
      rehearsal: { pulse: rp, breath: rb },
      pulseDelta, breathDelta,
      samples: { baseline: baseline.length, rehearsal: rehearsal.length },
    };
  }

  /** Session history in any Storage-like object. */
  const KEY = 'sama.sessions.v1';
  function makeStore(storage) {
    const read = () => { try { return JSON.parse(storage.getItem(KEY) || '[]'); } catch (e) { return []; } };
    const write = (v) => storage.setItem(KEY, JSON.stringify(v));
    return {
      list: read,
      add(session) { const all = read(); all.unshift(session); write(all); return session; },
      remove(id) { write(read().filter((s) => s.id !== id)); },
      clear() { storage.removeItem(KEY); },
      exportOne(id) { const s = read().find((x) => x.id === id); return s ? JSON.stringify(s, null, 2) : null; },
      exportAll() { return JSON.stringify(read(), null, 2); },
    };
  }

  return { GATE, evaluateGate, tickGate, pacerPhase, pacerBreathsPerMinute, PATTERNS, computeReadiness, makeStore, mean };
});
