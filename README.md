# Guan Dan (掼蛋) online

An online card table for four players. The server deals the cards, checks every move,
and sends each player only their own hand.

## Files

- `server.js`: the game server (Node.js). Serves the page and runs the tables over WebSocket.
- `public/index.html`, `public/app.js`: the game page in the browser.
- `public/engine.js`: the Guan Dan rules, used by the server and by the practice game.
- `package.json`: tells the host what to install (`ws`) and how to start (`npm start`).

## Run on your own computer

    npm install
    npm start

Then open http://localhost:3000.

## Put it online with Render

1. Upload this folder to a GitHub repository (without `node_modules`).
2. On render.com: New → Web Service → choose the repository.
3. Build command: `npm install` · Start command: `npm start` · Instance type: Free.
4. Open the address Render gives you, create a table, and send the link to your friends.

On the free plan the server sleeps after 15 minutes without visitors; the first visit after
that takes about a minute. Tables live in memory, so unfinished tables are lost when the
server sleeps or restarts.
