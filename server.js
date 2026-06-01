const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const os = require('os');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const HOST_PIN = process.env.HOST_PIN || 'tvc2026'; // Cambia este PIN (mejor por variable de entorno HOST_PIN)
const authenticatedHosts = new Set(); // sockets autenticados como host

if (HOST_PIN === 'tvc2026') {
  console.warn('\n⚠️  Estás usando el PIN por defecto (tvc2026). Define HOST_PIN antes de exponerlo en un servidor:');
  console.warn('    HOST_PIN="tu-pin-secreto" node server.js\n');
}

// Limpia texto para evitar inyección de HTML/JS (XSS) cuando se muestra en pantalla.
// Quitar < y > impide formar cualquier etiqueta o atributo (onerror, <script>, etc.)
// y evita problemas de visualización con textContent.
function sanitizeText(s) {
  return String(s == null ? '' : s).replace(/[<>]/g, '');
}

// Protege /admin y la API de preguntas con el PIN (Basic Auth del navegador)
function requireAdmin(req, res, next) {
  const token = (req.headers.authorization || '').split(' ')[1] || '';
  const pass = Buffer.from(token, 'base64').toString().split(':')[1] || '';
  if (pass === HOST_PIN) return next();
  res.set('WWW-Authenticate', 'Basic realm="TVC Kahoot Admin"');
  return res.status(401).send('Autenticación requerida');
}

// Load questions (mutable array)
let questions = JSON.parse(fs.readFileSync(path.join(__dirname, 'questions.json'), 'utf8'));

function saveQuestions() {
  fs.writeFileSync(path.join(__dirname, 'questions.json'), JSON.stringify(questions, null, 2), 'utf8');
}

// Game state
let gameState = {
  status: 'waiting', // waiting | question | reveal | gameover
  players: {},       // { socketId: { name, score } }
  currentQuestion: -1,
  questionTimer: null,
  answers: {},       // { socketId: { answer, timeLeft } }
  timeLeft: 0,
};

function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

// Candado: /admin, /admin.html y la API de preguntas exigen PIN
app.use((req, res, next) => {
  const p = req.path;
  if (p === '/admin' || p === '/admin.html' || p.startsWith('/api/questions')) {
    return requireAdmin(req, res, next);
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

app.get('/api/info', (req, res) => {
  // Si viene de ngrok, usar esa URL pública; si no, usar IP local
  const host = req.headers['x-forwarded-host'] || req.headers.host || `${getLocalIP()}:${PORT}`;
  const proto = req.headers['x-forwarded-proto'] || 'http';
  const base = `${proto}://${host}`;
  res.json({ url: `${base}/play` });
});

// ── ADMIN API ──
app.get('/api/questions', (req, res) => res.json(questions));

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

app.post('/api/questions', (req, res) => {
  const q = cleanQuestion(req.body);
  if (!q) return res.status(400).json({ error: 'Pregunta inválida' });
  questions.push(q);
  saveQuestions();
  res.json({ ok: true, index: questions.length - 1 });
});

app.put('/api/questions/:i', (req, res) => {
  const i = parseInt(req.params.i);
  if (i < 0 || i >= questions.length) return res.status(404).json({ error: 'No encontrada' });
  const q = cleanQuestion(req.body);
  if (!q) return res.status(400).json({ error: 'Pregunta inválida' });
  questions[i] = q;
  saveQuestions();
  res.json({ ok: true });
});

app.delete('/api/questions/:i', (req, res) => {
  const i = parseInt(req.params.i);
  if (i < 0 || i >= questions.length) return res.status(404).json({ error: 'No encontrada' });
  questions.splice(i, 1);
  saveQuestions();
  res.json({ ok: true });
});

app.post('/api/questions/reorder', (req, res) => {
  const from = parseInt(req.body.from);
  const to = parseInt(req.body.to);
  const n = questions.length;
  if (!Number.isInteger(from) || !Number.isInteger(to) ||
      from < 0 || from >= n || to < 0 || to >= n) {
    return res.status(400).json({ error: 'Índices inválidos' });
  }
  const [item] = questions.splice(from, 1);
  questions.splice(to, 0, item);
  saveQuestions();
  res.json({ ok: true });
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'host.html')));
app.get('/play', (req, res) => res.sendFile(path.join(__dirname, 'public', 'player.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'views', 'admin.html')));

function calcScore(timeLeft, maxTime) {
  return Math.round(1000 + (timeLeft / maxTime) * 500);
}

function getLeaderboard() {
  return Object.values(gameState.players)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map(({ name, score }) => ({ name, score }));
}

function endQuestion() {
  clearInterval(gameState.questionTimer);
  const q = questions[gameState.currentQuestion];
  const correctAnswer = q.correct;
  const maxTime = q.time || 20;

  const answerCounts = [0, 0, 0, 0];
  let correctCount = 0;

  for (const [socketId, answerData] of Object.entries(gameState.answers)) {
    const idx = answerData.answer;
    if (idx >= 0 && idx <= 3) answerCounts[idx]++;
    const isCorrect = idx === correctAnswer;
    let pts = 0;
    if (isCorrect) {
      pts = calcScore(answerData.timeLeft, maxTime);
      if (gameState.players[socketId]) gameState.players[socketId].score += pts;
      correctCount++;
    }
    io.to(socketId).emit('answer-result', {
      correct: isCorrect,
      points: pts,
      correctAnswer,
      totalScore: gameState.players[socketId]?.score || 0,
    });
  }

  // Players who didn't answer
  for (const [socketId] of Object.entries(gameState.players)) {
    if (!gameState.answers[socketId]) {
      io.to(socketId).emit('answer-result', {
        correct: false,
        points: 0,
        correctAnswer,
        totalScore: gameState.players[socketId]?.score || 0,
        noAnswer: true,
      });
    }
  }

  gameState.status = 'reveal';

  io.to('host').emit('question-ended', {
    correctAnswer,
    answerCounts,
    correctCount,
    totalAnswered: Object.keys(gameState.answers).length,
    leaderboard: getLeaderboard(),
    explanation: q.explanation || '',
  });

  io.emit('leaderboard-update', getLeaderboard());
}

io.on('connection', (socket) => {
  // ── HOST ──
  socket.on('join-host', (pin) => {
    if (pin !== HOST_PIN) {
      socket.emit('host-auth', { ok: false, msg: 'PIN incorrecto' });
      return;
    }
    authenticatedHosts.add(socket.id);
    socket.join('host');
    socket.emit('host-auth', { ok: true });
    socket.emit('game-state', {
      status: gameState.status,
      playerCount: Object.keys(gameState.players).length,
      players: Object.values(gameState.players).map(p => p.name),
      total: questions.length,
    });
  });

  socket.on('start-game', () => {
    if (!authenticatedHosts.has(socket.id)) return;
    if (gameState.status !== 'waiting') return;
    gameState.currentQuestion = -1;
    gameState.status = 'countdown';
    io.emit('game-started', { total: questions.length });
    // Countdown 4,3,2,1 → ¡Inicio!
    let count = 5;
    io.emit('countdown', { count });
    const countTimer = setInterval(() => {
      count--;
      if (count > 0) {
        io.emit('countdown', { count });
      } else {
        clearInterval(countTimer);
        io.emit('countdown', { count: 0 }); // "¡Inicio!"
        setTimeout(() => sendNextQuestion(), 800);
      }
    }, 1000);
  });

  socket.on('next-question', () => {
    if (!authenticatedHosts.has(socket.id)) return;
    if (gameState.status !== 'reveal') return;
    sendNextQuestion();
  });

  // Forzar fin de pregunta actual (saltar timer)
  socket.on('force-end-question', () => {
    if (!authenticatedHosts.has(socket.id)) return;
    if (gameState.status !== 'question') return;
    clearInterval(gameState.questionTimer);
    gameState.timeLeft = 0;
    endQuestion();
  });

  socket.on('reset-game', () => {
    if (!authenticatedHosts.has(socket.id)) return;
    clearInterval(gameState.questionTimer);
    gameState = {
      status: 'waiting',
      players: {},
      currentQuestion: -1,
      questionTimer: null,
      answers: {},
      timeLeft: 0,
    };
    io.emit('game-reset');
  });

  // ── PLAYER ──
  socket.on('join-game', (name) => {
    if (gameState.status === 'gameover') {
      socket.emit('join-error', 'El juego ya terminó.');
      return;
    }
    const cleanName = sanitizeText(String(name || '').trim().slice(0, 24));
    if (!cleanName) { socket.emit('join-error', 'Escribe tu nombre.'); return; }

    gameState.players[socket.id] = { name: cleanName, score: 0 };
    socket.join('players');
    socket.emit('joined', { name: cleanName });
    io.to('host').emit('player-joined', {
      name: cleanName,
      count: Object.keys(gameState.players).length,
    });

    // Si el juego ya inició, manda la pregunta actual
    if (gameState.status === 'question') {
      const q = questions[gameState.currentQuestion];
      socket.emit('question', {
        index: gameState.currentQuestion,
        total: questions.length,
        text: q.text,
        options: q.options,
        time: q.time || 20,
      });
      socket.emit('timer', { timeLeft: gameState.timeLeft, total: q.time || 20 });
    } else if (gameState.status === 'reveal') {
      socket.emit('waiting-next', {});
    }
  });

  socket.on('submit-answer', (answerIndex) => {
    if (gameState.status !== 'question') return;
    if (gameState.answers[socket.id]) return;
    if (!gameState.players[socket.id]) return;

    gameState.answers[socket.id] = { answer: answerIndex, timeLeft: gameState.timeLeft };
    socket.emit('answer-received', { answer: answerIndex });

    io.to('host').emit('answer-count', {
      count: Object.keys(gameState.answers).length,
      total: Object.keys(gameState.players).length,
    });

    if (Object.keys(gameState.answers).length >= Object.keys(gameState.players).length) {
      clearInterval(gameState.questionTimer);
      gameState.timeLeft = 0;
      endQuestion();
    }
  });

  // ── DISCONNECT ──
  socket.on('disconnect', () => {
    authenticatedHosts.delete(socket.id);
    if (gameState.players[socket.id]) {
      const name = gameState.players[socket.id].name;
      delete gameState.players[socket.id];
      io.to('host').emit('player-left', {
        name,
        count: Object.keys(gameState.players).length,
      });
    }
  });

  function sendNextQuestion() {
    gameState.currentQuestion++;
    if (gameState.currentQuestion >= questions.length) {
      gameState.status = 'gameover';
      io.emit('game-over', { leaderboard: getLeaderboard() });
      return;
    }
    const q = questions[gameState.currentQuestion];
    const time = q.time || 20;
    gameState.status = 'question';
    gameState.answers = {};
    gameState.timeLeft = time;

    io.to('host').emit('question', {
      index: gameState.currentQuestion,
      total: questions.length,
      text: q.text,
      options: q.options,
      time,
      correct: q.correct,
      image: q.image || null,
    });

    io.to('players').emit('question', {
      index: gameState.currentQuestion,
      total: questions.length,
      text: q.text,
      options: q.options,
      time,
    });

    gameState.questionTimer = setInterval(() => {
      gameState.timeLeft--;
      io.emit('timer', { timeLeft: gameState.timeLeft, total: time });
      if (gameState.timeLeft <= 0) {
        clearInterval(gameState.questionTimer);
        endQuestion();
      }
    }, 1000);
  }
});

const BIND_HOST = process.env.BIND_HOST || '0.0.0.0'; // En producción detrás de proxy: 127.0.0.1
server.listen(PORT, BIND_HOST, () => {
  const ip = getLocalIP();
  console.log('\n🎮  TVC Kahoot listo!\n');
  console.log(`   Host (proyectar): http://localhost:${PORT}`);
  console.log(`   Jugadores:        http://${ip}:${PORT}/play`);
  console.log('\n   Abre el Host en tu navegador y comparte el QR.\n');
});
