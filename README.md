# Pass the Note

A mischievous hidden-role party game for 4–6 players: pass a secret note across a seventh-grade classroom before the Snitch catches it.

**Live game:** [YOUR-SITE.netlify.app](https://YOUR-SITE.netlify.app) — replace this placeholder after deployment.

> **GIF / screenshot placeholder:** Add a gameplay GIF or screenshot here, showing the classroom grid with the private role card folded shut. Use fictional player names and omit private rejoin keys.

## How to Play

1. One player creates a room. Everyone else opens the same site on their own phone, laptop, or browser tab and joins with the four-letter room code. The host starts with 4–6 players. Discuss out loud on your video call or in person.
2. Tap **Fold to peek** to see your private role and whether you hold the note. The card closes after eight seconds or when the window loses focus.
   - **Writer:** starts holding the note and helps the students deliver it.
   - **Classmate:** helps deliver the note and decides whom to trust.
   - **Snitch:** secretly works for the Teacher to intercept or find the note.
3. Each round has a **Pass**, **Search**, and **Talk** phase:
   - Everyone locks a neighboring occupied desk or **Keep**. No diagonals or passing through empty desks. Desks marked **★** can choose **Deliver to Crush**.
   - At the deadline, all arrows reveal together. Only the starting holder's choice moves the real note, once; everyone else's pass is a fake. Only the new holder receives their private note status.
   - The Snitch peeks to choose a desk for the Teacher to search. The searched desk becomes public at the deadline; the chooser stays secret.
   - If the search misses, discuss whom to trust before the next round. The public round log preserves arrows and search results without identifying real passes.
4. **Students win** when the real note reaches the Crush, including in round six. **The Snitch wins** if they receive the note, the Teacher finds it, or six rounds finish without delivery.
5. After student delivery, the Snitch gets one guess at the original Writer for **one bonus point**. This does not steal the student win. After the guess, everyone sees all roles, the full note path, and scores.

Normal timers are 25 seconds for role reveal, 15 for Pass, 10 for Search, and 30 for Talk. Missing a pass means Keep; a missing search picks a random occupied desk. Refreshing the same tab preserves your seat. Save your private rejoin key and room code to recover from another device. Host controls transfer to the next connected player when the host leaves, with a 20-second grace period for a lost connection.

Students earn 2 points each for a student win. A Snitch win earns 2 points per student; a correct Writer guess adds 1. **Play again** keeps scores and deals new roles and seats using weighted rotation. For an overall winner, agree on a session length, then compare scores; ties share the win. Rooms expire after 24 hours without activity.

## Tech stack

- Vanilla HTML, CSS, and JavaScript, with notebook-paper and chalkboard styling.
- Node.js 22.12+ and a TypeScript Netlify Function.
- Netlify Blobs for durable room storage.
- Netlify's function packager and Node's built-in test runner.

## Architecture

The server is authoritative. `game.mjs` owns the rules, legal moves, deadlines, role assignment, win checks, scoring, and the **per-player view allowlist**. Devices receive only their own role, holder status, and private submission, plus public information. All roles and the real note path are disclosed only after the game ends. Authentication credentials are separate from public desk IDs; the browser cannot choose its role or move the real note by claiming to hold it.

`netlify/functions/game.ts` is the single function entry. The frontend calls **`/.netlify/functions/game` directly**, without an API redirect or custom `config.path`. It polls every 1.4–1.6 seconds rather than using WebSockets. Each tab stores only its own session credentials in `sessionStorage`; refreshing rejoins the same seat. `session.mjs` manages presence and host handoff.

`room-service.mjs` handles requests and persists each room as one document in the site-wide `pass-the-note-rooms` Blobs store. Reads use **strong consistency**. New room codes use **`onlyIfNew`**; existing-room writes use **`onlyIfMatch`** with the read ETag. On conflict, the candidate is discarded and the request reruns authentication, timer advancement, and action validation against the latest room. There is no unconditional overwrite fallback. Polling/presence updates use the same conditional-write path. No raw room document or storage ETag is returned to a player.

Timers advance on requests, so the deployed game needs no continuously running backend or scheduled worker. Netlify supplies Blobs runtime credentials automatically.

```text
public/                      frontend source
netlify/functions/game.ts    only deployed function entry
room-service.mjs             request validation and conditional room updates
game.mjs                     game rules and per-player views
session.mjs                  presence and host handoff
scripts/                     production build and function packaging
test/                        rules, security, concurrency, and integration tests
netlify.toml                 deployment configuration
```

`dist/` and `packaged-functions/` are generated locally and excluded from Git. `test/support/legacy-server.mjs` is an isolated regression-test fixture, never the deployed backend or the frontend's API.

## Local development

Install **Node.js 22.12+**, npm, and `unzip` (used by the packaged-function test). macOS and most Linux installations already include `unzip`.

```sh
git clone https://github.com/rkparikh77/pass-the-note.git
cd pass-the-note
npm ci
npm run build
npx --yes netlify-cli dev --offline --dir dist --port 8888
```

Open **http://localhost:8888**. Netlify Dev serves the frontend and emulates Functions and Blobs locally. Do not open `public/index.html` directly. After changing frontend files in `public/`, rerun `npm run build` to update the served `dist/` files. Local platform state under `.netlify/` is ignored by Git.

To test alone, open four ordinary new tabs, create/join under different names, and enable **Solo testing** before starting. It gives longer pass/search windows. For a student win, route the Writer's note through student desks to a ★ desk, deliver, then guess from the Snitch's private card. Check the revealed path and scores, and start a second game.

Run all production-build, function-package, and test checks with:

```sh
npm run verify
```

The installed Blobs SDK's local emulator has a known ETag-on-read limitation, described in [VERIFICATION.md](VERIFICATION.md). If your Netlify Dev version exhibits it, existing-room requests fail closed rather than weakening concurrency protection. The packaged-function test applies an explicitly test-only emulator compatibility shim; production uses Netlify's real ETags. The CLI launch instructions follow the [Netlify Dev command reference](https://cli.netlify.com/commands/dev/); interactive Netlify Dev behavior has not been verified as part of repository preparation.

## Deploy to Netlify

### From this GitHub repository

1. Push to `github.com/rkparikh77/pass-the-note`, then sign in to Netlify.
2. Choose **Add new project → Import an existing project**, select GitHub, and select this repository.
3. Let Netlify use `netlify.toml`: build command **`npm run build`**, publish directory **`dist`**, and functions directory **`netlify/functions`**. Keep the project root as the base directory.
4. Deploy, then replace the live URL placeholder above with the published address.

See Netlify’s [repository import guide](https://docs.netlify.com/manage/projects/add-new-project/#import-from-an-existing-repository). No custom environment variables, API keys, or manual database provisioning are needed. Netlify configures the function's Blobs access. Only the four public assets in `dist/` are published as static files; rules and server helpers remain in the function bundle.

A complete source-project ZIP can also use the [signed-in Netlify Drop build flow](https://docs.netlify.com/start/quickstarts/netlify-drop-quickstart/). Upload the whole project, not only `dist/`: a static-only upload cannot run the multiplayer function. This repository intentionally excludes generated deployment ZIPs and bundles.

## Tests and security notes

[VERIFICATION.md](VERIFICATION.md) documents the complete four-player game, simultaneous action/room updates, packaged-function SDK test, and score carryover. [SECURITY-AUDIT.md](SECURITY-AUDIT.md) lists every role's network fields and the hidden-information checks. Verification is local; no live deployment is claimed.

Test tokens, fictional player names, deterministic clocks, and injected stores are test fixtures. They are not live secrets, player data, or production debug controls. Keep credentials and local room data out of commits; `.gitignore` excludes environment files, dependencies, build output, Netlify local state, and logs.

## License

[MIT](LICENSE) © 2026 rkparikh77.
