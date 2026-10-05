# Hidden-information and action audit

Audited the HTTP adapter, game state machine, per-player JSON view, client requests, sessionStorage, and tab-isolation messages. The final boundary is `phase === 'over'`; the delivery bonus phase (`guess`) still protects the Writer's identity. This audit covers application responses and action authorization, not a claim of constant-time execution or protection from someone controlling another player's computer.

## Findings and before/after

| Finding | Before | After |
| --- | --- | --- |
| Private search submission changed public metadata | In a deterministic reproduction, a Writer polling Search saw `version: 7` become `8` immediately after the Snitch submitted. This exposed submission timing, although not the chooser's identity or target. | Only the Snitch's private version increases. Every other player's entire serialized view is identical at the same server time before/after submission. The public deadline remains fixed. |
| Identical retries mutated state | Retrying an unchanged pass or search incremented the global version again. A Snitch could repeatedly signal through metadata. Different second choices were already rejected. | Identical retries are true no-ops, with unchanged versions and actions. Different second choices are rejected. |
| Nested objects were not fully allowlisted | Player seats and board/outcome objects were returned directly; search/path/guess records used object spread. They did not contain extra secrets in today's state, but any future internal field would be serialized automatically. | Every nested object is explicitly reconstructed from approved fields. A regression test inserts secret sentinels into internal records and verifies none reach responses. |
| Private credentials accepted in desk fields | The HTTP resolver accepted a public seat ID **or** fell back to the raw input. A known private credential could therefore be used as a pass/search/guess desk reference. This did not bypass actor authentication or let players enumerate credentials, but mixed the two namespaces. | Desk fields accept only public seat IDs; private credentials and unknown IDs are rejected with a generic error. `keep` and `deliver` remain valid pass actions. |
| Old host commands could affect a later game | Pass/search/guess checked game and round, but start/settings/replay did not check game number. An old host replay request arriving during a later game-over could return that later game to the lobby. | Host lifecycle actions must match the current `gameNumber`, in addition to host and phase checks. |
| Role/seat randomness hardening | The HTTP adapter used the game module's default `Math.random`. No working prediction attack was established. | Production injects cryptographically secure server randomness. Tests inject a deterministic random source only through test-only factory parameters, never through HTTP. |

## Exact network envelopes

These envelopes apply to every role; there is no host-only full-state endpoint.

- `POST /.netlify/functions/game` with `op: "create"`: HTTP 201, `{ playerId, rejoinCode, view }`. `playerId` is the new player's own 256-bit bearer credential; `rejoinCode` is only their own 96-bit recovery key. No other credential is included.
- `POST /.netlify/functions/game` with `op: "join"`: HTTP 201, `{ playerId, rejoinCode, view }`, with the same rule. Join succeeds only in Lobby.
- `POST /.netlify/functions/game` with `op: "rejoin"`: HTTP 200, `{ playerId, rejoinCode, view }` for the seat matching the supplied room and private recovery key. Invalid keys receive only a generic error, not a role or view. Recovery works during active phases without redealing.
- `POST /.netlify/functions/game` with `op: "leave", code: "CODE"`: HTTP 200, `{ view }`, authenticated as that player. Reserves their seat and transfers host controls; no extra secrets are returned.
- `GET /.netlify/functions/game?op=view&code=CODE`: HTTP 200, `{ view }`, authenticated as that player.
- `POST /.netlify/functions/game` with `op: "action", code: "CODE"`: HTTP 200, `{ view }`, authenticated as that player, even if the action advances the phase.
- Rejections: `{ error }`; missing-room or invalid-session errors also carry `reset: true`. Validation messages contain no assignments, actual holder, private submissions, secret search target, credentials, or stack traces. Errors can mention the caller's missing permission, such as “Only the Snitch can search,” which reveals nothing beyond their own role.
- JSON responses use `Content-Type: application/json`, `Cache-Control: no-store`, and `X-Content-Type-Options: nosniff`, plus ordinary HTTP transport/date headers. There are no secret cookies, role-specific redirects, or full-state response headers.
- `/`, `/app.js`, `/style.css`, and `/favicon.svg` serve only common static assets. The script contains role names/rules, not room assignments. Game/server/test source and room storage have no static serving routes. No WebSocket, debug state, or analytics endpoint exists.

## Complete view schema, shared by Writer, Snitch and Classmate

Every successful view includes **all** of the following keys, including keys with null/empty values:

```text
view.code                         room code
view.phase                        lobby/reveal/pass/search/result/talk/guess/over
view.version                      public revision + only this player's private revision
view.serverTime                   server timestamp
view.deadline                     phase deadline, or null in lobby/over
view.round                        current round (0 before first deal)
view.gameNumber                   game counter (0 before first deal)
view.solo                         public timer-mode setting
view.players[].id                 public seat ID, never bearer credential
view.players[].name               public display name
view.players[].seat               null in lobby; otherwise { row, col }
view.players[].seat.row
view.players[].seat.col
view.players[].score              scores from before this game while active;
                                 updated scores only in over/lobby
view.players[].host               public host boolean
view.players[].connected          public connected/away boolean; no heartbeat timestamp
view.board                        null in lobby; otherwise the object below
view.board.seats[]                { row, col }
view.board.seats[].row
view.board.seats[].col
view.board.crush                   { row, col }
view.board.crush.row
view.board.crush.col
view.board.columns                grid width
view.me.id                        this player's public seat ID
view.me.name                      this player's name
view.me.host                      this player's host boolean
view.me.role                      own role while active; null in lobby/over
view.me.holdsNote                 only own possession boolean; false in lobby/over
view.me.moves[]                   own legal pass choices only in Pass; [] otherwise
view.me.submitted                 own locked pass in Pass; own chosen search only
                                 for Snitch in Search; null otherwise
view.submittedCount               aggregate count only in Pass; null otherwise
view.arrows[]                     latest publicly resolved passes only
view.arrows[].playerId            public ID of player drawing arrow
view.arrows[].move                public neighbor ID / keep / deliver
view.searches[]                   publicly resolved search history only
view.searches[].round
view.searches[].playerId           searched desk, NOT chooser
view.searches[].found              whether Teacher found the note
view.roundLog[]                    all publicly resolved rounds; no private actions
view.roundLog[].round
view.roundLog[].arrows[]            { playerId, move }, same public fields as arrows
view.roundLog[].arrows[].playerId
view.roundLog[].arrows[].move
view.roundLog[].search              null until resolved, or { playerId, found }
view.roundLog[].search.playerId     searched desk, NOT chooser
view.roundLog[].search.found
view.outcome                      null except guess/over; { winner, reason }
view.outcome.winner                students/snitch
view.outcome.reason                public ending explanation
view.reveal                       null until over; object below only in over
view.reveal.roles[]                { id, role, snitchGames, writerGames }
view.reveal.roles[].id             public seat ID
view.reveal.roles[].role
view.reveal.roles[].snitchGames    completed/current session role counts
view.reveal.roles[].writerGames
view.reveal.path[]                 { round, from, to }, including start and keeps
view.reveal.path[].round
view.reveal.path[].from            public seat ID; null for starting entry
view.reveal.path[].to              public seat ID / deliver
view.reveal.holder                 public final-holder ID / deliver
view.reveal.guess                  null if no bonus phase; otherwise { playerId, correct }
view.reveal.guess.playerId         guessed public ID; null for a timed-out guess
view.reveal.guess.correct
```

No `players[].role`, `players[].holdsNote`, `snitch`, `writer`, global `holder`, private `actions`, pending `target`, search chooser, internal credential, internal revision counter, or full game record is transmitted during an active game.

## Every phase, for every role

Each row includes the full common schema above; this table specifies its phase-dependent values. “Own possession” never includes another player's possession. The Snitch's own possession stays false during active phases because receipt immediately ends the game.

| Phase | Common/public values | Writer's private fields | Snitch's private fields | Classmate's private fields |
| --- | --- | --- | --- | --- |
| Lobby | Seats/board null; deadline null; arrows/searches empty; outcome/reveal/submittedCount null; existing session scores | No role yet: role null, holdsNote false, moves [], submitted null | Same | Same |
| Role reveal (`reveal`) | New seats/board, reveal deadline, round 1; arrows/searches empty; outcome/reveal/submittedCount null | role Writer; holdsNote true; moves []; submitted null | role Snitch; holdsNote false; moves []; submitted null | role Classmate; holdsNote false; moves []; submitted null |
| Pass | Pass deadline; aggregate submittedCount; arrows/searches from earlier resolved rounds only; outcome/reveal null | role Writer; own possession; own legal moves; own submitted move or null | role Snitch; holdsNote false; own legal moves; own submitted move or null | role Classmate; own possession; own legal moves; own submitted move or null |
| Search | All current round arrows revealed; only earlier resolved searches; pending target absent; outcome/reveal/submittedCount null | role Writer; updated own possession; moves []; submitted null | role Snitch; holdsNote false; moves []; submitted own search target or null | role Classmate; updated own possession; moves []; submitted null |
| Search result (`result`) | Current missed search joins public history; outcome/reveal/submittedCount null | role Writer; own possession; moves []; submitted null | role Snitch; holdsNote false; moves []; submitted null | role Classmate; own possession; moves []; submitted null |
| Talk | Same revealed arrows/search history; discussion deadline; outcome/reveal/submittedCount null | role Writer; own possession; moves []; submitted null | role Snitch; holdsNote false; moves []; submitted null | role Classmate; own possession; moves []; submitted null |
| Bonus Writer guess (`guess`) | Public student-delivery outcome, arrows/history, guess deadline; reveal/submittedCount null; scores still frozen before award | role Writer; holdsNote false; moves []; submitted null | role Snitch; holdsNote false; moves []; submitted null. Can guess using public roster. | role Classmate; holdsNote false; moves []; submitted null |
| Game over (`over`) | Outcome; roles, final holder, actual path and guess result disclosed; scores updated; deadline/submittedCount null | role null; holdsNote false; moves []; submitted null | Same | Same |

Search hits and interceptions skip directly to Over. Delivery skips Search and goes to Guess; Writer identity is still hidden until Guess finishes. At Play again, the new lobby hides prior deal fields, while retaining public session scores. A new deal replaces all previous path/action/history state.

## Action authorization: before/after and evidence

| Attempt | Before | After / test result |
| --- | --- | --- |
| Non-holder submits pass or Deliver | Accepted intentionally as a fake; did not move real note | Same rule. Tested fake delivery plus spoofed `holder`/`playerId` payload: real note remained with actual holder and no delivery win occurred. Rejecting non-holder passes would break the game and create a possession oracle. |
| Non-Snitch searches or guesses | Rejected on server | Still rejected, including requests that claim the Snitch's ID in the body. Actor comes from authenticated Authorization, not payload. |
| Change a locked pass/search | Rejected | Still rejected. Identical retry now changes no state or version. |
| Submit a second Writer guess | First valid guess ends game; later guess rejected | Same; repeated guess cannot award another point. |
| Make illegal/non-neighbor move | Rejected | Still rejected; private credentials also rejected as desk IDs at transport boundary. Empty desks and Crush cannot be search targets. |
| Act outside phase or after deadline | Rejected after advancing server time | Same. Client clock cannot extend deadline; exactly at deadline action is closed. |
| Replay an earlier game/round pass/search/guess | Rejected | Same. Old host lifecycle commands now also rejected by game number. |
| Authenticate using another player's public ID or room code | Rejected | Same; 256-bit private credential required. Public IDs cannot retrieve another view. |
| Simultaneous relay A→B→C | Note stopped at B | Same; only starting holder's selected action is resolved once. |

## Intended deductions flagged separately

- A former holder knows their own chosen destination and can infer the next holder. Public arrows can extend that inference. This is inherent in the designed rules.
- A missed search publicly rules out its searched desk at that moment. A successful search reveals possession only when it also ends the game.
- Public arrows can collapse candidate note paths; Keep/Deliver arrows are indistinguishable between real and fake actions until an outcome occurs.
- During Guess, the public delivery outcome reveals that the note is at the Crush. It does not disclose the Writer, other roles, the real prior path, or the Snitch's identity.
- Prior game roles and scores are already public. Soft rotation makes some next roles more likely but does not force an exact assignment.

These are permitted game deductions, not fields accidentally containing secrets. Removing them would require changing the agreed rules.

## Verification and deployment

`npm test`: **19 passing tests**. Actual HTTP tests exercise every active phase for Writer, Snitch and Classmate, plus Lobby and Over, for 4/5/6 players. They validate envelopes, view key allowlists, missing credentials, non-Snitch actions, spoofed actors, fake delivery, raw-credential desk references, private-search metadata noninterference, retries, scoring, full path, and stale host commands. Existing tests cover interception, Teacher search hits, round limit, offline catch-up, deadline edges, legal routing and replay. Extra-field sentinel tests cover nested allowlists including the round log. Additional complete 4/6-player sessions exercise recovery keys, refresh, disconnected holders, immediate and grace-period host handoff, six rounds of timeout defaults, public log consistency and replay.

The local server was restarted to activate fixes. Rooms are in memory and are cleared on restart. No UI or game-rule changes were needed. For serverless deployment, the adapter must preserve atomic advance/action/view transactions; its current synchronous mutation is safe within this single local process.

Browser tab isolation uses sessionStorage for only that tab's own credential/code/public ID. BroadcastChannel messages contain public IDs and instance IDs, never roles, possession, credentials, or full views. A user controlling all test tabs can of course read their respective secrets; credential theft/device compromise and deliberate sharing are outside this server-response boundary.
