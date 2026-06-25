'use strict';
const fs = require('fs');
const path = require('path');

const ID_RE = /^[a-z0-9-]+$/;

function createGameStore(rootDir) {
  const gamesDir = path.join(rootDir, 'games');
  const configPath = path.join(rootDir, 'config.json');

  function ensureDir() {
    if (!fs.existsSync(gamesDir)) fs.mkdirSync(gamesDir, { recursive: true });
  }
  function gameFile(id) {
    if (!ID_RE.test(id)) throw new Error(`id de juego inválido: ${id}`);
    return path.join(gamesDir, `${id}.json`);
  }
  function gameExists(id) {
    return ID_RE.test(id) && fs.existsSync(path.join(gamesDir, id + '.json'));
  }
  function readGame(id) {
    const raw = JSON.parse(fs.readFileSync(gameFile(id), 'utf8'));
    return {
      id,
      title: raw.title || id,
      shuffleQuestions: !!raw.shuffleQuestions,
      shuffleAnswers: !!raw.shuffleAnswers,
      questions: Array.isArray(raw.questions) ? raw.questions : [],
    };
  }
  function writeGame(id, game) {
    ensureDir();
    const { title, shuffleQuestions, shuffleAnswers, questions } = game;
    fs.writeFileSync(
      gameFile(id),
      JSON.stringify({ title, shuffleQuestions, shuffleAnswers, questions }, null, 2),
      'utf8'
    );
  }

  function listGames() {
    ensureDir();
    const active = getActiveId();
    return fs.readdirSync(gamesDir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.slice(0, -5))
      .sort()
      .map((id) => {
        const g = readGame(id);
        return {
          id,
          title: g.title,
          active: id === active,
          shuffleQuestions: g.shuffleQuestions,
          shuffleAnswers: g.shuffleAnswers,
        };
      });
  }
  function getGame(id) {
    if (!gameExists(id)) throw new Error(`juego no encontrado: ${id}`);
    return readGame(id);
  }
  function createGame(id, title) {
    if (!ID_RE.test(id)) throw new Error(`id inválido: ${id}`);
    if (fs.existsSync(gameFile(id))) throw new Error(`ya existe: ${id}`);
    writeGame(id, { title: title || id, shuffleQuestions: false, shuffleAnswers: false, questions: [] });
  }
  function updateGameMeta(id, meta) {
    const g = getGame(id);
    if (meta.title != null) g.title = meta.title;
    if (meta.shuffleQuestions != null) g.shuffleQuestions = !!meta.shuffleQuestions;
    if (meta.shuffleAnswers != null) g.shuffleAnswers = !!meta.shuffleAnswers;
    writeGame(id, g);
  }
  function deleteGame(id) {
    if (gameExists(id)) fs.unlinkSync(gameFile(id));
  }
  function getActiveId() {
    if (!fs.existsSync(configPath)) return null;
    try { return JSON.parse(fs.readFileSync(configPath, 'utf8')).activeGame || null; }
    catch { return null; }
  }
  function setActiveId(id) {
    fs.writeFileSync(configPath, JSON.stringify({ activeGame: id }, null, 2), 'utf8');
  }

  function addQuestion(id, q) {
    const g = getGame(id); g.questions.push(q); writeGame(id, g);
    return g.questions.length - 1;
  }
  function updateQuestion(id, i, q) {
    const g = getGame(id);
    if (i < 0 || i >= g.questions.length) throw new Error('índice fuera de rango');
    g.questions[i] = q; writeGame(id, g);
  }
  function deleteQuestion(id, i) {
    const g = getGame(id);
    if (i < 0 || i >= g.questions.length) throw new Error('índice fuera de rango');
    g.questions.splice(i, 1); writeGame(id, g);
  }
  function reorderQuestions(id, from, to) {
    const g = getGame(id); const n = g.questions.length;
    if (from < 0 || from >= n || to < 0 || to >= n) throw new Error('índices inválidos');
    const [item] = g.questions.splice(from, 1);
    g.questions.splice(to, 0, item); writeGame(id, g);
  }

  function migrateLegacy(legacyQuestions, { id, title }) {
    if (!ID_RE.test(id)) throw new Error('id inválido: ' + id);
    ensureDir();
    if (listGames().length > 0) return false;
    writeGame(id, { title, shuffleQuestions: false, shuffleAnswers: false, questions: legacyQuestions });
    setActiveId(id);
    return true;
  }

  return {
    listGames, getGame, gameExists, createGame, updateGameMeta, deleteGame,
    getActiveId, setActiveId,
    addQuestion, updateQuestion, deleteQuestion, reorderQuestions, migrateLegacy,
  };
}

module.exports = { createGameStore, ID_RE };
