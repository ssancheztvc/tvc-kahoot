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
