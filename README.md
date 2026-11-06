# Oche Darts

3D pub darts for 2–4 players (plus optional computer opponents) in the browser. Play live together or take your turn later from the same link. No sign-in.

Play: https://john-gustin.github.io/darts/

- Games: 501 and 301 (double-out, optional double-in, checkout hints) and Cricket.
- Matches of 1 leg, best of 3 or best of 5. Rematch with the same players on the same link.
- Throwing: **Flick** (aim against a swaying crosshair, then flick the mouse up and release) or **Meter** (lock aim, then time the meter). Each player picks.
- CPU opponents: Easy, Medium, Pro.
- Live chat, match stats (3-dart average, 100+, 180s, marks per round).

Every dart's landing point is stored per player as a retained message on several free public MQTT brokers, and every browser rebuilds the game from those darts. There is no server to run. `lib/` holds bundled copies of three.js and MQTT.js.
