const test = require('node:test');
const assert = require('node:assert');
const { shuffleArray, shuffleAnswers, prepareQuestions } = require('../lib/shuffle');

// rng determinista que recorre una lista de valores [0,1)
function fakeRng(values) {
  let i = 0;
  return () => values[i++ % values.length];
}

test('shuffleArray no muta el original y conserva los mismos elementos', () => {
  const orig = [1, 2, 3, 4];
  const out = shuffleArray(orig, fakeRng([0.9, 0.1, 0.5]));
  assert.deepStrictEqual(orig, [1, 2, 3, 4]);
  assert.deepStrictEqual([...out].sort(), [1, 2, 3, 4]);
  assert.strictEqual(out.length, 4);
});

test('shuffleAnswers mantiene la opción correcta apuntada por correct', () => {
  const q = { text: 'q', options: ['A', 'B', 'C', 'D'], correct: 1, time: 15 };
  for (let i = 0; i < 50; i++) {
    const out = shuffleAnswers(q);
    assert.strictEqual(out.options[out.correct], 'B');
    assert.deepStrictEqual([...out.options].sort(), ['A', 'B', 'C', 'D']);
    assert.deepStrictEqual(q.options, ['A', 'B', 'C', 'D']); // no muta
  }
});

test('prepareQuestions sin banderas devuelve copia equivalente', () => {
  const game = {
    shuffleQuestions: false,
    shuffleAnswers: false,
    questions: [
      { text: 'q1', options: ['a', 'b', 'c', 'd'], correct: 0, time: 15 },
      { text: 'q2', options: ['e', 'f', 'g', 'h'], correct: 2, time: 15 },
    ],
  };
  const out = prepareQuestions(game);
  assert.deepStrictEqual(out, game.questions);
  assert.notStrictEqual(out, game.questions); // copia distinta
});

test('prepareQuestions con shuffleAnswers conserva la correcta de cada pregunta', () => {
  const game = {
    shuffleQuestions: false,
    shuffleAnswers: true,
    questions: [
      { text: 'q1', options: ['a', 'b', 'c', 'd'], correct: 0, time: 15 },
      { text: 'q2', options: ['e', 'f', 'g', 'h'], correct: 2, time: 15 },
    ],
  };
  const out = prepareQuestions(game);
  assert.strictEqual(out[0].options[out[0].correct], 'a');
  assert.strictEqual(out[1].options[out[1].correct], 'g');
});
