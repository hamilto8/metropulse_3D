# Phase 6 Heat and Enforcement Handoff

Chunk ID and status: `phase-6-heat-enforcement`; complete as the fourth of five Phase 6 slices, covering item 6.7. Phase 6 remains in progress pending only the exit soak/audit slice.

Source revision / Godot revision: Frozen browser reference `44a286a74557adfe4fabd3a6e16b9006079eba32`; follows Godot revision `fc18707`; Godot 4.6 stable .NET `89cea1439`, Jolt, 120 Hz.

Objective and non-goals: Add one player-owned Heat/enforcement state across on-foot and vehicle control, with deterministic scoring, dispatch, escape, arrest, incident cleanup, and recovery. This slice does not add the Phase 8 mission consequence/debrief adapter, Phase 9 HUD/overlay art, authored siren audio, or city-economy incident persistence.

Authority and lifecycle: `HeatEnforcementModel` exclusively owns score, tier, escape timer, repetition, active macro-incident ID, and arrest/escape outcomes. `EnforcementRuntime` adapts player control, Heat policy, traffic responders, world safety, crime events, and recovery. Traffic population owns responder route/siren state only. The stable response key is `player`, so pedestrian-to-vehicle switches never transfer or duplicate Heat authority.

Scoring contract: Severity is clamped 1–5. Witnessed reports use full weight; unwitnessed reports use one quarter. Security contributes a 0.75–1.25 multiplier and repeat reports add 15% each up to four repeats. Heat clamps to 100 and maps to tiers at >0, 25, 50, and 75. One `player-crime-NNNN` macro incident is created when a response begins; repeats update the same incident until escape, arrest, or explicit resolution.

Dispatch and pursuit: A first report performs one bounded 500-metre grid query and selects up to the tier's maximum of four eligible police. Routine updates touch only assigned responders, update the stable player target position across control switches, keep sirens active, and choose each reached road node's edge closest to the latest target. Hit-and-run police are excluded and clearing either response preserves the other assignment's siren state. The exercised initial dispatch inspected 35 of 48 traffic agents; routine vehicle-neighbor work remains six.

Escape, arrest, and recovery: Heat freezes in non-Street policies. It decays at three points/second only when the player is safe, unseen, and more than 35 metres from assigned police. Eight continuous seconds resolves the response. Visibility or unsafe state resets the escape timer without decay. Arrest is below 3 metres on foot or 4.5 metres in a vehicle. Arrest atomically clears Heat/incident/responders, transitions through no-control authority, restores on-foot control, and spawns at the supported `(-75,-75)` park checkpoint.

Live reporters: Completion of the existing 1.25-second unauthorized hijack reports witnessed severity-two Heat exactly once before vehicle handoff. A player-controlled ambient vehicle knocking down an eligible citizen reports witnessed severity-three hit-and-run Heat. Repetition never creates a second macro incident.

Tests and evidence: Four new domain cases cover factor composition, one-incident repetition, safe-unseen-only decay, exact eight-second escape, entity-specific arrest thresholds, responder eligibility/order/continuity, and patrol cleanup. Six live checks cover hijack reporting, one macro incident, 1–4 siren responders, body-independent target identity, repeat reporting, response cleanup, arrest, Heat clear, and supported recovery. The domain suite passes 279/279; clean/import/recovery integration passes 155/155/159 and publishes `phase6.enforcement.passed`. Logs are under `godot/artifacts/test-results/godot-integration*.log`.

Compatibility and placeholders: The save envelope already validates `heat.wanted`, `escapeTimer`, and incident ID; live capture/restore remains with the later runtime save adapter. The response has no HUD, overlay, authored sound, economy consequence, or persistent incident adapter yet. These are presentation/cross-system follow-ups, not duplicate Heat authorities.

Next safe task: Run the 30-minute deterministic headless living-city soak and Phase 6 exit audit, capture stable population/query/pursuit/congestion evidence, update the remaining exit gates and handoff index, then close Phase 6.
