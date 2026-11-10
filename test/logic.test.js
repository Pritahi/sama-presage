const test = require('node:test');
const assert = require('node:assert');
const L = require('../public/logic.js');
const { T } = require('../public/i18n.js');

test('gate closes on bad validation or low confidence', () => {
  assert.equal(L.evaluateGate({ validationCode: 1, pulse: { value: 70, confidence: 0.9 } }).ok, false);
  assert.equal(L.evaluateGate({ validationCode: 0, pulse: { value: 70, confidence: 0.1 }, breath: { value: 14, confidence: 0.1 } }).ok, false);
  assert.equal(L.evaluateGate({ validationCode: 0, pulse: { value: 70, confidence: 0.8 } }).ok, true);
  assert.equal(L.evaluateGate(null).ok, false);
  assert.equal(L.evaluateGate({ validationCode: 0, pulse: null, breath: { value: 9, confidence: null } }).ok, true);
});
test('baseline timer pauses while gate is closed', () => {
  let p = { good: 0 };
  p = L.tickGate(p, { ok: true }, 1, 3); p = L.tickGate(p, { ok: false }, 1, 3);
  assert.equal(p.good, 1); assert.equal(p.paused, 1); assert.equal(p.done, false);
  p = L.tickGate(p, { ok: true }, 2, 3); assert.equal(p.done, true);
});
test('pacer phases follow the pattern', () => {
  assert.equal(L.pacerPhase('sama', 0).phase, 'inhale');
  assert.equal(L.pacerPhase('sama', 5).phase, 'exhale');
  assert.equal(L.pacerPhase('box', 4).phase, 'hold');
  assert.equal(L.pacerPhase('shanti', 7).phase, 'exhale');
  assert.equal(L.pacerBreathsPerMinute('sama'), 6);
});
test('readiness compares against own baseline and makes no diagnosis fields', () => {
  const r = L.computeReadiness([{ pulse: 80, breath: 16 }], [{ pulse: 74, breath: 12 }]);
  assert.equal(r.label, 'settled'); assert.equal(r.pulseDelta, -6);
  assert.equal(L.computeReadiness([], []).enough, false);
  assert.ok(!('stress' in r) && !('diagnosis' in r));
});
test('history store: add, export, delete, clear', () => {
  const mem = {}; const st = L.makeStore({ getItem: (k) => mem[k] ?? null, setItem: (k, v) => (mem[k] = v), removeItem: (k) => delete mem[k] });
  st.add({ id: 'a' }); st.add({ id: 'b' });
  assert.equal(st.list().length, 2);
  assert.equal(JSON.parse(st.exportOne('a')).id, 'a');
  st.remove('a'); assert.deepEqual(st.list().map((s) => s.id), ['b']);
  st.clear(); assert.equal(st.list().length, 0);
});
test('all languages have the same keys', () => {
  const keys = Object.keys(T.hn).sort();
  for (const l of ['hi', 'gu']) assert.deepEqual(Object.keys(T[l]).sort(), keys);
});
