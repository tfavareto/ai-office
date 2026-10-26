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

**A celebration** (`sim/party.ts`): a "party" lasts 2.4 s: the person stands, turns to the camera so the arms read and jumps with raised arms (`celebrate`, 4 frames plus a
7 px lift drawn by the renderer, `jumpLift`), their name tag steps aside, a green bubble with 🎉 and a localized line (`bubble.celebrate.*`: "Testes passando!", "Tudo pronto!",
"Commitado!", "Merge feito!", "Missão cumprida!", "Sessão concluída!") hangs right above their head (never pushed into the corridor), a flash ring runs out on the floor, confetti bursts, and up
to four idle colleagues of the same room within 12 tiles stand, turn to the camera and clap (with little sparks between the hands). A room-wide milestone hangs its own bubble
(`bubble.celebrate.room`, "Sala toda em dia!", `anchor: 'room'`) in the middle of the room. The simulation puts the burst, shower, spark and sound
requests in an `EffectQueue` that the world takes once per frame (`takeEffects()`); the sound goes through `world/celebration-bus.ts` to the page, which plays a short
Web Audio arpeggio (no files; a longer one for big events) only when sounds are on and Do not disturb is off. With **reduced motion** there are no particles, jumps
or sparkles: a still star badge stays over the person for 3.5 s instead. **Settings → Celebrations** (`celebrations`, on by default) turns all of this off;
the animation level scales the confetti (0.6 / 1 / 1.4).

**Confetti** (`sim/confettiPlan.ts` plans, `world2d/fx/confetti.ts` throws): a burst is two cannons at the person's sides firing inward and up plus a half-second fountain, about 190
pieces at the normal level (more for milestones), made of tumbling pieces (2–4 px, a sliver edge-on and a square face-on), twirling streamers and twinkling stars; the pieces get up to
2.2 times bigger when the camera is zoomed out (`pieceScale`) so they read at the overview. A pool of 1400 particles in typed arrays (no allocation while it runs), gravity, drag and flutter,
1.5–2.5 s of life with a fade, eight colours, batched by colour, drawn in the world pass after the lighting so it stays bright at night. Showers fall from the top of the room for 2.8 s with the
same mix. A high five throws a few sparks.

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

## Looks and room finishes
What the person chose (see [00-product.md](00-product.md#personalization) and [02-server.md](02-server.md#customization-apicustomization)) arrives in the snapshot as `Agent.appearance` and `Project.theme`.
- **Looks.** `chars/looks.ts`: `lookFor(seed, gender, badge, appearance?)` draws the look from the seed exactly as before (every random draw is unchanged) and then puts the choices on top (`withAppearance`): skin, hair color and outfit from the shared palettes (the outfit is the jacket; trousers follow it), the hair style as one of four cuts per look (`SPRITE_HAIR_STYLES`; `6` is the round, full cut only a choice gives), and the accessory: glasses, headphones (band and ear cups) or a cap in the outfit color; `none` also removes the glasses the seed gave. The cache key (`Look.key`, `Renderer.lookOf`) includes `lookSignature(appearance)`, so only the people whose look changed are drawn again. `World2D.previewPortrait` draws a look nobody wears yet for the editor.
- **Room finishes.** `layout/project.ts`: `themeWith(base, theme)` puts the color (accent, hue and carpet tint), the floor (`tiles` is the porcelain, `concrete` the stone), the wall finish, the plant density and the sign style on top of `projectTheme(seed)`; `RoomSpec.theme` carries them from `RoomManager` (which reads `Project.theme`). Plants: `few` removes every plant of the room, `lush` adds one at each lane edge (the random draws of the room are unchanged, a test keeps every desk reachable). The sign is a wall item whose `variant` is the style (0 brass, 1 neon tube, 2 engraved wood, 3 plain plate: `paint/wallitems.ts`); `paint/walls.ts` paints the wall finishes (wood slats, smooth plaster tinted by the room color, brick, concrete with panel seams).
- **Caches.** `areaKey` includes the whole theme and the furniture, so changing one room's finishes redraws that room's layers and no other.
- **Arrangement.** `OfficeSim` receives the snapshot as the page arranged it (`layout/arrange.ts`: hidden rooms and their people are gone, `order` is the slot). Without pinned or ordered rooms `RoomManager` behaves as it always did (lowest free slot, compaction by walking). With them (`arranged`) every room takes the slot of its place (`settle`): at once, with no animation, only the rooms whose slot changed, and only while no room is being dismantled; people sitting in a moved room are seated at their desks in the new place (`RoomMove.instant`). A room hidden or closed is dismantled as before and its people leave by the elevator.

## Branch plaque
A project room whose folder is a repository (`Project.git`) and `WorldOptions.showGit` hang a 40x7 px plaque right under the room sign
(`runtime/plaque.ts`, drawn by the renderer's dynamic pass and cached per room by `roomGitKey`): a brass-framed dark plate with a
marker (green clean, amber uncommitted work, red conflicts or a rebase/merge/... in progress), the branch (or detached commit) in the 3x5
pixel font fitted to the plate (`fitBranch`: whole, else without its first segment such as `feat/`, else cut with a dot; accents fold to
the font's letters) and, at the right end, a 3x3 CI light (green, red or amber) while the branch has an open pull request. Rooms that are
not repositories get no plate. The room pill shows the branch (starred when dirty) instead of the agent count while the room is hovered
or selected. Nothing here changes the static layers or the cost of a frame.

## Unlockable decoration
The office grows with the level in the snapshot (`progress.level`, see [00-product.md](00-product.md) and [02-server.md](02-server.md#progress-apiprogress)); `WorldOptions.evolution` (Settings → Office evolution) switches all of it off. Nothing here changes the walkable grid, the spots or the simulation.
- **In the layout.** `layout/decor.ts` holds one table of slots (pure, shared with the 3D world, tested): framed art on the reception, copa and meeting walls (wall items of kind `frame`), a neon sign on the copa wall (`neon`), the employee plaque on the lower row of the reception desk, right of the brass "AI OFFICE" plate (`plaque`), a trophy cabinet in the reception (`trophyCabinet`), an aquarium and two more arcade machines in the lounge (`aquarium`, `arcade` variants 2 and 3) and the garland of the corridor in segments of eight tiles (`lights`). `computeBuilding` attaches them to every layout tagged with `decor` (`DecorId`); they block nothing, stand on free floor kept clear of seats, doors and elevator fronts (a test asserts it) and the renderer draws an item only when `isDrawn` (its decoration is unlocked).
- **What unlocks when** (`DECOR_LEVELS` in shared): wall art 2, plaque 3, aquarium 4, trophy cabinet 5, the cat 6, neon sign 7, arcade 8, garland 9, gold finish 10 (cabinet, plaque, frames and sign turn gold).
- **Painters.** `paint/furnDecor.ts` draws them in the existing pixel style and palette: the aquarium (stand, glass tank, sand, plants), the cabinet with the cups of `Evolution.cups` (bronze, silver, gold; one cup per two achievements, up to eight), the plaque (brass or gold plate, the name in the 3x5 font between two stars when short, at most seven letters, accents folded), amber and violet arcade machines, the garland (catenary and bulbs) and the wall pieces. Sprites are cached by what they show. The static area layers carry the decoration; an area that holds decoration is redrawn when the `evolutionKey` changes (a level, the employee, the cups), the others are left alone.
- **Life.** `runtime/decorAnim.ts`: two fish and bubbles in the aquarium (still with reduced motion) and, at night, the additive glow of the neon sign (a faint flicker), the aquarium, the arcade machines, the cabinet and every bulb of the garland.
- **The cat.** `world/pet.ts` (pure, shared with 3D, tested): `OfficePet` wanders over its own copy of the grid (decoration blocked) between hubs (free floor in the shared rooms and the corridor, away from seats, doors and lifts), walking at about one tile a second along `findPath`, then sits, grooms or sleeps for 7 to 22 seconds. It is only drawn (`chars/petSprite.ts`: orange tabby, side, front and back views, walk, sit, groom and sleep frames), before the people, so it never takes a seat, blocks a path or changes a route. Reduced motion: it sleeps where it is.
- **Share card.** `captureSnapshot` keeps the level (so the picture shows the decoration) and drops the employee's name and the unlock list.

## Performance (hard requirements)
- 60 fps at 2x zoom with 40 agents and 12 rooms on a MacBook Air-class machine, confetti included (measured: about 4 ms of drawing per frame with 40 agents and several bursts).
- The activity marks are procedural (`fx/activityFx.ts`, glyph bitmaps cached in `fx/glyphs.ts`); the confetti pool never allocates while it runs.
- Static layers (exterior, building shell, each room) pre-rendered into offscreen canvases, rebuilt only when the
  layout changes; per frame draw: layers (culled to the viewport), characters (y-sorted), overlay.
- The city is one cached canvas that is blitted only where it is visible; per frame it costs the blit and the driving cars (culled
  to the view): about 0.1 ms, plus about 0.25 ms of lamps and headlights at night. Its cost is the rebuild, which happens on every
  new room: the ground speckle (asphalt, alleys, lawn, roofs) is batched into two path fills per surface instead of one `fillRect`
  per pixel and the colours are resolved once, which took the rebuild of a 4-room office from about 150 ms to about 40 ms (12 rooms
  from about 200-330 ms to about 65 ms) with the same pixels.
- No allocation-heavy work per frame; sim tick fixed at 30 Hz decoupled from render.

## World API
Implement `createWorld2D(container, opts): WorldApi` from `packages/web/src/world/api.ts` (do not change that file
without updating every implementation).

`WorldApi.previewPortrait(person, appearance, size)` returns the portrait of a look nobody wears yet (the live preview of the customization editor; `portrait(agentId, size)` of an agent in a hidden room is drawn the same way by `WorldHost`).

`WorldApi.resetScene()` (`OfficeSim.reset`) drops every person, spot and room so the next snapshot is placed at once, and `WorldApi.setClock(at)` feeds `DayNight` an instant of a time-lapse (see [04-ui.md](04-ui.md#time-lapse-mode)); `setClock(null)` returns to the real clock.

`WorldApi.capture({ width, height, mode: 'overview' | 'current', showProjectNames? })` returns a canvas of exactly that size with a still of the office, for the share card. It never draws from the live scene: `world/capture.ts` (`captureSnapshot`, pure) copies the last snapshot keeping only rooms, people, status, kind of activity and colours (project names are replaced by `room.generic`, "Room 1", unless `showProjectNames`; paths, titles, task and activity texts, branches, permissions and hires are dropped), `capture2d` builds a throwaway `OfficeSim` from it (settled for one second), draws it with a new `Renderer` and the same layers and lighting as the live world, at the `night` amount on screen, without the overlay (no name tags, bubbles or pills). `overview` frames the whole building with a margin (`overviewFraming`); `current` shows the region the live camera shows, scaled to fit (`currentFraming`). When the picture needs a zoom above 1 the art is drawn at the next whole zoom and scaled down with smoothing (`renderPlan`), so the pixels stay square; below 1 it is drawn at the fit itself. The live camera, canvas and caches are not touched. The pure framing math is in `captureFraming.ts` (tested). The dev harness (`dev/world2d.html?capture=1&cw=1200&ch=630&cmode=overview&names=1`) shows a capture and exposes `window.__capture`.

## Camera
- The visible area is always covered by the drawn world, and panning is clamped to the world edge. The zoom range ends
  **one step below the overview**: the minimum zoom is the overview zoom divided by `ZOOM_OUT_STEP` (1.25, the factor of the `-`
  button and key), or the cover zoom of the world when that is larger (`minZoomForView`). A building that already fills the window
  at the smallest zoom level (0.5) gets no further step (`zoomOutFloor`). The wheel, the pinch and the buttons stop there; the
  drawn zoom eases toward the target and only the cover zoom is a hard limit, so a floor that moves (a panel opening or closing
  changes the overview) is reached smoothly.
- **The city is sized from that rule** (`world2d/cityMargins.ts`, pure, tested). `cityMargins(buildingTiles, window)` replays the
  camera for the canvas size and the device pixel ratio, with the sidebar open and closed, and takes the largest distance the
  canvas reaches beyond each side of the building at the lowest zoom. That is the margin of that side in tiles, plus the cover slack
  and two tiles of safety, in steps of 4 tiles and never below 16 (the street frame needs 12). It works for any window, 4:3 to 21:9
  and beyond. `LayerCache.setWindow` hands it the canvas size; the window only grows, so shrinking and enlarging a window again never
  rebuilds the city, and a rebuild happens only when a margin moves up a step (a new room, a bigger window). Stills (share card) use a
  large reference window. A 4-room office in a 1440x830 window gets a 135 x 73 tile world (was 130 x 121); the drawer and the expanded
  feed only shrink the free area further, and then the cover zoom holds the camera. `layoutExterior(width, margins)` takes the margins;
  the 3D city keeps `WIDE_EXTERIOR_MARGINS`. Blocks of neighbours (rows north and south, columns west) are added to reach the margins,
  and rooftops wholly outside the world are not generated.
- Wheel and trackpad pinch zoom continuously around the cursor and ease toward the target (exponential, frame-rate
  independent). Buttons and `+`/`-` step through the crisp levels around the middle of the free area in about 200 ms.
  `prefers-reduced-motion` makes every camera move instant. The camera translation snaps to device pixels.
- The overview ("Visão geral", `O`) frames the building inside the free area (between sidebar, drawer, top bar and feed).
- Selecting an agent (sidebar, map click) pins that person to the middle of the free area at a comfortable zoom. The pin
  is resolved every frame with the insets of that frame (eased), so a drawer opening after the focus started cannot leave
  the person off-centre. The camera tracks the person while the focus settles and while Follow is on; dragging or key
  panning stops the tracking until Follow is toggled or something else is selected.
