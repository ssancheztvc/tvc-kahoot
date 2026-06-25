const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createGameStore } = require('../lib/games');

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'kahoot-games-'));
}
const Q = (text, correct = 0) => ({
  text, options: ['a', 'b', 'c', 'd'], correct, time: 15, explanation: '',
});

test('createGame + getGame + listGames', () => {
  const store = createGameStore(tmpRoot());
  store.createGame('vipday', 'VIP Day');
  const g = store.getGame('vipday');
  assert.strictEqual(g.title, 'VIP Day');
  assert.deepStrictEqual(g.questions, []);
  assert.strictEqual(g.shuffleQuestions, false);
  const list = store.listGames();
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].id, 'vipday');
  // Amendment: listGames must include shuffle flags
  assert.strictEqual(list[0].shuffleQuestions, false);
  assert.strictEqual(list[0].shuffleAnswers, false);
});

test('createGame rechaza id inválido y duplicados', () => {
  const store = createGameStore(tmpRoot());
  assert.throws(() => store.createGame('VIP Day', 'x'));      // mayúsculas/espacios
  assert.throws(() => store.createGame('../hack', 'x'));       // traversal
  store.createGame('ok', 'Ok');
  assert.throws(() => store.createGame('ok', 'Otra vez'));     // duplicado
});

test('active id se persiste', () => {
  const store = createGameStore(tmpRoot());
  store.createGame('a', 'A');
  assert.strictEqual(store.getActiveId(), null);
  store.setActiveId('a');
  assert.strictEqual(store.getActiveId(), 'a');
});

test('CRUD de preguntas', () => {
  const store = createGameStore(tmpRoot());
  store.createGame('g', 'G');
  store.addQuestion('g', Q('q1'));
  store.addQuestion('g', Q('q2'));
  assert.strictEqual(store.getGame('g').questions.length, 2);
  store.updateQuestion('g', 0, Q('q1-edit', 2));
  assert.strictEqual(store.getGame('g').questions[0].text, 'q1-edit');
  store.reorderQuestions('g', 0, 1);
  assert.strictEqual(store.getGame('g').questions[0].text, 'q2');
  store.deleteQuestion('g', 0);
  assert.strictEqual(store.getGame('g').questions.length, 1);
});

test('updateGameMeta cambia título y banderas, conserva preguntas', () => {
  const store = createGameStore(tmpRoot());
  store.createGame('g', 'G');
  store.addQuestion('g', Q('q1'));
  store.updateGameMeta('g', { title: 'Nuevo', shuffleQuestions: true, shuffleAnswers: true });
  const g = store.getGame('g');
  assert.strictEqual(g.title, 'Nuevo');
  assert.strictEqual(g.shuffleQuestions, true);
  assert.strictEqual(g.questions.length, 1);
});

test('deleteGame elimina el juego y gameExists retorna false', () => {
  const store = createGameStore(tmpRoot());
  store.createGame('temp', 'Temporal');
  assert.strictEqual(store.listGames().length, 1);
  store.deleteGame('temp');
  assert.strictEqual(store.listGames().length, 0);
  assert.strictEqual(store.gameExists('temp'), false);
});

test('theme se persiste y sobrevive a editar preguntas', () => {
  const store = createGameStore(tmpRoot());
  store.createGame('g', 'G');
  store.updateGameMeta('g', { theme: 'futbol' });
  assert.strictEqual(store.getGame('g').theme, 'futbol');
  assert.strictEqual(store.listGames()[0].theme, 'futbol');
  // editar preguntas NO debe borrar el theme
  store.addQuestion('g', Q('q1'));
  assert.strictEqual(store.getGame('g').theme, 'futbol');
  // juego sin theme reporta cadena vacía
  store.createGame('base', 'Base');
  assert.strictEqual(store.getGame('base').theme, '');
});

test('migrateLegacy crea juego inicial solo si no hay juegos', () => {
  const root = tmpRoot();
  const store = createGameStore(root);
  store.migrateLegacy([Q('legacy')], { id: 'vipday', title: 'VIP Day' });
  assert.strictEqual(store.getActiveId(), 'vipday');
  assert.strictEqual(store.getGame('vipday').questions.length, 1);
  // segunda llamada no duplica ni pisa
  store.migrateLegacy([Q('otra')], { id: 'vipday', title: 'X' });
  assert.strictEqual(store.getGame('vipday').questions.length, 1);
});
