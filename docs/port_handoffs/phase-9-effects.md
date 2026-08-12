# Phase 9 effects slice

This slice adds the session-owned fixed effect pools, collision-free effect
presentation, spatial one-shots and captions, weather reuse, accessibility
policy, deterministic cleanup, and the presentation-only boundary around road
and economy authorities.

## Pool budget and lifetime

| Pool | Roots | Lifetime | Source policy |
| --- | ---: | ---: | --- |
| Explosion | 8 | 1.1 s | transient, oldest lease reused at cap |
| Fire | 12 | persistent | one keyed lease per burning source |
| Rubble | 24 | 12 s | transient, oldest lease reused at cap |
| Comet | 4 | 3.5 s | transient, disabled by reduced motion |

`SessionEffectRuntime` creates all 48 `PooledWorldEffect` roots once under
`WorldRoot/EffectRoot`. Activation only changes visibility, transform, material
animation, and optional non-shadowing light state. Expired transient leases and
cleared fire sources return to their pools; the runtime does not instantiate a
replacement root during play.

Every effect specification declares collision, road-graph mutation, and
economy mutation disabled. No pooled root contains a `CollisionObject3D`, and
the runtime has no road or economy dependency. Live integration records both
authoritative revisions, triggers all effect families, and verifies that the
revisions remain unchanged.

## Producers and weather reuse

- player-vehicle impact counters trigger explosion presentation and camera
  shake;
- traffic agents in `ON_FIRE` retain one moving fire lease until their damage
  state clears;
- thunderstorm cadence reuses `WorldEnvironmentController` lightning
  adjustment state;
- rain continues to use the environment's single `Rain` GPU emitter;
- nighttime comets use deterministic positions and the four-root pool.

The environment controller remains the sole owner of rain and lightning render
state. Effects consume its immutable presentation snapshot and never create a
second weather emitter.

## Accessibility and audio

The live settings subscription applies:

- camera shake scale and reduced-motion suppression;
- full, reduced, or off lightning flash intensity;
- bloom off through the existing environment owner;
- comet suppression when reduced motion is enabled.

Explosion, fire, rubble, comet, and thunder use 12 reusable
`AudioStreamPlayer3D` one-shot voices. Their closed captions are `[explosion]`,
`[fire crackling]`, `[rubble falling]`, `[comet streaks overhead]`, and
`[thunder]`. Thunderstorm state changes announce thunder once; actual lightning
events publish the timed caption and spatial sound.

## Automated coverage

Domain tests verify the exact 48-root budget, presentation-only declarations,
oldest-slot reuse, transient cleanup, keyed fire deduplication/release, and
reduced-motion policy. Live clean, import, and recovery scenarios verify 48
preallocated collision-free roots, 12 one-shot voices, one reusable rain
emitter, all effect/caption adapters, settings updates, transient and persistent
cleanup, and unchanged road/economy revisions. Each scenario reports eight
test spawns and six cleanups before the persistent fire lease is explicitly
released.
