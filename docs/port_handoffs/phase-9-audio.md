# Phase 9 audio slice

This slice added the session audio authority, procedural stream cache, bus
routing, settings application, spatial vehicle/emergency sources, voice policy,
and closed captions. The later effects and exit-audit slices are summarized in
`phase-9-complete.md`.

## Bus layout and mapping

```text
Master                 <- audio.master
├─ Music               <- audio.music
├─ Effects             <- audio.effects
│  ├─ Vehicle
│  ├─ Emergency
│  └─ UI
├─ Ambience            <- audio.ambience
└─ Dialogue            <- audio.dialogue
```

`SessionAudioRuntime` installs missing buses before traffic or player vehicles
create audio players and removes only the buses it added during shutdown.
Primary volume preferences map directly to their named buses; the three child
buses inherit Effects.

Linear volume uses `20 * log10(linear)`, clamped at −80 dB. A value of zero
mutes the bus and retains the last audible dB value. Raising the volume restores
the exact computed gain and clears mute.

## Procedural sources and cache

`ProceduralAudioStreamCache` builds 22.05 kHz mono PCM WAV resources once per
sound ID. Current cached sources are:

- city music and ambience loops;
- rain loop;
- speed/pitch-responsive vehicle engine loop;
- vehicle impact and horn one-shots;
- police siren loop;
- thunder, explosion, fire, rubble, and comet one-shots;
- UI confirmation tone.

Vehicle engine and impact sources are `AudioStreamPlayer3D` nodes on the
Vehicle bus. Traffic horns and sirens are spatial sources on Vehicle and
Emergency respectively. Global music, ambience, rain, and UI sources are
non-spatial.

## Voice policy and captions

`AudioPresentationModel.AllocateVoices` sorts by priority, then listener
distance, then stable ID while enforcing per-bus and total caps. The current
total voice budget is 64. UI and emergency sounds outrank vehicle horns, and a
nearer equal-priority source wins.

Closed-caption strings:

- `[city music]`
- `[city ambience]`
- `[rain falling]`
- `[engine revving]`
- `[vehicle impact]`
- `[vehicle horn]`
- `[police siren approaching]`
- `[thunder]`
- `[explosion]`
- `[fire crackling]`
- `[rubble falling]`
- `[comet streaks overhead]`
- `[confirmation tone]`

Captions require both subtitles and closed captions and publish through the
shared polite live region. Dialogue itself retains its authored speaker/text
announcements from the modal slice.

## Automated coverage

Domain tests cover the exact bus tree, settings mapping, linear/dB/mute/restore
math, priority/distance/cap allocation, caption completeness, and bounded
vehicle pitch/gain. Live integration verifies eight buses, parent sends,
cached streams, music/ambience routing, zero mute and exact restore, caption
publication, and clean bus teardown/recreation in clean, import, and recovery
scenarios. After the effects slice, each scenario finishes with 13 cached
streams, 17 observed caption events, 12 reusable effect one-shot voices, and
the fixed 64-voice budget.
