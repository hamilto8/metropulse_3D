# ADR 0002: Retain 120 Hz Physics Cadence

- Status: Accepted for the first Godot release candidate
- Date: 2026-08-13
- Decision owners: Godot port technical/gameplay implementation
- Scope: Phase 11 item 11.4

## Context

The port inherited a 120 Hz Jolt physics cadence, physics interpolation, and
vehicle/contact tuning built and accepted at that cadence. Phase 11 requires a
telemetry-backed comparison against 60 and 90 Hz before retaining or changing
it. The comparison must cover performance, input sampling, vehicle behavior,
bridge/terrain contacts, impacts, and interpolation without weakening gameplay
to satisfy a frame target.

The only available native host was a base M1 Pro MacBook Pro using Godot
4.6.stable.mono.official.89cea1439, Forward+ and Metal. Captures used the same
high-quality Management scene, native window, two-second warmup, eight-second
measurement, and 10 Hz samples. The host held approximately 120 rendered FPS in
all three cases. Metal GPU timestamps were unavailable, so this decision does
not infer GPU cost from zero-valued GPU timing.

## Correctness comparison

The same clean exported-content integration scenario ran at each cadence. All
three runs passed 179 assertions, including six vehicle profiles, weather grip,
impact/knockdown/ejection and recovery, bridge and terrain traversal, live Jolt
contacts, ownership transfer, traffic/pedestrian interaction, camera behavior,
and physics interpolation. The logged six-profile velocity envelope was
identical in the accepted scenario:
`SEDAN 2.491; SPORTS 4.882; BUS 2.263; TRUCK 2.191; POLICE 2.491; MOTORBIKE 1.547`
m/s.

`RuntimeInputHost` samples input at physics priority -1000 and the pedestrian
and vehicle consumers read that frozen snapshot later in the same physics tick.
The cadence therefore bounds the scheduling portion of input-to-simulation
latency to one nominal physics interval: 16.67 ms at 60 Hz, 11.11 ms at 90 Hz,
and 8.33 ms at 120 Hz. This is a pipeline bound, not a claim about display,
device, or operating-system latency.

## Matched M1 Pro telemetry

| Physics cadence | Avg frame | P99 frame | Avg physics | P99 physics | Avg FPS | Managed allocation / 8 s |
|---:|---:|---:|---:|---:|---:|---:|
| 60 Hz | 8.32 ms | 8.85 ms | 3.22 ms | 4.94 ms | 119.75 | 153,752,864 B |
| 90 Hz | 8.39 ms | 9.08 ms | 4.25 ms | 10.97 ms | 119.95 | 174,307,872 B |
| 120 Hz | 8.34 ms | 8.47 ms | 5.03 ms | 12.21 ms | 120.00 | 210,573,816 B |

Higher cadence has a real CPU/allocation cost: the 120 Hz sample allocated
about 37% more managed memory and reported about 56% more average physics time
than 60 Hz. On this host, however, lowering cadence produced no meaningful
frame-throughput or tail-frame improvement; 120 Hz had the lowest observed P99
frame time and remained far inside the 33 ms routine-frame gate. These short
captures are comparative evidence, not minimum-hardware acceptance.

## Decision

Retain 120 Hz with physics interpolation for the first release candidate.

The current host has enough headroom, the accepted handling/contact fixtures
remain tuned at 120 Hz, and 120 Hz gives the smallest input sampling interval.
Changing cadence would spend input response and retuning risk without a measured
rendered-frame benefit on the only available hardware. Runtime-adaptive physics
cadence is rejected for this release: it would make vehicle/contact behavior and
deterministic replay depend on transient load. Presentation quality profiles
remain the supported scaling mechanism.

`--physics-ticks=60|90|120` is a debug-only telemetry option. It cannot change a
release build's cadence. The legacy 30 Hz low-tick test remains separate and
cannot be combined with the comparison option.

## Consequences and reopen criteria

- Vehicle, impact, bridge, terrain, and deterministic fixtures retain their
  120 Hz authority; no accepted fixture needs retuning now.
- Continue allocation profiling because 120 Hz magnifies per-tick garbage. The
  cadence decision does not excuse the measured allocation rate.
- Do not claim minimum/recommended Windows or Linux performance from this Mac.
- Reopen this ADR if native minimum-profile hardware misses 30 FPS/33 ms,
  physics P99 causes routine frame misses, physical-device latency playtests
  fail, or a later Godot/Jolt version materially changes the cost/contact
  envelope. Compare a fixed 90 Hz fallback before considering 60 Hz, and rerun
  the complete contact/input/handling matrix on every target OS.
