# Guan Dan (掼蛋) online
This 4 player game is a chinese team card game. You win by advancing your team score to Ace and then winning the next round, starting from 2 and going after the french card order. To advance the team score, one must win the current round. This can be done by discarding all the cards on your hand.

Since a card game requires people being present, this online version allows people to play this game with friends while being seperated. 

This is a project purely coded by AI (Antrophic Claude Opus 5.5). The point of this project was to test out publishing own projects to the internet, paired with personal interest in this game, allowing me to play this game personally.


## Files

- `server.js`: the game server (Node.js). Serves the page and runs the tables over WebSocket.
- `public/index.html`, `public/app.js`: the game page in the browser.
- `public/engine.js`: the Guan Dan rules, used by the server and by the practice game.
- `package.json`: tells the host what to install (`ws`) and how to start (`npm start`).

## Run on your own computer

    npm install
    npm start

Then open http://localhost:3000.
