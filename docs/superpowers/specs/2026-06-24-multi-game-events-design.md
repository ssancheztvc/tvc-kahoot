# Diseño: Múltiples juegos por evento, random y resultados

**Fecha:** 2026-06-24
**Autor:** Sergio Sánchez (con Claude Code)
**Estado:** Aprobado para implementación

## Problema

Hoy el proyecto tiene un único `questions.json` y un único `gameState` en memoria.
No hay forma de tener distintos juegos (uno por evento) ni de guardar quién ganó.
Necesitamos:

1. Guardar varias "barajas" de preguntas, una por evento, reutilizables (VIP Day,
   Temporada de Campeones, futuros eventos). Uno activo a la vez.
2. Elegir el juego activo tanto por archivo (Claude Code + GitHub) como desde el
   panel `/admin` (operable desde el celular durante el evento).
3. Aleatorizar opcionalmente el orden de las preguntas y de las respuestas.
4. Mostrar el ranking en la pantalla del Host entre pregunta y pregunta.
5. Guardar los resultados finales de cada partida (ranking completo + detalle por
   pregunta), **sin** publicarlos en GitHub por privacidad de clientes.

## Alcance y supuestos

- **Una partida viva a la vez** (un solo `gameState`, un solo Host). NO se soportan
  dos eventos simultáneos; rehacerlo no vale la pena porque no ocurre en la práctica.
- **GitHub es la fuente de la verdad** de las preguntas. El panel `/admin` también
  puede editar en vivo (en el servidor), con la advertencia documentada de que esos
  cambios deben volver al repo o se sobrescriben en el siguiente deploy.
- Flujo de trabajo: editar con Claude Code → `git push` → el server hace `git pull`
  → `pm2 restart kahoot`.

## Modelo de datos

### `games/<id>.json` — un archivo por evento

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
    }
  ]
}
```

- `id` = nombre de archivo sin extensión (p. ej. `temporada-campeones`). Sirve como
  identificador estable.
- `title` = nombre visible (puede llevar espacios, año, etc.).
- `shuffleQuestions` / `shuffleAnswers` = banderas por evento.
- `questions[]` = mismo formato actual: `text`, `options` (4), `correct` (índice
  0–3 de la opción correcta **tal como está escrita en el archivo**), `time`,
  `explanation`.

### `config.json` — apuntador del juego activo

```json
{ "activeGame": "temporada-campeones" }
```

### `results/<fecha>_<id>_<hora>.json` — un archivo por partida jugada

```json
{
  "game": "temporada-campeones",
  "title": "Temporada de Campeones 2026",
  "playedAt": "2026-06-24T14:30:00.000Z",
  "leaderboard": [
    { "name": "Juan Pérez", "score": 4820 }
  ],
  "questions": [
    {
      "index": 0,
      "text": "...",
      "correctAnswer": 1,
      "answers": [
        { "name": "Juan Pérez", "answer": 1, "correct": true, "timeLeft": 12, "points": 1300 }
      ]
    }
  ]
}
```

- **Privacidad:** `results/` está en `.gitignore`. Solo se versiona `results/.gitkeep`.
  El contenido nunca se sube a GitHub. Se descarga del servidor por cPanel File
  Manager o `scp`.

## Componentes y cambios

### 1. `server.js`

- **Carga del juego activo:** al arrancar y al activar un juego, lee `config.json`,
  abre `games/<activeGame>.json` y carga `title`, banderas y `questions`.
- **Migración / fallback:** si no existe `games/` ni `config.json`, migrar el
  `questions.json` actual a `games/vipday.json` con `activeGame: "vipday"` (script
  de migración una sola vez, o lógica de arranque que lo cree si falta).
- **Barajado al iniciar la partida** (`start-game`): construir una copia en memoria
  de las preguntas para esa partida:
  - Si `shuffleQuestions`, barajar el orden de `questions`.
  - Si `shuffleAnswers`, barajar `options` de cada pregunta y **recalcular `correct`**
    al nuevo índice de la opción correcta. (Se usa `Math.random` en el servidor —
    permitido; solo está prohibido en scripts de workflow, no en la app.)
  - El `gameState` juega sobre esta copia barajada; los archivos JSON no se modifican.
- **Registro de respuestas para resultados:** acumular, por pregunta, qué respondió
  cada jugador (índice, si acertó, `timeLeft`, puntos). Reusar lo que ya se calcula
  en `endQuestion()`.
- **Escritura de resultados:** en `sendNextQuestion()` cuando se llega a `gameover`,
  escribir el archivo en `results/` con el formato de arriba. Crear `results/` si no
  existe.
- **API de juegos (protegida por PIN, igual que `/api/questions`):**
  - `GET /api/games` → lista de `{ id, title, active }`.
  - `POST /api/games` → crear juego nuevo `{ id, title }`.
  - `PUT /api/games/:id` → renombrar / cambiar banderas de shuffle.
  - `DELETE /api/games/:id` → eliminar (no permitir borrar el activo sin reasignar).
  - `POST /api/games/:id/activate` → poner como activo (actualiza `config.json`,
    recarga preguntas). Solo si no hay partida en curso.
- **API de preguntas parametrizada por juego:** las rutas de preguntas pasan a
  operar sobre un juego identificado por su `id`, **no** sobre un único archivo
  global. Así se puede editar cualquier evento (p. ej. preparar Temporada de
  Campeones) sin tener que activarlo ni afectar al que esté activo. Las rutas
  quedan: `GET/POST /api/games/:id/questions`, `PUT/DELETE
  /api/games/:id/questions/:i`, `POST /api/games/:id/questions/reorder`.
  El `admin.html` apunta a estas rutas con el juego seleccionado en el selector.

### 2. `views/admin.html`

- Selector arriba con la lista de juegos y cuál está activo.
- Botones: **Crear**, **Renombrar**, **Eliminar**, **Activar**.
- Toggles `shuffleQuestions` / `shuffleAnswers` por juego.
- El editor de preguntas (ya existente) opera sobre el juego seleccionado.
- Responsivo / usable desde el celular (ya usa layout flexible; verificar en móvil).

### 3. `public/host.html`

- Mostrar el leaderboard **entre preguntas**: al pulsar "Siguiente" desde `reveal`,
  mostrar `#leaderboard-view` (que ya existe y ya se renderiza con
  `leaderboard-update`) durante ~unos segundos y luego pedir la siguiente pregunta.
- Implementación mínima: el botón "Siguiente" llama a `showView('leaderboard-view')`
  y tras un `setTimeout` emite `next-question`; o el servidor manda un evento de
  "mostrar leaderboard" antes de la siguiente pregunta. Decisión fina en el plan.

### 4. `README.md` (instrucciones para Claude Code / futuras sesiones)

Documentar:
- Formato de `games/<id>.json` y de cada pregunta.
- Cómo crear un evento nuevo (crear archivo en `games/`).
- Cómo marcar el juego activo (`config.json`).
- Banderas de random y qué hacen.
- Regla de privacidad: `results/` NO se sube a git.
- Regla de fuente de la verdad: GitHub manda; cambios hechos en `/admin` durante el
  evento deben volver al repo o se pierden en el siguiente deploy.
- Pasos de deploy: `git push` → en el server `git pull` → `pm2 restart kahoot`.
- Recordatorio de seguridad: arrancar con `HOST_PIN` definido (no usar el default).

### 5. `.gitignore`

- Añadir `results/*.json` (excluir resultados) y conservar `results/.gitkeep`.

## Flujo de datos (partida típica)

1. Host entra a `/`, mete PIN → lobby.
2. Jugadores entran por `/play`.
3. Host pulsa "Iniciar juego" → server toma `games/<activeGame>.json`, baraja según
   banderas, arranca countdown y manda la primera pregunta.
4. Por cada pregunta: pregunta → respuestas → `endQuestion()` (revela correcta,
   suma puntos, guarda detalle) → Host muestra reveal → al "Siguiente" muestra
   **leaderboard** → siguiente pregunta.
5. Al agotar las preguntas → `gameover`: el server escribe `results/<...>.json` y
   manda el podio.

## Manejo de errores

- `games/<activeGame>.json` ausente o inválido → log claro y fallback a un juego
  vacío seguro (no crashear el proceso; el contador `↺` de pm2 ya iba en 5).
- Activar un juego con partida en curso → rechazar (igual que `start-game` exige
  estado `waiting`).
- Escritura de `results/` falla → log del error, no tumbar la partida.

## Pruebas

- Migración: con solo `questions.json`, al arrancar se crea `games/vipday.json` y
  `config.json` sin perder preguntas.
- Activar un juego cambia las preguntas que se sirven.
- `shuffleAnswers` reordena opciones y la correcta sigue siendo la correcta
  (validar que `correct` se remapea bien).
- `shuffleQuestions` cambia el orden entre partidas.
- Al terminar, `results/` contiene ranking + detalle por pregunta correctos.
- El Host muestra el leaderboard entre preguntas.
- Reproducir el bug original: una partida que llega a `gameover` y luego se puede
  iniciar otra (ligado al fix de estado atascado; ver nota abajo).

## Nota relacionada (fuera de alcance, mencionar en el plan)

El bug que originó esta conversación —estado atascado en `gameover`— se resolvió en
producción reiniciando pm2. El arreglo de fondo (que "Iniciar juego" reinicie una
partida terminada, o que `/admin` permita reiniciar el estado) es deseable pero se
trata como mejora aparte para no mezclar alcances.
