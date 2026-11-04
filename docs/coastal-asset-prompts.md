# Coastal asset provenance

Tool: built-in ImageGen editing, followed by lossless WebP encoding. Source edit target: the existing `Race123.PNG`, preserved as an unchanged original. The user explicitly approved removing existing man-made props, then requested a scrolling scene with depth.

Final shipped files:

- `public/images/coastal-horizon.webp`: distant plate with open sky and original tropical coast; foreground palms are supplied separately.
- `public/images/coastal-palm.webp`: a full palm on genuine transparency, used for world-space cards with moving crowns.
- `public/images/coastal-vegetation.webp`: a low clump of the existing tropical vegetation style on transparency.

An intermediate `Race123-coast-clean.png` is a review/source image, not the game layer structure. It is retained with the review artifacts, not shipped redundantly.

## Prompt 1 — subtract props from source

Use case: precise-object-edit. Edit target: the provided existing Race123.PNG game background. Make only this requested subtraction: remove ALL man-made beach props and buildings: the large left thatched hut/bar and its lights, its surfboards, every beach umbrella and chair, the right red lifeguard tower, the beach ball, sailboat, and tiny distant city/buildings. Fill only the removed-object areas naturally with the existing beach sand, low tropical vegetation, ocean or distant greenery as appropriate. Keep the exact existing palm trees in the exact positions, existing sky, sun, clouds, ocean colors, mountains, vegetation style, sunlight and perspective. Absolutely preserve the entire existing asphalt road, its lane markings, yellow lines, red/white curbs and painted palm shadows exactly; do not redraw or redesign the road. Preserve the original framing and 16:9 composition and original vibrant Miami tropical style. No new decorations, no people, no cars, no signs, no extra architecture, no text. This is object removal from the provided image, not a newly designed environment. Return one cleaned sibling variant with just beach, ocean, palm trees and vegetation around the unchanged road.

## Prompt 2 — transparent palm

Use case: background-extraction. Edit target is the provided cleaned tropical Race123 image. Produce ONE isolated palm tree cutout taken from the existing image style, the medium tall curved palm on the LEFT near x=520,y=220, including its complete trunk, complete crown of green/yellow fronds, and natural existing sunlight shading. Show the complete tree with a little transparent margin, trunk base centered horizontally at the bottom; no cropping fronds. Match the original illustrated 3D beach game rendering exactly. Genuine transparent background including the gaps between leaves, no shadow patch, no ground, no ocean, no sky, no road, no buildings, no people, no extra objects. This is a source sprite for a 3D billboard in the same existing game, not a redesign. Keep the palm organic, slightly curved and proportionate.

## Prompt 3 — distant plate

Use case: precise-object-edit. Edit target is the supplied Race123 clean coastal background. Create the DISTANT BACKGROUND LAYER for this exact game scene, not a redesign. Remove the large foreground palm trees whose crowns overlap the sky on both outer edges and the medium foreground palm left of center and near right beach. Fill their silhouettes with the surrounding existing blue sky, cloud fragments, distant green vegetation, bare sand or ocean. Retain the existing distant tiny palm-lined horizon, mountain silhouette, identical blue sky, identical sun at same location, identical clouds and lighting/color palette, ocean horizon, perspective and framing. Preserve the entire existing road and red/white curbs exactly; they will be covered by existing 3D road. No buildings, no huts, no umbrellas, no chairs, no boat, no people, no new objects. The output should be a clean background plate with open sky and distant tropical coast, with room for separately rendered foreground palms. Preserve 1672:941 composition.

## Prompt 4 — transparent low vegetation

Use case: background-extraction. Edit target: the supplied clean Race123 tropical game image. Extract a low, wide small clump of the existing dense green tropical broad-leaf vegetation from the lower left roadside. Match the existing yellow-green palm-like leaves, a few tiny existing pink flowers, and natural sunlight exactly. ONE low, wide roadside vegetation sprite on genuine transparency including gaps between leaves, no solid backdrop, no colored halo, no shadow plate, no soil ground plane, no road, no sand, no palms/tree trunks, no buildings, no new props. Complete leaves with a small transparent margin. Organic irregular silhouette, not a rectangular wall. This is a separate billboard texture for the same game, not a redesign.
