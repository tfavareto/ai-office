# 2D world spec (default visual) — packages/web/src/world2d

## Art direction
Premium corporate office in crisp **pixel art**, three-quarter top-down view (floors seen from above, north walls show
their face, south walls are low cut-away ledges so rooms stay visible). Integer zoom only (1x-6x, nearest-neighbour),
base tile 16 px. Palette: warm walnut wood, white/beige marble, brushed brass/bronze accents, graphite metal, glass
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
  list of who is there), whiteboard, glass wall with door to the corridor (frosts when in use), plants.
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

## Characters (2D)
Pixel-art people ~ 14x26 px at 1x, 4 directions, walk cycle (4+ frames), sit/type, stand, raise hand, drink coffee,
celebrate, sleep. Diversity: skin tones, hair styles/colors, men in suits (shirt + tie colors), women in blazers/
blouses/skirts or suits; deterministic from the agent seed + look. Subagents wear a small badge. Account color shows
as a thin ring at the feet / name tag accent.

## Performance (hard requirements)
- 60 fps at 2x zoom with 40 agents and 12 rooms on a MacBook Air-class machine.
- Static layers (exterior, building shell, each room) pre-rendered into offscreen canvases, rebuilt only when the
  layout changes; per frame draw: layers (culled to the viewport), characters (y-sorted), overlay.
- No allocation-heavy work per frame; sim tick fixed at 30 Hz decoupled from render.

## World API
Implement `createWorld2D(container, opts): WorldApi` from `packages/web/src/world/api.ts` (do not change that file
without updating every implementation).
