# Group mission growth artwork

The seed uses the existing `SeedIcon` and the finished flower uses the existing sunflower PNG. Neither original asset is replaced. Only the three intermediate stages were generated with the built-in `image_gen` tool using the finished sunflower as a style reference. Generated alpha channels are preserved; the PNGs are copied directly without recoloring or background removal.

| Stage     | Project asset                                  |
| --------- | ---------------------------------------------- |
| Seed      | [../sunflower-seed.svg](../sunflower-seed.svg) |
| Sprout    | [sprout.png](sprout.png)                       |
| Stem      | [stem.png](stem.png)                           |
| Bud       | [bud.png](bud.png)                             |
| Sunflower | [../sunflower.png](../sunflower.png)           |

`MissionGrowthImage` renders the server's current stage in both the group card and water selection options. The card shows one current illustration, shared water progress, and the user's water count. The five-stage overview, participation rules, and roulette explanation are available in the mission information dialog.

## Generation prompts

Reference image 1: `frontend/public/icons/sunflower.png`. Built-in generation with `transparent_background: true` and `referenced_image_paths` containing this reference. Each stage was generated separately, using the following template with its exact stage and subject substituted:

```text
Use case: illustration-story. Asset type: one transparent PNG growth-stage icon for a mobile group mission UI. Image 1 is a STYLE REFERENCE ONLY, showing our finished sunflower icon. Create a new {stage} stage matching it as the earlier stage of the SAME sunflower family. Subject: {subject} Style invariants: the exact same cute chunky hand-drawn flat 2D illustration, thick smooth dark chocolate brown outlines with rounded joins, warm soft yellow and muted mint green and warm brown palette from Image 1, gently imperfect organic shapes, minimal broad shading. At small sizes the silhouette must be immediately readable. Square canvas, exactly one centered isolated plant or seed, subject occupies roughly 80% of the canvas with safe transparent padding, front three-quarter view tilted slightly clockwise like Image 1. TRUE transparent background, crisp alpha edges. No soil, no pot, no scenery, no shadow or platform, no text, no numbers, no frame, no gradient background, no white rectangle, no checkerboard pixels, no extra objects, no face, no photorealism, no 3D, no decorative sparkle. Do not reproduce the finished sunflower in the reference; only the requested {stage} stage.
```

`sprout` subject:

```text
A tiny newly sprouted sunflower: one short curved mint green stem with exactly two plump broad oval pointed leaves opening left and right, a tiny warm brown seed husk at the bottom. No flower and no bud.
```

`stem` subject:

```text
A young sunflower plant with a visibly taller slightly curved green stalk, exactly four broad mint green leaves in two alternating pairs, sturdy simple silhouette. No flower, no bud, no pot.
```

`bud` subject:

```text
A sunflower plant with a compact unopened rounded green flower bud at the top. The folded bud has only a small warm yellow glimpse at the tip, NOT an open flower and no visible brown center. Short green stem with two broad mint leaves near its base.
```
