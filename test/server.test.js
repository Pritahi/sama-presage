const test = require('node:test');
const assert = require('node:assert');
const { summarize } = require('../server.js');
test('summarize picks latest pulse and breathing samples', () => {
  const s = summarize({ cardio: { pulseRate: [{ value: 60, confidence: 0.5, stable: false }, { value: 71, confidence: 0.9, stable: true }] }, breathing: { rate: [{ value: 13, confidence: 0.8 }], upperTrace: [{ value: 1 }, { value: 2 }] } });
  assert.equal(s.pulse.value, 71); assert.equal(s.breath.value, 13); assert.deepEqual(s.trace, [1, 2]);
  assert.equal(summarize({}).pulse, null);
  const q = summarize({ cardio: { pulseRate: [{ value: 80, confidence: 75, stable: true }] }, breathing: { rate: [{ value: 9 }] } });
  assert.equal(q.pulse.confidence, 0.75); assert.equal(q.breath.confidence, null);
});
