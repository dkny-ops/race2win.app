# Race123 daytime coastal integration

## Scope and recovery

Base: `9780a38df407db04e4b1d250b7ef941a8a31ad6e` (`main`). Before editing, a complete Git bundle was created and verified locally as `race2win-before-visual.bundle`.

`public/images/Race123.PNG` is unchanged. SHA-256: `3D589F507E135853273B4C28FBBAF2C63B0E27C943D38B95D8AA67DA7FBC602C`.

Only presentation changes: the original image is the proportionally fitted background, an unmarked asphalt patch is sampled in memory for the moving road, and soft environmental reflections use its color palette. Sunlight, ambient fill, daytime fog, coastal colors, curved palm leaves, umbrellas, beach huts and lifeguard cabins form the foreground scene. The previous opaque ready-screen poster and dark vignette no longer hide that scene; menu controls and layout are unchanged.

The camera, simulation, input handling, collisions, gameplay version, scoring, audio, session handling and security code are unchanged. Visual props stay outside the 18-unit road. Recycled scenery is decorative only.

## Validation

- Optimized Next.js build and TypeScript check.
- 133 existing tests pass; two additional scenery tests verify road clearance, recycling continuity and disposal for mobile and desktop quality.
- Targeted ESLint for modified TypeScript and the new tests.
- Local browser checks at 1440×1000 and a simulated touch device at 390×844: ready screen, guest countdown, running traffic, keyboard lane input and touch swipe. Captures are local review artifacts.
- No official session, database migration, production configuration, merge or production deployment is part of this change.

## Real limitations

A single flat PNG does not supply depth, hidden surfaces, meshes or a seamless traversable panorama. The background remains a fixed illustration, while simplified 3D foreground scenery scrolls. This is an approximation, not a pixel-identical 3D reconstruction: the joins and perspective differences remain visible, especially during lateral camera following. Image-based reflections are palette-matched approximations because the source is not a panoramic lighting capture.

Portrait screens crop the sides of the landscape image to preserve its proportions. Showing both complete sides at once would require a different composition or camera/layout changes, which are excluded from this scope. Mobile quality retains the existing reduced pixel ratio and disabled shadow maps. Emulated touch/browser checks do not certify physical iPhone/Safari or Android GPU performance.

Further fidelity needs authored 3D assets or depth/texture source material. The original PNG should remain preserved. Production publication requires separate, explicit user authorization after review.
