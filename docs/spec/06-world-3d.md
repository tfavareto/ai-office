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
