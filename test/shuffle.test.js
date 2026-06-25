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
  assert.deepStrictEqual([...out].sort((a, b) => a - b), [1, 2, 3, 4]);
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

test('prepareQuestions con shuffleQuestions reordena las preguntas sin mutarlas', () => {
  const q1 = { text: 'q1', options: ['a', 'b', 'c', 'd'], correct: 0, time: 15 };
  const q2 = { text: 'q2', options: ['e', 'f', 'g', 'h'], correct: 2, time: 15 };
  const q3 = { text: 'q3', options: ['i', 'j', 'k', 'l'], correct: 1, time: 15 };
  const game = {
    shuffleQuestions: true,
    shuffleAnswers: false,
    questions: [q1, q2, q3],
  };
  // fakeRng([0.9, 0.1]): Fisher-Yates sobre 3 elem →
  //   i=2: j=floor(0.9*3)=2 (sin cambio)
  //   i=1: j=floor(0.1*2)=0 → intercambia índices 0 y 1
  // resultado: [q2, q1, q3]
  const out = prepareQuestions(game, fakeRng([0.9, 0.1]));

  // mismas preguntas (multiconjunto de text)
  const inTexts  = game.questions.map((q) => q.text).sort();
  const outTexts = out.map((q) => q.text).sort();
  assert.deepStrictEqual(outTexts, inTexts);

  // el orden realmente cambió
  assert.notDeepStrictEqual(
    out.map((q) => q.text),
    game.questions.map((q) => q.text)
  );

  // el arreglo original no fue mutado
  assert.deepStrictEqual(game.questions, [q1, q2, q3]);
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
