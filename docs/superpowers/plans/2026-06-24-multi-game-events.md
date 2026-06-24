# Múltiples juegos por evento — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convertir el quiz de un único `questions.json` a múltiples juegos por evento (uno activo a la vez), con barajado opcional de preguntas/respuestas, ranking entre preguntas en el Host, y guardado privado de resultados por partida.

**Architecture:** Se extrae la lógica pura de `server.js` a módulos en `lib/` (`games.js`, `shuffle.js`, `results.js`) testeables con el runner integrado de Node. `server.js` consume esos módulos. Los juegos viven en `games/<id>.json`, el activo en `config.json`, y los resultados (no versionados) en `results/`.

**Tech Stack:** Node 20, Express 4, Socket.IO 4, runner de pruebas integrado `node:test` + `node:assert` (sin dependencias nuevas), `fs`/`path`.

## Global Constraints

- **Node ≥ 18** (se usa `node:test`). El server actual corre en Node 20.
- **Sin dependencias nuevas** salvo que sea imprescindible (no lo es).
- **Una partida viva a la vez** — un solo `gameState`. No soportar eventos simultáneos.
- **Privacidad:** `results/*.json` NUNCA se versiona en git. Solo `results/.gitkeep`.
- **Fuente de la verdad:** GitHub. `/admin` puede editar en vivo pero esos cambios deben volver al repo.
- **Seguridad:** todas las rutas `/api/*` de admin siguen protegidas por `requireAdmin` (PIN). Arrancar con `HOST_PIN` definido.
- **Formato de pregunta:** `{ text, options[4], correct (0-3), time (5-120), explanation }`. `correct` apunta a la opción correcta **tal como está escrita en el archivo**.
- **Sanitización:** texto de preguntas/opciones se limpia con la `sanitizeText` existente (quita `< >`).

---

## File Structure

- Create: `lib/shuffle.js` — barajado de arreglos y de respuestas con remapeo de `correct`.
- Create: `lib/games.js` — store de juegos sobre el filesystem (listar, CRUD, activo, preguntas, migración).
- Create: `lib/results.js` — construir y escribir el JSON de resultados.
- Create: `test/shuffle.test.js`, `test/games.test.js`, `test/results.test.js`.
- Create: `games/temporada-campeones.json` — las 5 preguntas de Securithor.
- Create: `config.json` — `{ "activeGame": "vipday" }`.
- Create: `results/.gitkeep`.
- Create: `README.md` — workflow para Claude Code.
- Create: `scripts/verify-game-flow.js` — cliente socket.io para verificar el flujo en vivo.
- Modify: `server.js` — consumir `lib/`, cargar juego activo, barajar al iniciar, API de juegos, historial y escritura de resultados.
- Modify: `views/admin.html` — selector de juegos + CRUD + toggles de shuffle.
- Modify: `public/host.html` — mostrar leaderboard entre preguntas.
- Modify: `package.json` — script `"test": "node --test"`.
- Modify: `.gitignore` — excluir `results/*.json`.
- Migración en arranque crea `games/vipday.json` desde `questions.json` (no se borra el legacy).

---

### Task 1: Módulo de barajado (`lib/shuffle.js`)

**Files:**
- Create: `lib/shuffle.js`
- Test: `test/shuffle.test.js`
- Modify: `package.json` (script de test)

**Interfaces:**
- Produces:
  - `shuffleArray(arr, rng = Math.random)` → nuevo arreglo barajado (Fisher-Yates), no muta el original.
  - `shuffleAnswers(question, rng = Math.random)` → nueva pregunta `{ ...question, options, correct }` con `options` barajadas y `correct` remapeado a la nueva posición de la opción correcta.
  - `prepareQuestions(game, rng = Math.random)` → arreglo de preguntas listo para jugar: aplica `shuffleArray` a las preguntas si `game.shuffleQuestions`, y `shuffleAnswers` a cada una si `game.shuffleAnswers`. No muta `game`.

- [ ] **Step 1: Añadir script de test a `package.json`**

En `package.json`, dentro de `"scripts"`, dejarlo así:

```json
  "scripts": {
    "start": "node server.js",
    "test": "node --test"
  },
```

- [ ] **Step 2: Escribir el test que falla**

Create `test/shuffle.test.js`:

```js
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
```

- [ ] **Step 3: Correr el test para verque falla**

Run: `npm test`
Expected: FAIL — `Cannot find module '../lib/shuffle'`.

- [ ] **Step 4: Implementar `lib/shuffle.js`**

Create `lib/shuffle.js`:

```js
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
```

- [ ] **Step 5: Correr el test para verificar que pasa**

Run: `npm test`
Expected: PASS — los 4 tests de shuffle en verde.

- [ ] **Step 6: Commit**

```bash
git add package.json lib/shuffle.js test/shuffle.test.js
git commit -m "feat: módulo de barajado de preguntas/respuestas con remapeo de correct"
```

---

### Task 2: Store de juegos (`lib/games.js`)

**Files:**
- Create: `lib/games.js`
- Test: `test/games.test.js`

**Interfaces:**
- Consumes: `sanitizeText` se queda en `server.js`; el store recibe datos ya limpios. La validación de forma (4 opciones, etc.) vive en `server.js` (igual que hoy con `cleanQuestion`).
- Produces: `createGameStore(rootDir)` → objeto con métodos:
  - `listGames()` → `[{ id, title, active }]` (ordenados por id).
  - `getGame(id)` → `{ id, title, shuffleQuestions, shuffleAnswers, questions }` o lanza `Error` si no existe.
  - `gameExists(id)` → boolean.
  - `createGame(id, title)` → crea `games/<id>.json` vacío `{ title, shuffleQuestions:false, shuffleAnswers:false, questions:[] }`; lanza si ya existe o id inválido.
  - `updateGameMeta(id, { title, shuffleQuestions, shuffleAnswers })` → actualiza solo metadatos.
  - `deleteGame(id)` → borra el archivo.
  - `getActiveId()` → string del `config.json` (o `null`).
  - `setActiveId(id)` → escribe `config.json`.
  - `addQuestion(id, q)`, `updateQuestion(id, i, q)`, `deleteQuestion(id, i)`, `reorderQuestions(id, from, to)` → operan sobre `questions` del juego.
  - `migrateLegacy(legacyQuestions, { id, title })` → si no hay juegos, crea `games/<id>.json` con esas preguntas y lo deja activo. No hace nada si ya hay juegos.
- `id` válido: `^[a-z0-9-]+$` (kebab). Esto evita path traversal.

- [ ] **Step 1: Escribir el test que falla**

Create `test/games.test.js`:

```js
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
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `npm test`
Expected: FAIL — `Cannot find module '../lib/games'`.

- [ ] **Step 3: Implementar `lib/games.js`**

Create `lib/games.js`:

```js
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
    return ID_RE.test(id) && fs.existsSync(gameFile(id));
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
      .map((id) => ({ id, title: readGame(id).title, active: id === active }));
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
```

- [ ] **Step 4: Correr el test para verificar que pasa**

Run: `npm test`
Expected: PASS — todos los tests de games en verde.

- [ ] **Step 5: Commit**

```bash
git add lib/games.js test/games.test.js
git commit -m "feat: store de juegos sobre filesystem (CRUD, activo, migración)"
```

---

### Task 3: Resultados (`lib/results.js`)

**Files:**
- Create: `lib/results.js`
- Test: `test/results.test.js`

**Interfaces:**
- Produces:
  - `buildResult({ gameId, title, playedAt, leaderboard, questions })` → objeto de resultado serializable. `playedAt` es un `Date`. `questions` es el arreglo de detalle por pregunta `[{ index, text, correctAnswer, answers: [{ name, answer, correct, timeLeft, points }] }]`.
  - `resultFilename(gameId, playedAt)` → `YYYY-MM-DD_<gameId>_HHMM.json`.
  - `writeResult(resultsDir, result)` → escribe el archivo (crea el dir si falta) usando `result.game` y `result.playedAt`; devuelve la ruta escrita.

- [ ] **Step 1: Escribir el test que falla**

Create `test/results.test.js`:

```js
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
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `npm test`
Expected: FAIL — `Cannot find module '../lib/results'`.

- [ ] **Step 3: Implementar `lib/results.js`**

Create `lib/results.js`:

```js
'use strict';
const fs = require('fs');
const path = require('path');

function pad(n) { return String(n).padStart(2, '0'); }

function buildResult({ gameId, title, playedAt, leaderboard, questions }) {
  return {
    game: gameId,
    title,
    playedAt: playedAt.toISOString(),
    leaderboard,
    questions,
  };
}

function resultFilename(gameId, playedAt) {
  const d = playedAt;
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const hm = `${pad(d.getHours())}${pad(d.getMinutes())}`;
  return `${date}_${gameId}_${hm}.json`;
}

function writeResult(resultsDir, result) {
  if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true });
  const playedAt = new Date(result.playedAt);
  const file = path.join(resultsDir, resultFilename(result.game, playedAt));
  fs.writeFileSync(file, JSON.stringify(result, null, 2), 'utf8');
  return file;
}

module.exports = { buildResult, resultFilename, writeResult };
```

- [ ] **Step 4: Correr el test para verificar que pasa**

Run: `npm test`
Expected: PASS — todos los tests en verde.

- [ ] **Step 5: Commit**

```bash
git add lib/results.js test/results.test.js
git commit -m "feat: construcción y escritura de resultados por partida"
```

---

### Task 4: Contenido inicial, config y .gitignore

**Files:**
- Create: `games/temporada-campeones.json`
- Create: `config.json`
- Create: `results/.gitkeep`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: formato de juego de Task 2.
- Nota: `games/vipday.json` lo crea la migración en arranque (Task 5), no se versiona a mano para no duplicar la fuente; pero si se prefiere versionarlo, puede generarse y commitear. Aquí solo creamos el contenido nuevo (Securithor) y la config.

- [ ] **Step 1: Crear `games/temporada-campeones.json`**

Las 5 preguntas de Securithor. La opción correcta está movida de posición (no siempre en A) y `correct` apunta a ella.

```json
{
  "title": "Temporada de Campeones 2026",
  "shuffleQuestions": true,
  "shuffleAnswers": true,
  "questions": [
    {
      "text": "¿Qué ventaja ofrece integrar paneles DSC con Securithor?",
      "options": [
        "Procesamiento manual de eventos",
        "Recepción, proceso y respuesta ante las señales de los paneles",
        "Reinicio diario del panel",
        "Revisión local de los paneles"
      ],
      "correct": 1,
      "time": 15,
      "explanation": ""
    },
    {
      "text": "¿Cómo reciben notificaciones los usuarios finales en Securithor?",
      "options": [
        "Correos certificados únicamente",
        "Reporte impreso únicamente",
        "Notificaciones Push, entre otros",
        "Llamada programada automáticamente"
      ],
      "correct": 2,
      "time": 15,
      "explanation": ""
    },
    {
      "text": "¿Qué permite la videoverificación en Securithor?",
      "options": [
        "Video asociado al evento",
        "Grabación sin eventos",
        "Solo video en vivo",
        "Respaldo de video únicamente"
      ],
      "correct": 0,
      "time": 15,
      "explanation": ""
    },
    {
      "text": "¿Para qué sirve WebOperator?",
      "options": [
        "Programar paneles",
        "Reemplazar el servidor",
        "Operar receptoras",
        "Acceso web a cuentas"
      ],
      "correct": 3,
      "time": 15,
      "explanation": ""
    },
    {
      "text": "¿Cuál es un beneficio de Securithor?",
      "options": [
        "Menos eventos recibidos",
        "Mayor eficiencia operativa",
        "Eliminar operadores",
        "Sustituir procedimientos"
      ],
      "correct": 1,
      "time": 15,
      "explanation": ""
    }
  ]
}
```

- [ ] **Step 2: Crear `config.json`**

```json
{
  "activeGame": "vipday"
}
```

- [ ] **Step 3: Crear `results/.gitkeep`**

Archivo vacío para que la carpeta exista en el repo.

Run: `mkdir -p results && touch results/.gitkeep`

- [ ] **Step 4: Actualizar `.gitignore`**

Añadir al final de `.gitignore`:

```gitignore
# Resultados de partidas: contienen nombres de participantes — NO versionar
results/*.json
```

- [ ] **Step 5: Verificar que git ignora los resultados pero no el .gitkeep**

Run: `touch results/prueba.json && git status --porcelain results/`
Expected: aparece `results/.gitkeep` como nuevo (o ya trackeado) y NO aparece `results/prueba.json`.
Luego: `rm results/prueba.json`

- [ ] **Step 6: Commit**

```bash
git add games/temporada-campeones.json config.json results/.gitkeep .gitignore
git commit -m "feat: contenido temporada-campeones, config de juego activo y privacidad de results"
```

---

### Task 5: Integrar `lib/` en `server.js`

**Files:**
- Modify: `server.js`

**Interfaces:**
- Consumes: `createGameStore` (Task 2), `prepareQuestions` (Task 1), `buildResult`/`writeResult` (Task 3).
- Produces: el `gameState` ahora tiene `gameId`, `title`, `runtimeQuestions` (preguntas barajadas de la partida) e `history` (detalle por pregunta para resultados). Eventos socket existentes sin cambios de nombre.

**Cambios concretos (orden de arriba a abajo en `server.js`):**

- [ ] **Step 1: Requerir los módulos y crear el store**

Reemplazar el bloque de carga de preguntas (`server.js:37-42`, las líneas de `let questions = ...` y `saveQuestions`) por:

```js
const { createGameStore } = require('./lib/games');
const { prepareQuestions } = require('./lib/shuffle');
const { buildResult, writeResult } = require('./lib/results');

const store = createGameStore(__dirname);
const RESULTS_DIR = path.join(__dirname, 'results');

// Migración: si no hay juegos aún, crea games/vipday.json desde el questions.json legacy.
(function migrateIfNeeded() {
  const legacyPath = path.join(__dirname, 'questions.json');
  if (store.listGames().length === 0 && fs.existsSync(legacyPath)) {
    const legacy = JSON.parse(fs.readFileSync(legacyPath, 'utf8'));
    store.migrateLegacy(legacy, { id: 'vipday', title: 'VIP Day' });
    console.log('🗂️  Migrado questions.json → games/vipday.json (activo)');
  }
})();

// Devuelve el juego activo (o uno vacío seguro si algo falla).
function activeGame() {
  const id = store.getActiveId();
  try { return store.getGame(id); }
  catch (e) {
    console.error('No se pudo cargar el juego activo:', e.message);
    return { id: id || null, title: 'Sin juego', shuffleQuestions: false, shuffleAnswers: false, questions: [] };
  }
}
```

- [ ] **Step 2: Ampliar `gameState` con campos de partida**

En la definición de `gameState` (`server.js:45-52`) añadir los campos:

```js
let gameState = {
  status: 'waiting',
  players: {},
  currentQuestion: -1,
  questionTimer: null,
  answers: {},
  timeLeft: 0,
  gameId: null,
  title: '',
  runtimeQuestions: [],
  history: [],
};
```

- [ ] **Step 3: Reemplazar la API de preguntas global por API parametrizada por juego**

Eliminar las rutas actuales `GET/POST/PUT/DELETE /api/questions*` y `cleanQuestion` global no — `cleanQuestion` se reutiliza. Sustituir el bloque `// ── ADMIN API ──` (`server.js:86-139`) por:

```js
// ── ADMIN API ──
// Normaliza y limpia una pregunta antes de guardarla
function cleanQuestion(body) {
  if (!body || !body.text || !Array.isArray(body.options) || body.options.length !== 4) return null;
  return {
    text: sanitizeText(body.text),
    options: body.options.map(sanitizeText),
    correct: Math.min(3, Math.max(0, parseInt(body.correct) || 0)),
    time: Math.min(120, Math.max(5, parseInt(body.time) || 20)),
    explanation: sanitizeText(body.explanation || ''),
  };
}

// Juegos
app.get('/api/games', (req, res) => res.json(store.listGames()));

app.post('/api/games', (req, res) => {
  const id = sanitizeText(req.body.id || '').trim();
  const title = sanitizeText(req.body.title || '').trim();
  if (!/^[a-z0-9-]+$/.test(id)) return res.status(400).json({ error: 'id inválido (usa minúsculas, números y guiones)' });
  if (store.gameExists(id)) return res.status(409).json({ error: 'Ya existe un juego con ese id' });
  store.createGame(id, title || id);
  res.json({ ok: true, id });
});

app.put('/api/games/:id', (req, res) => {
  if (!store.gameExists(req.params.id)) return res.status(404).json({ error: 'No encontrado' });
  store.updateGameMeta(req.params.id, {
    title: req.body.title != null ? sanitizeText(req.body.title) : undefined,
    shuffleQuestions: req.body.shuffleQuestions,
    shuffleAnswers: req.body.shuffleAnswers,
  });
  res.json({ ok: true });
});

app.delete('/api/games/:id', (req, res) => {
  if (!store.gameExists(req.params.id)) return res.status(404).json({ error: 'No encontrado' });
  if (store.getActiveId() === req.params.id) return res.status(400).json({ error: 'No puedes borrar el juego activo' });
  store.deleteGame(req.params.id);
  res.json({ ok: true });
});

app.post('/api/games/:id/activate', (req, res) => {
  if (!store.gameExists(req.params.id)) return res.status(404).json({ error: 'No encontrado' });
  if (gameState.status !== 'waiting' && gameState.status !== 'gameover') {
    return res.status(409).json({ error: 'Hay una partida en curso' });
  }
  store.setActiveId(req.params.id);
  res.json({ ok: true });
});

// Preguntas de un juego
app.get('/api/games/:id/questions', (req, res) => {
  if (!store.gameExists(req.params.id)) return res.status(404).json({ error: 'No encontrado' });
  res.json(store.getGame(req.params.id).questions);
});

app.post('/api/games/:id/questions', (req, res) => {
  if (!store.gameExists(req.params.id)) return res.status(404).json({ error: 'No encontrado' });
  const q = cleanQuestion(req.body);
  if (!q) return res.status(400).json({ error: 'Pregunta inválida' });
  const index = store.addQuestion(req.params.id, q);
  res.json({ ok: true, index });
});

app.put('/api/games/:id/questions/:i', (req, res) => {
  if (!store.gameExists(req.params.id)) return res.status(404).json({ error: 'No encontrado' });
  const q = cleanQuestion(req.body);
  if (!q) return res.status(400).json({ error: 'Pregunta inválida' });
  try { store.updateQuestion(req.params.id, parseInt(req.params.i), q); }
  catch { return res.status(404).json({ error: 'Índice inválido' }); }
  res.json({ ok: true });
});

app.delete('/api/games/:id/questions/:i', (req, res) => {
  if (!store.gameExists(req.params.id)) return res.status(404).json({ error: 'No encontrado' });
  try { store.deleteQuestion(req.params.id, parseInt(req.params.i)); }
  catch { return res.status(404).json({ error: 'Índice inválido' }); }
  res.json({ ok: true });
});

app.post('/api/games/:id/questions/reorder', (req, res) => {
  if (!store.gameExists(req.params.id)) return res.status(404).json({ error: 'No encontrado' });
  try { store.reorderQuestions(req.params.id, parseInt(req.body.from), parseInt(req.body.to)); }
  catch { return res.status(400).json({ error: 'Índices inválidos' }); }
  res.json({ ok: true });
});
```

También actualizar el candado de rutas (`server.js:67-73`) para que proteja `/api/games`:

```js
app.use((req, res, next) => {
  const p = req.path;
  if (p === '/admin' || p === '/admin.html' || p.startsWith('/api/questions') || p.startsWith('/api/games')) {
    return requireAdmin(req, res, next);
  }
  next();
});
```

- [ ] **Step 4: Usar `runtimeQuestions` en toda la lógica de partida**

En `endQuestion()` y `sendNextQuestion()` (`server.js:156-208` y `344-383`), reemplazar cada acceso a `questions[...]` y `questions.length` por `gameState.runtimeQuestions[...]` y `gameState.runtimeQuestions.length`. En `start-game` (`server.js:228-247`) cargar y preparar el juego activo antes del countdown:

```js
socket.on('start-game', () => {
  if (!authenticatedHosts.has(socket.id)) return;
  if (gameState.status !== 'waiting') return;
  const game = activeGame();
  if (!game.questions.length) {
    socket.emit('host-error', 'El juego activo no tiene preguntas.');
    return;
  }
  gameState.gameId = game.id;
  gameState.title = game.title;
  gameState.runtimeQuestions = prepareQuestions(game);
  gameState.history = [];
  gameState.currentQuestion = -1;
  gameState.status = 'countdown';
  io.emit('game-started', { total: gameState.runtimeQuestions.length });
  let count = 5;
  io.emit('countdown', { count });
  const countTimer = setInterval(() => {
    count--;
    if (count > 0) { io.emit('countdown', { count }); }
    else {
      clearInterval(countTimer);
      io.emit('countdown', { count: 0 });
      setTimeout(() => sendNextQuestion(), 800);
    }
  }, 1000);
});
```

Y en `join-host`, mandar `total` desde el juego activo:

```js
socket.emit('game-state', {
  status: gameState.status,
  playerCount: Object.keys(gameState.players).length,
  players: Object.values(gameState.players).map(p => p.name),
  total: activeGame().questions.length,
});
```

- [ ] **Step 5: Registrar historial en `endQuestion()` para los resultados**

Dentro de `endQuestion()`, después de calcular `answerCounts`/`correctCount` y antes de `gameState.status = 'reveal'`, acumular el detalle de la pregunta:

```js
  const detail = [];
  for (const [socketId, player] of Object.entries(gameState.players)) {
    const a = gameState.answers[socketId];
    detail.push({
      name: player.name,
      answer: a ? a.answer : null,
      correct: a ? a.answer === correctAnswer : false,
      timeLeft: a ? a.timeLeft : 0,
      points: a && a.answer === correctAnswer ? calcScore(a.timeLeft, maxTime) : 0,
    });
  }
  gameState.history.push({
    index: gameState.currentQuestion,
    text: q.text,
    correctAnswer,
    answers: detail,
  });
```

(Nota: `q` y `correctAnswer` ya existen al inicio de `endQuestion`; `maxTime` también.)

- [ ] **Step 6: Escribir resultados al llegar a `gameover`**

En `sendNextQuestion()`, en la rama de fin de juego (`server.js:346-350`), antes de emitir `game-over`:

```js
  if (gameState.currentQuestion >= gameState.runtimeQuestions.length) {
    gameState.status = 'gameover';
    try {
      const result = buildResult({
        gameId: gameState.gameId,
        title: gameState.title,
        playedAt: new Date(),
        leaderboard: getLeaderboard(),
        questions: gameState.history,
      });
      const file = writeResult(RESULTS_DIR, result);
      console.log('📝 Resultados guardados en', file);
    } catch (e) {
      console.error('No se pudieron guardar los resultados:', e.message);
    }
    io.emit('game-over', { leaderboard: getLeaderboard() });
    return;
  }
```

- [ ] **Step 7: Verificar que los tests siguen verdes**

Run: `npm test`
Expected: PASS — los tests de `lib/` no se rompen (no dependen de `server.js`).

- [ ] **Step 8: Verificar arranque y migración manualmente**

Run: `PORT=3999 HOST_PIN=test node server.js`
Expected: en consola aparece `🗂️ Migrado questions.json → games/vipday.json (activo)` (solo la primera vez) y `🎮 TVC Kahoot listo!`. Cortar con Ctrl+C. Confirmar que existe `games/vipday.json`.

- [ ] **Step 9: Commit**

```bash
git add server.js games/vipday.json config.json
git commit -m "feat: server usa store de juegos, baraja al iniciar y guarda resultados"
```

---

### Task 6: Verificación end-to-end del flujo (script cliente)

**Files:**
- Create: `scripts/verify-game-flow.js`

**Interfaces:**
- Consumes: el servidor corriendo en `localhost:3999`. Usa `socket.io-client` (ya está en `node_modules`).

- [ ] **Step 1: Crear el script de verificación**

Create `scripts/verify-game-flow.js`:

```js
// Verifica el flujo completo contra un server local en :3999.
// Uso: PORT=3999 HOST_PIN=test node server.js   (en otra terminal)
//      node scripts/verify-game-flow.js
const { io } = require('socket.io-client');
const fs = require('fs');
const path = require('path');
const URL = 'http://localhost:3999';
const PIN = process.env.HOST_PIN || 'test';

function host() {
  return new Promise((res) => {
    const s = io(URL, { transports: ['websocket'] });
    s.on('connect', () => s.emit('join-host', PIN));
    s.on('host-auth', ({ ok }) => ok && res(s));
  });
}
function player(name) {
  return new Promise((res) => {
    const s = io(URL, { transports: ['websocket'] });
    s.on('connect', () => s.emit('join-game', name));
    s.on('joined', () => res(s));
    s.on('join-error', (m) => { console.error('join-error', m); process.exit(1); });
  });
}

(async () => {
  const h = await host();
  const p = await player('Ana');
  let answered = false;
  p.on('question', (q) => {
    if (!answered) { answered = true; p.emit('submit-answer', q.options.findIndex(Boolean) >= 0 ? 0 : 0); }
  });
  // saltar pregunta a pregunta hasta gameover
  h.on('question', () => setTimeout(() => h.emit('force-end-question'), 300));
  h.on('question-ended', () => { answered = false; setTimeout(() => h.emit('next-question'), 300); });
  h.on('game-over', () => {
    setTimeout(() => {
      const dir = path.join(__dirname, '..', 'results');
      const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
      console.log('GAME OVER. Archivos de resultados:', files);
      if (!files.length) { console.error('❌ No se escribió archivo de resultados'); process.exit(1); }
      const latest = JSON.parse(fs.readFileSync(path.join(dir, files.sort().pop()), 'utf8'));
      console.log('✅ Resultado:', JSON.stringify({ game: latest.game, jugadores: latest.leaderboard.length, preguntas: latest.questions.length }, null, 2));
      process.exit(0);
    }, 500);
  });
  h.emit('start-game');
})();
```

- [ ] **Step 2: Correr la verificación**

En una terminal: `PORT=3999 HOST_PIN=test node server.js`
En otra: `node scripts/verify-game-flow.js`
Expected: imprime `GAME OVER`, lista un archivo en `results/` y `✅ Resultado` con jugadores=1 y preguntas=N. Borrar el archivo de prueba de `results/` después.

- [ ] **Step 3: Commit**

```bash
git add scripts/verify-game-flow.js
git commit -m "test: script de verificación end-to-end del flujo de juego"
```

---

### Task 7: Selector de juegos en `/admin`

**Files:**
- Modify: `views/admin.html`

**Interfaces:**
- Consumes: API de juegos de Task 5 (`/api/games`, `/api/games/:id/...`).
- El editor existente pasa a operar sobre el juego seleccionado (`selectedGame`).

- [ ] **Step 1: Añadir el bloque de selector de juego en el HTML**

Insertar justo después de `<div class="container">` (admin.html:163), antes del `<!-- ADD FORM -->`:

```html
  <!-- GAME SELECTOR -->
  <div class="form-card">
    <h2>🎟️ Juego / Evento</h2>
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
      <div class="form-group" style="flex:1;min-width:180px">
        <label>Juego seleccionado</label>
        <select id="game-select" style="background:var(--bg);border:1.5px solid var(--border);border-radius:8px;color:var(--text);font-size:0.95rem;padding:10px 14px;width:100%"></select>
      </div>
      <button class="btn btn-primary" onclick="activateGame()">✅ Activar este</button>
      <button class="btn btn-ghost" onclick="renameGame()">✏️ Renombrar</button>
      <button class="btn btn-ghost" onclick="newGame()">➕ Nuevo</button>
      <button class="btn btn-danger" onclick="deleteGame()">🗑 Eliminar</button>
    </div>
    <div style="display:flex;gap:20px;flex-wrap:wrap">
      <label class="radio-btn" id="lbl-shuffle-q" style="cursor:pointer">
        <input type="checkbox" id="shuffle-questions" onchange="saveFlags()" style="margin-right:6px"> Barajar preguntas
      </label>
      <label class="radio-btn" id="lbl-shuffle-a" style="cursor:pointer">
        <input type="checkbox" id="shuffle-answers" onchange="saveFlags()" style="margin-right:6px"> Barajar respuestas
      </label>
      <span id="active-tag" style="align-self:center;color:var(--green);font-weight:700"></span>
    </div>
  </div>
```

- [ ] **Step 2: Reemplazar el script de carga/CRUD para que use el juego seleccionado**

En el `<script>` de admin.html, sustituir las funciones de red. Cambiar el estado inicial (admin.html:260) para añadir:

```js
let games = [];
let selectedGame = null;
```

Reemplazar `loadQuestions` por la carga de juegos + preguntas del seleccionado:

```js
async function loadGames() {
  games = await (await fetch('/api/games')).json();
  const sel = document.getElementById('game-select');
  if (!selectedGame || !games.find(g => g.id === selectedGame)) {
    selectedGame = (games.find(g => g.active) || games[0] || {}).id || null;
  }
  sel.innerHTML = games.map(g =>
    `<option value="${g.id}"${g.id === selectedGame ? ' selected' : ''}>${esc(g.title)}${g.active ? ' (activo)' : ''}</option>`
  ).join('');
  const active = games.find(g => g.active);
  document.getElementById('active-tag').textContent = active ? `Activo: ${active.title}` : 'Sin juego activo';
  if (selectedGame) await loadQuestions();
}

document.getElementById('game-select') && document.getElementById('game-select').addEventListener('change', async (e) => {
  selectedGame = e.target.value;
  await loadQuestions();
});

async function loadQuestions() {
  const res = await fetch(`/api/games/${selectedGame}/questions`);
  questions = await res.json();
  renderList();
  loadFlags();
}
```

> **Requisito previo (ajuste a Task 2/5):** para que el admin muestre y edite los
> toggles, `listGames()` debe incluir las banderas. **Antes de esta tarea**, ampliar
> `lib/games.js` → `listGames()` para devolver `{ id, title, active, shuffleQuestions, shuffleAnswers }`,
> y actualizar el test correspondiente en `test/games.test.js` (añadir asserts de
> `shuffleQuestions`/`shuffleAnswers` en el caso `createGame + getGame + listGames`).
> Así `games` en el cliente ya trae las banderas y no hace falta otro endpoint.

- [ ] **Step 3: Implementar los flags y acciones de juego**

`loadFlags` usa las banderas ya incluidas en `games`:

```js
function loadFlags() {
  const g = games.find(x => x.id === selectedGame) || {};
  document.getElementById('shuffle-questions').checked = !!g.shuffleQuestions;
  document.getElementById('shuffle-answers').checked = !!g.shuffleAnswers;
}

async function saveFlags() {
  await fetch(`/api/games/${selectedGame}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      shuffleQuestions: document.getElementById('shuffle-questions').checked,
      shuffleAnswers: document.getElementById('shuffle-answers').checked,
    }),
  });
  await loadGames();
  toast('Ajustes guardados ✓');
}

async function activateGame() {
  const res = await fetch(`/api/games/${selectedGame}/activate`, { method: 'POST' });
  if (res.ok) { await loadGames(); toast('Juego activado ✓'); }
  else toast((await res.json()).error || 'No se pudo activar', true);
}

async function newGame() {
  const title = prompt('Nombre del evento (visible):');
  if (!title) return;
  const id = prompt('Id corto (minúsculas, números y guiones), p. ej. expo-2026:');
  if (!id) return;
  const res = await fetch('/api/games', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, title }),
  });
  if (res.ok) { selectedGame = id; await loadGames(); toast('Juego creado ✓'); }
  else toast((await res.json()).error || 'Error', true);
}

async function renameGame() {
  const g = games.find(x => x.id === selectedGame);
  const title = prompt('Nuevo nombre:', g ? g.title : '');
  if (!title) return;
  await fetch(`/api/games/${selectedGame}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title }),
  });
  await loadGames(); toast('Renombrado ✓');
}

async function deleteGame() {
  const g = games.find(x => x.id === selectedGame);
  if (!confirm(`¿Eliminar el juego "${g ? g.title : selectedGame}"?`)) return;
  const res = await fetch(`/api/games/${selectedGame}`, { method: 'DELETE' });
  if (res.ok) { selectedGame = null; await loadGames(); toast('Eliminado'); }
  else toast((await res.json()).error || 'No se pudo eliminar', true);
}
```

- [ ] **Step 4: Apuntar las rutas de preguntas existentes al juego seleccionado**

En `addQuestion`, `saveEdit`, `deleteQ` y `drop` de admin.html, cambiar las URLs:
- `'/api/questions'` → `` `/api/games/${selectedGame}/questions` ``
- `` `/api/questions/${i}` `` → `` `/api/games/${selectedGame}/questions/${i}` ``
- `'/api/questions/reorder'` → `` `/api/games/${selectedGame}/questions/reorder` ``

Y al final del script, cambiar la llamada inicial `loadQuestions();` por `loadGames();`.

- [ ] **Step 5: Verificar en el navegador**

Run: `PORT=3999 HOST_PIN=test node server.js` y abrir `http://localhost:3999/admin` (PIN `test`).
Expected: el selector lista "VIP Day" y "Temporada de Campeones 2026"; se puede cambiar de juego, ver sus preguntas, activar, y los toggles reflejan/guardan las banderas. Crear un juego de prueba y eliminarlo.

- [ ] **Step 6: Commit**

```bash
git add views/admin.html lib/games.js test/games.test.js
git commit -m "feat: selector de juegos y toggles de barajado en /admin"
```

---

### Task 8: Ranking entre preguntas en el Host

**Files:**
- Modify: `public/host.html`

**Interfaces:**
- Consumes: evento `leaderboard-update` (ya existe) y vista `#leaderboard-view` (ya existe).
- Comportamiento aprobado: revelar → "Siguiente" muestra el leaderboard ~4s y luego avanza solo a la siguiente pregunta.

- [ ] **Step 1: Cambiar `nextQuestion()` para pasar por el leaderboard**

En host.html (`nextQuestion`, ~línea 618), reemplazar:

```js
function nextQuestion() {
  socket.emit('next-question');
}
```

por:

```js
function nextQuestion() {
  // Mostrar el ranking unos segundos y luego avanzar.
  showView('leaderboard-view');
  setTimeout(() => socket.emit('next-question'), 4000);
}
```

`leaderboard-update` ya rellena `#lb-list` antes de tiempo (se emite en cada `endQuestion`), así que al mostrar la vista el ranking ya está renderizado.

- [ ] **Step 2: Asegurar que el control "Siguiente" no quede colgado**

El botón flotante `#btn-next-ctrl` y el botón de la vista reveal ambos llaman `nextQuestion()`. Verificar que tras los 4s entra la pregunta (el server emite `question`, que hace `showView('question-view')`). No se requiere cambio adicional.

- [ ] **Step 3: Verificar en el navegador**

Run el server y juega una ronda con un jugador (puedes usar `/play` en otra pestaña).
Expected: al pulsar "Siguiente pregunta", aparece el leaderboard ~4s y luego entra la siguiente pregunta automáticamente.

- [ ] **Step 4: Commit**

```bash
git add public/host.html
git commit -m "feat: Host muestra el ranking entre preguntas"
```

---

### Task 9: README para Claude Code y deploy

**Files:**
- Create: `README.md`
- (Opcional) Modify: `INSTRUCCIONES.md` si conviene enlazarlo.

- [ ] **Step 1: Escribir `README.md`**

Create `README.md`:

````markdown
# TVC Kahoot

Quiz estilo Kahoot para eventos de TVC. Un juego activo a la vez.

## Cómo se organizan los juegos

- `games/<id>.json` — un archivo por evento. `<id>` en minúsculas, números y guiones.
- `config.json` — `{ "activeGame": "<id>" }`: cuál se juega.
- `results/` — resultados de cada partida. **NO se versiona** (contiene nombres de
  participantes). Se descargan del servidor por cPanel/`scp`.

### Formato de `games/<id>.json`

```json
{
  "title": "Nombre visible del evento",
  "shuffleQuestions": true,
  "shuffleAnswers": true,
  "questions": [
    {
      "text": "¿Pregunta?",
      "options": ["Opción A", "Opción B", "Opción C", "Opción D"],
      "correct": 2,
      "time": 15,
      "explanation": "Texto opcional al revelar"
    }
  ]
}
```

- `correct` = índice (0–3) de la opción correcta **tal como está escrita aquí**.
  No te preocupes por el orden: si `shuffleAnswers` está activo, el servidor baraja
  las opciones en cada partida y recalcula cuál es la correcta.
- `time` entre 5 y 120 segundos.

## Agregar un evento nuevo (con Claude Code)

1. Crea `games/<id>.json` con el formato de arriba.
2. (Opcional) Ponlo activo: edita `config.json` → `"activeGame": "<id>"`.
3. Commit y push:
   ```bash
   git add games/<id>.json config.json
   git commit -m "feat: preguntas <evento>"
   git push
   ```
4. En el servidor:
   ```bash
   cd /home/infotvc/domains/quiz.tvc.mx/kahoot
   git pull
   pm2 restart kahoot
   ```

## Reglas importantes

- **GitHub es la fuente de la verdad.** El panel `/admin` también edita en vivo
  (sirve desde el celular durante el evento), pero esos cambios viven solo en el
  servidor. Si editas en `/admin` durante un evento y luego haces `git push`,
  **sobrescribes** lo editado. Para conservarlo, trae los archivos del server al repo
  antes de pushear.
- **`results/` nunca se sube a git** (privacidad de clientes).
- Arranca siempre con `HOST_PIN` definido (no uses el default `tvc2026`):
  el proceso pm2 debe tener la variable `HOST_PIN`.

## Operación durante el evento

- Host (proyectar): `https://quiz.tvc.mx/`
- Jugadores: `https://quiz.tvc.mx/play`
- Admin (preguntas/juegos): `https://quiz.tvc.mx/admin`

## Desarrollo local

```bash
npm install
PORT=3999 HOST_PIN=test node server.js
npm test            # corre los tests de lib/
```
````

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: README con workflow de juegos, deploy y privacidad"
```

---

## Notas de despliegue (post-implementación, las ejecuta el usuario)

- En el servidor, tras el primer `git pull` con estos cambios: `pm2 restart kahoot`.
  La migración creará `games/vipday.json` si no existe.
- Verificar que `pm2 env 0` incluye `HOST_PIN`; si no, reiniciar con la variable.
- `results/` se crea sola al terminar la primera partida.

---

## Self-Review (cobertura del spec)

- ✅ Múltiples juegos por evento → `lib/games.js` + `games/*.json` (Task 2, 4).
- ✅ Uno activo a la vez → `config.json` + `activate` rechaza partida en curso (Task 5).
- ✅ Selección por archivo (Claude Code) y por `/admin` → README (Task 9) + selector (Task 7).
- ✅ Barajar preguntas y respuestas con remapeo de `correct` → `lib/shuffle.js` (Task 1), usado en `start-game` (Task 5), toggles en admin (Task 7).
- ✅ Ranking entre preguntas en Host → Task 8.
- ✅ Resultados opción 3 (ranking + detalle por pregunta) → `lib/results.js` (Task 3) + historial (Task 5).
- ✅ Privacidad de resultados (no git) → `.gitignore` (Task 4).
- ✅ Migración de preguntas actuales a `games/vipday.json` → Task 5.
- ✅ README para Claude Code → Task 9.
- ✅ Seguridad PIN en nuevas rutas → candado ampliado (Task 5).
- Nota: el fix de fondo del estado "gameover" atascado queda fuera de alcance (mencionado en spec). `activate` ahora acepta reactivar en estado `gameover`, mitigando parte del problema.
```
