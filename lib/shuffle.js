'use strict';

// Fisher-Yates. Devuelve un arreglo nuevo; no muta la entrada.
function shuffleArray(arr, rng = Math.random) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Baraja las opciones y remapea `correct` a la nueva posición.
function shuffleAnswers(question, rng = Math.random) {
  const correctValue = question.options[question.correct];
  const options = shuffleArray(question.options, rng);
  const correct = options.indexOf(correctValue);
  return { ...question, options, correct };
}

// Prepara las preguntas para una partida según las banderas del juego.
function prepareQuestions(game, rng = Math.random) {
  let qs = game.questions.map((q) => ({ ...q, options: q.options.slice() }));
  if (game.shuffleQuestions) qs = shuffleArray(qs, rng);
  if (game.shuffleAnswers) qs = qs.map((q) => shuffleAnswers(q, rng));
  return qs;
}

module.exports = { shuffleArray, shuffleAnswers, prepareQuestions };
