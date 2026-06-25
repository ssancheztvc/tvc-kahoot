const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildResult, resultFilename, writeResult } = require('../lib/results');

const when = new Date('2026-06-24T14:30:00.000Z');

test('buildResult arma la forma esperada', () => {
  const r = buildResult({
    gameId: 'vipday', title: 'VIP Day', playedAt: when,
    leaderboard: [{ name: 'Ana', score: 100 }],
    questions: [{ index: 0, text: 'q', correctAnswer: 1, answers: [{ name: 'Ana', answer: 1, correct: true, timeLeft: 9, points: 100 }] }],
  });
  assert.strictEqual(r.game, 'vipday');
  assert.strictEqual(r.title, 'VIP Day');
  assert.strictEqual(r.playedAt, when.toISOString());
  assert.strictEqual(r.leaderboard[0].name, 'Ana');
  assert.strictEqual(r.questions[0].answers[0].correct, true);
});

test('resultFilename usa fecha local legible', () => {
  const name = resultFilename('vipday', when);
  assert.match(name, /^\d{4}-\d{2}-\d{2}_vipday_\d{4}\.json$/);
});

test('writeResult escribe el archivo en results dir', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kahoot-res-'));
  const r = buildResult({ gameId: 'g', title: 'G', playedAt: when, leaderboard: [], questions: [] });
  const out = writeResult(dir, r);
  assert.ok(fs.existsSync(out));
  const parsed = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.strictEqual(parsed.game, 'g');
});
