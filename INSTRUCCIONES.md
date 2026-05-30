# TVC Kahoot — Instrucciones de uso

## Requisitos
- Node.js instalado en tu Mac (verifica con: `node -v`)
- Las 200 personas y tu Mac deben estar en la **misma red WiFi**

---

## Cómo arrancar

1. Abre Terminal
2. Ve a esta carpeta:
   ```
   cd ~/Desktop/tvc-kahoot   ← (mueve la carpeta ahí primero)
   ```
3. Instala dependencias (solo la primera vez):
   ```
   npm install
   ```
4. Arranca el servidor:
   ```
   node server.js
   ```
5. Verás algo como:
   ```
   🎮  TVC Kahoot listo!
      Host (proyectar):  http://localhost:3000
      Jugadores:         http://192.168.1.50:3000/play
   ```

---

## Durante la dinámica

- **Tú (host):** Abre `http://localhost:3000` en tu navegador y proyéctalo
- **Participantes:** Escanean el QR que aparece en pantalla (o entran a la URL)
- Cuando todos estén conectados, presiona **▶ Iniciar juego**
- Tú controlas el ritmo: avanzas de pregunta en pregunta

---

## Editar preguntas

Abre `questions.json` con cualquier editor de texto. Cada pregunta tiene este formato:

```json
{
  "text": "¿Cuál es la pregunta?",
  "options": ["Opción A", "Opción B", "Opción C", "Opción D"],
  "correct": 1,        ← índice de la respuesta correcta (0=A, 1=B, 2=C, 3=D)
  "time": 20,          ← segundos para responder
  "explanation": "Explicación que ve el host al revelar la respuesta"
}
```

Puedes agregar tantas preguntas como quieras.

---

## Para desplegar en el servidor de la empresa

El proceso es el mismo. Solo copia la carpeta al servidor y ejecuta `node server.js`.
Para producción puedes usar PM2: `npm install -g pm2 && pm2 start server.js`
