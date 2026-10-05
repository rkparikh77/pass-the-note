# Netlify verification

## Result

Production frontend build, Netlify function packaging, and all **24 automated tests** pass. The frontend also successfully created a room in a browser using the standard `/.netlify/functions/game` endpoint on a local function preview.

`game.mjs` and `session.mjs` retain their original SHA-256 hashes. CSS, icons, and game-screen markup were preserved. Only the frontend request transport changed.

## Complete four-player game

Tested Alex, Blair, Casey, and Drew through the same function request/response interface used by the browser:

1. Create room and join three seats; check distinct private credentials and public seat IDs.
2. Reject unauthenticated access, public IDs used as credentials, and non-host start.
3. Start and privately deal exactly one Writer and one Snitch. Reveal only each requester's role and own holder status.
4. Enter Pass; lock a choice, accept an identical retry as a no-op, and reject a different second choice.
5. Resolve a round of passes and a Snitch search. Reject searches by a student. Keep the search target and the actor's submission timing out of other players' complete responses before the search deadline.
6. Route the real note through a neighboring student desk, confirm only the recipient sees their own holder status, and deliver from a legal ★ desk. Use additional searches and discussions as needed.
7. Confirm student win, hidden roles/path through the bonus-guess phase, and unchanged public scores until game over.
8. Submit the Snitch's correct guess of the original Writer; confirm the full path and all roles become public, students receive 2 points each, and the Snitch receives 1 bonus point.
9. Return to lobby and start game two; verify scores remain and the roles/seats are dealt again.

The game is run both against the source request handler and against the exact compiled handler extracted from Netlify's generated `packaged-functions/game.zip` with the real `@netlify/blobs` SDK.

## Concurrency and hidden information

- Deliberately overlapping reads followed by atomic test-store conditional writes cause genuine ETag conflicts. Concurrent passes retain all four players' submissions.
- Two concurrent bonus guesses award the bonus once; the other action is revalidated and rejected after the committed phase change.
- Concurrent joins fill exactly six unique seats and reject the remaining requests.
- Concurrent room creation with the same candidate code reserves different rooms using `onlyIfNew`.
- Exhausted contention returns a retryable 503; no unconditional write is used.
- Every existing-room write, including polling/presence and timer advancement, requires `onlyIfMatch`.
- The SDK test verifies all storage requests bypass the cached endpoint and all writes carry conditional HTTP headers.
- Full-response checks confirm private credentials, rejoin keys, other players' roles, private search choices, and actual note path do not leak before their permitted disclosure. Existing security tests cover every role/phase for 4, 5, and 6 players.
- Invalid origin, malformed/oversized bodies, and wrong HTTP methods are rejected.

## Build and package

- `dist/` contains exactly `index.html`, `app.js`, `style.css`, and `favicon.svg`; each matches its frontend source.
- Frontend source calls the function directly; no `/api/` URL or API redirect exists.
- `netlify/functions/` contains only `game.ts`. Rules, storage service, session helpers, and tests are outside that directory.
- Netlify's official `@netlify/zip-it-and-ship-it` successfully packages the function for Node 22, with runtime API version 2 and its standard streaming bootstrap.
- The final project ZIP has root-level configuration, package manifest/lockfile, frontend source, server helpers, Netlify function source, production output, tests, and the verified function artifact. Project `node_modules`, caches, and logs are excluded. Necessary runtime dependencies are contained inside Netlify's function ZIP.

## Scope of validation

No live Netlify account was used or site published. Tests use a deterministic clock to exercise real phase deadlines quickly; production uses only server time and cryptographic randomness, with no HTTP testing controls.

The installed Netlify Blobs 11.1.3 local emulator omits ETags from read responses. In the sequential packaged-function test only, its real PUT ETags are attached to subsequent GET responses to reproduce the documented production SDK contract. Production code requires the server-provided GET ETag and fails closed if it is missing. Atomic simultaneous-write behavior is verified separately with the deliberately conflicting CAS test store; it is not claimed as a live cloud load test.

Publishing uses Netlify's documented **signed-in Drop source-project build** flow. An anonymous/static-only upload does not deploy this backend. No manual database, API keys, custom environment setup, GitHub, or user-run commands are needed.
