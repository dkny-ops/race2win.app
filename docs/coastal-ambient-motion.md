# Moving tropical coast

Base: production commit `399f4ebd99bb548870e1652e7d486ff8cbf711b1`. A full Git bundle was saved before this work. The existing `public/images/Race123.PNG` remains byte-for-byte unchanged (SHA-256 `3D589F507E135853273B4C28FBBAF2C63B0E27C943D38B95D8AA67DA7FBC602C`).

## Approved visual scope

The requested simplification removes the hut, lifeguard tower, umbrellas, chairs, boat, ball and distant buildings. Separate derived assets keep a tropical beach/palm theme. The later request for scenery that passes alongside the car requires world-space layers, rather than a slight deformation of one flat photograph. This changes the foreground composition; it cannot remain pixel-identical to the original illustration from every viewpoint.

## Rendering layers

- The distant sky/horizon uses `coastal-horizon.webp`. Only existing cloud regions drift slowly; the sun is protected from that displacement.
- `CoastalScenery` positions transparent palm and low-vegetation cards in the existing 3D world. Their perspective creates real near/far parallax. They use instancing and shared textures/materials.
- Sand, original-style red/white scenic curbs and the ocean occupy world space outside the 18-unit road. These are decorative, with no colliders.
- The entire scenic group scrolls by `distanceMeters % 96`, exactly like the existing road. Repeating sections extend behind the camera and beyond the visible horizon, so section recycling happens outside the playable view. There is no independent scrolling timer that could drift from the road.
- Palm crowns bend subtly in a vertex shader; trunk bases stay anchored. Water uses a mirrored texture patch from the derived coast, small UV ripples and restrained glints. Phases wrap continuously and large frame gaps are capped.
- A CSS keyframe halo brightens the existing sun very slightly, behind controls with `pointer-events: none`. The existing requestAnimationFrame loop drives renderer updates. No additional product animation loop, timers or UI controls are added.
- Reduced-motion preference disables decorative cloud, wind, water and halo animation. Essential scenery/road travel remains synchronized with the game.

The road implementation, vehicle files, simulation, gameplay version, controls, audio, UI markup, scoring and security files are unchanged. Only rendering hooks in `world.ts` pass read-only distance/speed snapshots into the scenery. Car lighting still uses the original image and unchanged production lighting values.

## Assets and performance

The three new WebP assets total approximately 3.18 MB and preserve their generated pixel/alpha data through lossless encoding. The original PNG is retained for road texture and existing lighting. Ground/water samples are made in memory; the file is never rewritten. Asset load failure leaves the static horizon/original fallback available without changing gameplay.

Desktop uses eight repeating sections; mobile retains six, the existing pixel-ratio cap and original quality policy. Instancing keeps the scenic cards and curbs to five draw calls plus the ground planes. Geometry, textures and materials have explicit disposal; late image completions are discarded after world disposal. No environment object is created per frame.

## Verification

- 144 automated tests pass, including near/far projection, exact road/scenery scroll agreement, lane clearance, section recycling, constant object counts, disposal, immutable display inputs, timing across frame rates and pause/reset handling.
- TypeScript, focused ESLint and optimized Next.js build are checked.
- A browser test with the actual renderer and simulation measured about 26.8 times more screen displacement for a nearby palm than a distant palm after 10 m, without changing camera position. Road and scenic scroll were both exactly 10 m. The test run remained in the running state and reported no WebGL/page errors.
- A local renderer recording demonstrates the existing cars, traffic and moving coast together. The recording harness uses only an in-memory local run; it does not create sessions or submit scores. It is not part of the product build.
- Main-page checks cover desktop and a touch/mobile viewport, the unchanged menu, countdown, keyboard and swipe controls.

Browser automation uses software WebGL and emulated mobile dimensions. It does not certify physical iPhone/Safari or Android GPU performance. The palm/vegetation resources are transparent cards in 3D space, not fully modeled trees; this preserves a lightweight illustrated style but has different side-view detail from a full 3D model.

Production deployment requires a separate approval for this new version.
