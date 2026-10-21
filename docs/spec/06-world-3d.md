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

Performance rules (must not regress visual quality): merge static geometry per material once a room stops animating,
instancing for repeated parts, shader warm-up with `compileAsync` before showing new content, textures decoded off the
main thread (ImageBitmap) and uploaded progressively, no empty draw calls, frustum culling, shadow map updated every
other frame, `renderer.debug.checkShaderErrors = false` in production. Target 45-60 fps on an Apple-silicon laptop.

Branch plaque: a project room whose folder is a repository (and `WorldOptions.showGit`) hangs a 1.8 m plate under its sign, created
the first time the room has git state (a `CanvasScreen` in the area's dynamic group, repainted only when `roomGitKey` or the language
changes; rooms that are not repositories get none and no static geometry changes). It shows a marker (green, amber, red as in 2D), the
branch fitted to the plate (`fitBranch` and `fitFont`), a right-hand note (the operation in progress as a localized word from the world
catalog, `git.op.*`, else the commits ahead and behind as `↑n ↓n`) and a lit CI disc while the branch has an open pull request.

`resetScene()` and `setClock(at)` of the `WorldApi` (time-lapse) are the same calls as in 2D: they act on the shared `OfficeSim` and `DayNight`, so people and rooms are placed at once after a jump and the sun follows the replay's time of day.
