# 2D world spec (default visual) — packages/web/src/world2d

## Art direction
Premium corporate office in crisp **pixel art**, three-quarter top-down view (floors seen from above, north walls show
their face, south walls are low cut-away ledges so rooms stay visible). Nearest-neighbour rendering (never smoothed above one device pixel per art
pixel), base tile 16 px. Zoom is continuous from the cover zoom up to 6x; buttons and keys step through crisp levels. Palette: warm walnut wood, white/beige marble, brushed brass/bronze accents, graphite metal, glass
partitions with a frosted band, soft green plants, warm 3000 K lighting at night, navy/teal LED accents. Calm, rich,
detailed, never cartoon-cheap. Everything is drawn procedurally in code (no external sprite sheets) into cached
offscreen canvases.

Reference furnishing per area (all must be recognizable at 2x zoom):
- **Recepção** (north, col 0): marble floor, reception desk with brass edge and logo "AI Office" wall sign, two
  elevators on the north wall (people arrive/leave through them), waiting sofa, plants, entrance glass doors to the
  west street side.
- **Copa** (north, col 1): porcelain tile floor, kitchen counter with coffee machine, fridge, vending machine, café
  menu board, high tables with stools, round tables with chairs.
- **Sala de reunião** (north, col 2): wood floor, long meeting table with 12-14 chairs, big wall TV (shows a live
  list of who is there), whiteboard (the live task board: three counters in marker colors and the first two tasks in
  progress; clicking it opens the task board panel), glass wall with door to the corridor (frosts when in use), plants.
- **Banheiros** (south, col 0): tiles, stalls, sinks with mirrors.
- **Lounge** (south, col 1): herringbone parquet, sofas + coffee table, TV, ping-pong table, bean bags, bookshelf,
  arcade cabinet.
- **Corredor** (between rows): light stone floor, runner rugs, LED ticker strip along the north edge (market/news
  style marquee), water coolers, benches, tall plants; glass façades at both ends.
- **Project room** (10 x 12 tiles each): accent wall with walnut slats and the room's color LED, a sign with the
  project name, wall board/TV with the room's task list, a desk island with up to 6 workstations (desk + office chair +
  **4 monitors** showing activity-colored content), binder shelf, plants, door to the corridor. Room color/theme
  derived from the project seed (carpet tint, accent).
- **Outside**: street with sidewalk, crosswalk, cars driving, trees, lamp posts (lit at night), other buildings'
  rooftops as a frame. Keep it a modest frame around the building (the office is the subject).

## Floor plan (tiles)
Core columns are 16 wide; project rooms 10 wide; rows 12 tall; corridor 5 tall between them. North row: Recepção,
Copa, Sala de reunião, then project rooms. South row: Banheiros, Lounge, then project rooms. Project slots fill the
row that ends first (south starts right after the Lounge, north after the meeting room), so both rows end almost
aligned; the leftover at the east end is closed by an exterior wall with a small terrace. The building grows/shrinks
east as projects open/close. When a project closes, the farthest room moves into the freed slot (animated: people
walk over), so there are no holes.

## Simulation (pure TS, deterministic with seeded RNG, testable without canvas)
- Grid pathfinding (A* on walkable tiles, 4/8-dir with corner rules), smooth movement along paths, door tiles.
- Spots: desk seats, meeting seats, café stools/tables, lounge sofas, waiting sofa, standing spots, talk groups.
- Behaviour by status: **working** sits at its desk typing (subagents work at the meeting table, or at a free desk in
  their project room if it is full); **waiting** stands up at the desk with a raised hand and a "!" badge (alert
  bubble "Needs you", localized); **idle** after a while walks to the copa (coffee), lounge (sofa/ping-pong/arcade) or
  chats with others, then returns; **shell running** leans back watching the screen (stages after 1, 3, 8 min:
  stretching, popcorn, napping); **done/offline** walks to the elevator and leaves. New agents arrive by elevator.
- Speech bubbles from activities (filtered by setting: all / important / none), name tags, status rings, selection
  ring, hover highlight. Bubbles are rationed to avoid clutter (max per room, priority by importance/recency).
- Room lifecycle: build-in animation when a project room appears (floor, walls, furniture popping in), lights go off
  and the room dismantles when it closes.
- Day/night: by local time (or forced). Night darkens outside, windows glow, rooms with people are lit (warm light
  pools), lamp posts and car headlights glow.

## Work animations, celebrations and encounters
All of this lives in the simulation (`sim/**`, pure and seeded) and reaches the renderers as `Character` fields and a queue of effects.

**What people are doing** (`sim/work.ts`). `workMood(agent, ctx)` maps the latest activity to a `WorkMood`: `reading` (Read, Grep, Glob: a page held up in both
hands, eyes sweeping along the lines), `typing` (Edit and Write sit in `typeFast`: fast hands and tiny code glyphs rising from the desk), `terminal` (Bash or a
foreground shell: leaning back, one hand drumming, a flickering green glow at the screen; after 1, 3 and 8 minutes it stretches and yawns, eats popcorn and
naps), `web` (WebFetch and WebSearch: a small globe pulsing over the head), `thinking` (a thought bubble with animated dots, a hand on the chin),
`delegating` (a Task or a subagent at work: an arm out and a yellow arrow toward the meeting room), `waiting` (hand raised, "!" badge and an amber pulse
ring at the feet) and `frustrated` (two or more errors among the last six activities, the latest less than 90 s old: scratching the head, a "?" and a puff).
A working person with no activity yet just types. Idle people at the desk stretch and yawn now and then (rarely when calm).

**Triggers** (`sim/triggers.ts`). `TriggerTracker.update(snapshot)` compares consecutive snapshots and returns what is worth a party: `tests-fixed` (a test
command, matched on the Bash command, failed and then the next one passed), `tasks-done` (the task list became fully completed), `commit` (a `git commit`
without an error after it, or a new `lastCommit` of the room's repository), `pr-merged` (the pull request of the room's branch went to `merged`),
`subagent-done` (a subagent left with status `done` and no error as its last activity) and `streak-end` (a main agent went from working to idle after a turn of
4 minutes or more; 25 s in demo mode). A command whose result is not known yet waits for the next activity: an error of Bash means it failed, anything else
that it passed, and a turn ending counts as a pass. The first snapshot, and the first one after `resetScene()`, only primes the tracker.

**Rationing** (`sim/celebrations.ts`). `CelebrationBook.request` grants or refuses a trigger: the same trigger of the same person is one event (20 s), a
person celebrates again after 60 / 30 / 14 s (calm / normal / lively) unless the new event matters more (`pr-merged` > `tasks-done`, `streak-end` >
`tests-fixed`, `subagent-done` > `commit`), two celebrations anywhere are 3 / 1.6 / 0.9 s apart, a window of 12 s holds at most 2 / 4 / 6, and a room gets a shower once
every 90 s. When the last open task of a room is completed (`roomMilestone`: at least three tasks, all done) the celebration is a **room-wide confetti shower**.

**A celebration** (`sim/party.ts`): a "party" lasts 2.4 s: the person stands and jumps with raised arms (`celebrate`, 4 frames), a green bubble with 🎉 and a
localized line (`bubble.celebrate.*`: "Testes passando!", "Tudo pronto!", "Commitado!", "Merge feito!", "Missão cumprida!", "Sessão concluída!"), a burst of pixel
confetti, and up to three idle colleagues of the same room within 9 tiles stand, face them and clap. The simulation puts the burst, shower, spark and sound
requests in an `EffectQueue` that the world takes once per frame (`takeEffects()`); the sound goes through `world/celebration-bus.ts` to the page, which plays a short
Web Audio arpeggio (no files; a longer one for big events) only when sounds are on and Do not disturb is off. With **reduced motion** there are no particles, jumps
or sparkles: a still star badge stays over the person for 3.5 s instead. **Settings → Celebrations** (`celebrations`, on by default) turns all of this off;
the animation level scales the confetti (0.6 / 1 / 1.4).

**Confetti** (`world2d/fx/confetti.ts`): a pool of 900 particles in typed arrays (no allocation while it runs), gravity, drag and flutter, 1.5–2.5 s of life with
a fade, palette of eight colours, drawn as 3x1 to 5x3 px rectangles that tumble between thin and wide, batched by colour, in the world pass after the lighting so it
stays bright at night. Bursts start at the chest and cone upward and outward; showers fall from the top of the room for 2.8 s. A high five throws a few sparks.

**Encounters** (`sim/encounters.ts` decides, `sim/runner.ts` walks). `EncounterDirector` is pure and deterministic for its seed: a **handshake** between a main agent and its
subagent when the subagent sits down in the meeting room and again, when the main agent is free and within 18 tiles, as it leaves; a **check-in** where a working main
agent walks to its working subagent (at most once every 180 / 90 / 45 s, 45 % of the polls); a **high five** when two people of the same room celebrate within 8 s of each
other (they meet halfway); a **wave** when two people walking in opposite directions cross in the corridor (they stop for 1.1 s). At most one encounter starts every
12 / 6 / 3 s. The runner sends the walkers along the usual paths (`toMeet`, `meeting` phases), starts the greeting for both once both are in place, and **cancels everything
the moment real work calls**: a person who needs the user, a partner who leaves, a layout change or 28 s without arriving send everybody back to their place. Idle people
also chat in pairs at the pantry, the corridor and the lounge with one **icon-only bubble** per turn (💬 ☕ 😄 🤔 👍 💡: no invented words), and play ping-pong with an
animated ball (`sim/pingpong.ts`: `ballAt(table, t)` is shared by 2D and 3D, the ball rests on the table when nobody plays). Encounters are off with reduced motion.

## Characters (2D)
Pixel-art people ~ 14x26 px at 1x, 4 directions, walk cycle (4+ frames), sit/type, stand, raise hand, drink coffee,
celebrate, sleep, and the poses of the work moods, reactions and greetings (`readDoc`, `typeFast`, `think`, `point`, `scratch`, `clap`, `highfive`, `shake`, `wave`;
`stretch` has a yawning frame). Diversity: skin tones, hair styles/colors, men in suits (shirt + tie colors), women in blazers/
blouses/skirts or suits; deterministic from the agent seed + look. Subagents wear a small badge. Account color shows
as a thin ring at the feet / name tag accent.

## Branch plaque
A project room whose folder is a repository (`Project.git`) and `WorldOptions.showGit` hang a 40x7 px plaque right under the room sign
(`runtime/plaque.ts`, drawn by the renderer's dynamic pass and cached per room by `roomGitKey`): a brass-framed dark plate with a
marker (green clean, amber uncommitted work, red conflicts or a rebase/merge/... in progress), the branch (or detached commit) in the 3x5
pixel font fitted to the plate (`fitBranch`: whole, else without its first segment such as `feat/`, else cut with a dot; accents fold to
the font's letters) and, at the right end, a 3x3 CI light (green, red or amber) while the branch has an open pull request. Rooms that are
not repositories get no plate. The room pill shows the branch (starred when dirty) instead of the agent count while the room is hovered
or selected. Nothing here changes the static layers or the cost of a frame.

## Performance (hard requirements)
- 60 fps at 2x zoom with 40 agents and 12 rooms on a MacBook Air-class machine, confetti included (measured: about 4 ms of drawing per frame with 40 agents and several bursts).
- The activity marks are procedural (`fx/activityFx.ts`, glyph bitmaps cached in `fx/glyphs.ts`); the confetti pool never allocates while it runs.
- Static layers (exterior, building shell, each room) pre-rendered into offscreen canvases, rebuilt only when the
  layout changes; per frame draw: layers (culled to the viewport), characters (y-sorted), overlay.
- No allocation-heavy work per frame; sim tick fixed at 30 Hz decoupled from render.

## World API
Implement `createWorld2D(container, opts): WorldApi` from `packages/web/src/world/api.ts` (do not change that file
without updating every implementation).

`WorldApi.resetScene()` (`OfficeSim.reset`) drops every person, spot and room so the next snapshot is placed at once, and `WorldApi.setClock(at)` feeds `DayNight` an instant of a time-lapse (see [04-ui.md](04-ui.md#time-lapse-mode)); `setClock(null)` returns to the real clock.

`WorldApi.capture({ width, height, mode: 'overview' | 'current', showProjectNames? })` returns a canvas of exactly that size with a still of the office, for the share card. It never draws from the live scene: `world/capture.ts` (`captureSnapshot`, pure) copies the last snapshot keeping only rooms, people, status, kind of activity and colours (project names are replaced by `room.generic`, "Room 1", unless `showProjectNames`; paths, titles, task and activity texts, branches, permissions and hires are dropped), `capture2d` builds a throwaway `OfficeSim` from it (settled for one second), draws it with a new `Renderer` and the same layers and lighting as the live world, at the `night` amount on screen, without the overlay (no name tags, bubbles or pills). `overview` frames the whole building with a margin (`overviewFraming`); `current` shows the region the live camera shows, scaled to fit (`currentFraming`). When the picture needs a zoom above 1 the art is drawn at the next whole zoom and scaled down with smoothing (`renderPlan`), so the pixels stay square; below 1 it is drawn at the fit itself. The live camera, canvas and caches are not touched. The pure framing math is in `captureFraming.ts` (tested). The dev harness (`dev/world2d.html?capture=1&cw=1200&ch=630&cmode=overview&names=1`) shows a capture and exposes `window.__capture`.

## Camera
- The visible area is always covered by the drawn world: the minimum zoom is the zoom at which the world (the building plus
  its city frame) covers the whole canvas, and panning is clamped to the world edge. The city frame is large enough
  (several rows of blocks, a wide park) for that to hold on wide and tall windows and for wide buildings.
- Wheel and trackpad pinch zoom continuously around the cursor and ease toward the target (exponential, frame-rate
  independent). Buttons and `+`/`-` step through the crisp levels around the middle of the free area in about 200 ms.
  `prefers-reduced-motion` makes every camera move instant. The camera translation snaps to device pixels.
- The overview ("Visão geral", `O`) frames the building inside the free area (between sidebar, drawer, top bar and feed).
- Selecting an agent (sidebar, map click) pins that person to the middle of the free area at a comfortable zoom. The pin
  is resolved every frame with the insets of that frame (eased), so a drawer opening after the focus started cannot leave
  the person off-centre. The camera tracks the person while the focus settles and while Follow is on; dragging or key
  panning stops the tracking until Follow is toggled or something else is selected.
