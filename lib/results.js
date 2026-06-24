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
