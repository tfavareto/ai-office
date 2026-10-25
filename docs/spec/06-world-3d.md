# 3D world spec (optional visual) — packages/web/src/world3d

Implements the same `WorldApi` with three.js (r180+), lazy-loaded (dynamic import) only when the user picks 3D.
Same floor plan and simulation as 2D (reuse the 2D sim module: positions, paths, spots, statuses); only the rendering
differs. Premium corporate interior: walnut, marble, brass, glass partitions with frosted band, slatted accent walls,
pendant/linear lights, plants, 4 monitors per desk with live canvas content, room board TV, meeting room TV, a whiteboard that shows the live task board (counts per column and the first three tasks in progress,
fitted to the language; clicking it opens the task board panel), café menu
board, corridor LED ticker, lounge furniture. Office on a high floor of a glass tower with a compact city frame
(streets, cars, trees) around. Isometric orthographic camera by default (pan/zoom/overview), plus first-person walk
(WASD, drag to look, E opens the agent in sight, N message, M minimap, Esc exit) and an over-the-shoulder camera.
Day/night with sun, sky and warm interior lights; bloom only at night.

People: realistic CC0 human models (glTF under `packages/web/public/assets/3d/humans`, MakeHuman CC0) with procedural
pose blending (walk cycle, sit/type, raise hand, talk gestures, look at speaker), outfits tinted per agent. Furniture/
plants: CC0 glTF models under `public/assets/3d/{furniture,plants}` (Poly Haven CC0) plus procedural parts; textures
under `public/assets/3d/textures` (Poly Haven CC0). City: Kenney CC0 kits under `public/assets/3d/city`.

Work animations, celebrations and encounters come from the same simulation as in 2D (see [03-world-2d.md](03-world-2d.md#work-animations-celebrations-and-encounters)). In 3D each new `Pose`
has a procedural solver in `pose/poses.ts` (`typeFast`, `readDoc` with a page held in both hands via two-bone IK, `think` and `scratch` with a hand reaching the chin or the head,
`point`, `wave`, `clap`, `highfive`, `shake`; `celebrate` is a jump on every beat with arms thrown up and a sway; `lean` drums its fingers). `characters/personFx.ts` gives each person a few
camera-facing sprites that are not rotated with the body: code glyphs rising from the desk, the thought bubble with animated dots, the pulsing globe, the "?" and the arrow toward the
meeting room (placed on the meeting side in world x), sparkles, a green additive glow at the screen for the terminal, and an amber ring at the feet while waiting. The glyph textures are the
2D bitmaps, nearest-filtered. `fx/confetti3d.ts` is the same party as 2D (the plan in `sim/confettiPlan.ts`: two cannons, a fountain, pieces, streamers, stars) in three `InstancedMesh`es (pieces, streamers, stars; CPU physics, floor at the carpet,
colours per instance, unlit and not tone-mapped so it stays bright at night), a flash ring on the floor, showers from 3.3 m over a room and sparks for a high five. A celebrating person turns to the camera, jumps
26 cm and loses the name tag while it lasts; a room-wide bubble hangs in the middle of the room (`TagItem.bubbleOnly`). `fx/pingpongBall.ts` moves one small sphere per
table with `ballAt`. With reduced motion the marks are still, particles and jumps are off, and a star badge shows instead. Bubbles of celebrations use the green "good" look; icon-only chat bubbles
are narrow.

Performance rules (must not regress visual quality): merge static geometry per material once a room stops animating,
instancing for repeated parts, shader warm-up with `compileAsync` before showing new content, textures decoded off the
main thread (ImageBitmap) and uploaded progressively, no empty draw calls, frustum culling, shadow map updated every
other frame, `renderer.debug.checkShaderErrors = false` in production. Target 45-60 fps on an Apple-silicon laptop.

Branch plaque: a project room whose folder is a repository (and `WorldOptions.showGit`) hangs a 1.8 m plate under its sign, created
the first time the room has git state (a `CanvasScreen` in the area's dynamic group, repainted only when `roomGitKey` or the language
changes; rooms that are not repositories get none and no static geometry changes). It shows a marker (green, amber, red as in 2D), the
branch fitted to the plate (`fitBranch` and `fitFont`), a right-hand note (the operation in progress as a localized word from the world
catalog, `git.op.*`, else the commits ahead and behind as `↑n ↓n`) and a lit CI disc while the branch has an open pull request.

Unlockable decoration (see [03-world-2d.md](03-world-2d.md#unlockable-decoration) for the slots, the levels and the rules, which are the same in both worlds): `buildFurniture` takes the `Evolution` and skips decoration that is not unlocked; `scene/furnitureDecor.ts` builds the aquarium (walnut stand, glass, tinted water, sand, plants, an open frame instead of a lid), the trophy cabinet (glass front, two glass shelves, bronze, silver and gold cups from lathe-like cylinders, a warm light bar), the extra arcade machines in amber and violet, and the corridor garland (poles, a catenary of thin boxes, bulbs as emissive spheres); `scene/decorScreens.ts` hangs the framed art, the neon sign (canvas glow) and the employee plaque on the reception desk front through the area's decor atlas; all from primitives, no new assets to credit. An `AreaScene` is built with the evolution and `AreaManager.setEvolution` rebuilds only the areas that hold decoration when it changes (same time budget as any area). `scene/aquariumLife.ts` swims two fish and three bubbles; `characters/pet3d.ts` rigs the cat (torso, head, ears, tail, four legs) over the shared `OfficePet`: walk cycle with alternating legs, sit, groom and sleep curled up, turning smoothly. The cat is outside the simulation and the static batches. `still` (reduced motion) stops the fish and puts the cat to sleep. Captures build their `AreaManager` with the level of the sanitized snapshot, without the employee's name.

`capture(opts)` (see [03-world-2d.md](03-world-2d.md#world-api) for the contract and the privacy filter) makes a throwaway `OfficeSim` from the sanitized snapshot, builds its own `AreaManager` and `Crowd` from the shared materials, models and human library, swaps them for the live ones for one render (the live groups are hidden, the point lights of the lit rooms are replaced and restored, the shadow map is refreshed before and after), and renders the isometric overview (`overviewIso`, or `currentIso` for the live framing; pure, in `camera/captureFraming.ts`) into an off-screen `WebGLRenderTarget` (half-float, 4 samples, bloom at night) followed by the output pass into an 8-bit target that is read back into a canvas (`render/stillRender.ts`). The live canvas, its pixel ratio and its composer are never changed, so the quality the person is watching does not move. `dev/world3d.html?capture=1` shows a capture.

`resetScene()` and `setClock(at)` of the `WorldApi` (time-lapse) are the same calls as in 2D: they act on the shared `OfficeSim` and `DayNight`, so people and rooms are placed at once after a jump and the sun follows the replay's time of day.
