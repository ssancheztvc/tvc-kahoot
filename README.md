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

## El día del evento (operador)

Guía paso a paso para correr un evento en vivo sin necesidad de conocimientos técnicos.

1. **Verifica el juego activo.** Abre `https://quiz.tvc.mx/admin` en tu celular o laptop, ingresa el PIN. En el selector de juegos, elige el evento de hoy y pulsa **"Activar"**.
2. **Abre la pantalla del Host en el proyector.** Navega a `https://quiz.tvc.mx/` en la computadora conectada al proyector e ingresa el PIN. Verás el código QR y el nombre del evento.
3. **Los participantes se unen.** Pídeles que escaneen el QR o abran `https://quiz.tvc.mx/play` en su celular y escriban su nombre. Los nombres aparecerán en la pantalla del Host conforme se vayan uniendo.
4. **Inicia el juego.** Cuando todos estén listos, presiona **"Iniciar juego"** en la pantalla del Host.
5. **Avanza entre preguntas.** Al terminar el tiempo de cada pregunta se muestra la respuesta correcta (y la explicación, si existe). Presiona **"Siguiente pregunta"** para continuar con la siguiente.
6. **El ranking aparece automáticamente** entre preguntas. No tienes que hacer nada; continúa cuando estés listo.
7. **Al finalizar el juego** se muestra el podio con los tres primeros lugares. Los resultados se guardan automáticamente en el servidor.
8. **Para jugar otra ronda** con el mismo juego, presiona **"Nuevo juego"** en la pantalla del Host. Los participantes deberán volver a unirse desde `/play`.
9. **¿Algo salió mal?** Si el juego se atasca, ve a `/admin` y usa el botón de reset para reiniciar el estado. Luego comienza desde el paso 4.
