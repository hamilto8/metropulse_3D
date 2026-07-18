# Economy Recovery and Balance

## Authority

`EconomySystem` remains the only mutable owner of Capital, recurring cashflow,
fiscal state, and recovery history. `EconomyBalance` is the immutable tuning
authority. Construction, missions, incidents, fines, progression, and
management policies consume that shared contract rather than copying values.

`EconomyScenarioSimulator` runs the production economy with explicit simulation
time and ordered actions. It is balance tooling, not a second economy model.

## Fiscal states

| State | Rule | Player consequence |
|---|---|---|
| `STABLE` | Net recurring cashflow is non-negative and no recovery contract is active. | Ordinary spending is available; the UI still shows the $25,000 reserve target. |
| `DEFICIT` | Net recurring cashflow is negative while Capital remains. | Runway is shown in simulation minutes and a structured warning lists recovery actions. |
| `INSOLVENT` | Capital is zero and net recurring cashflow is negative before assistance. | Emergency assistance becomes available; missions and salvage remain accessible. |
| `RECOVERY` | A stabilization grant has been claimed and exit conditions are not yet met. | Essential costs remain payable; optional expansion is restricted. |

Recovery ends only when recurring cashflow is non-negative **and** Capital is
at least $25,000. This prevents a momentary positive balance from dismissing the
recovery guidance before the city can absorb another small shock.

Runway is `Capital / recurring loss per minute`. Recurring costs stop at zero
Capital and can never make the treasury negative.

## Pre-spend protection

Every authoritative debit can request an immutable spending decision. The
decision reports category, projected cashflow, remaining Capital, runway,
warning, blocker code, reason, and remedy.

- Essential: cleanup, repair, service response, mission outcomes, and bounded
  fines. These remain payable when affordable so recovery work cannot deadlock.
- Recovery: missions, salvage, recovery contracts, and assistance. These add or
  unlock liquidity and are never hidden by fiscal restrictions.
- Discretionary: construction, zoning, district expansion, and optional
  operating policies. These are blocked in recovery unless the investment
  itself restores non-negative cashflow. A deficit purchase is also blocked if
  it leaves less than $25,000 while cashflow remains negative.

Construction preview and commit use the same decision. A blocked footprint
shows `FISCAL_RESTRICTION`, the exact reason, and a remedy; an allowed purchase
with less than ten minutes of projected runway shows a high-risk warning.
Freight priority cannot be enabled during recovery, but the player may always
disable it.

## Emergency assistance

When Capital is exhausted and cashflow is negative, the city may claim a
$100,000 stabilization grant. It is deliberately a grant rather than debt:
adding interest to an already negative budget creates a death spiral without a
new player decision.

The grant activates recovery restrictions and is persisted with claim count,
total assistance, start/completion revisions, and active state. It cannot be
claimed while any Capital remains. If essential recurring costs consume a grant
before recovery is possible, another grant becomes available at zero; this
keeps every valid save recoverable. Restrictions prevent using this safety net
for optional expansion. Mission income, demolition salvage, and management
cost removal supply the non-grant recovery paths.

## Balance bands

- New city: $650,000 Capital and $480/min base revenue.
- Profitable starter construction: 45–200 minute direct payback. This keeps the
  first asset meaningful without making passive income fund every expansion.
- Baseline authored contract: $30,000–$150,000 before weather, performance, and
  disclosed traffic modifiers.
- Severity cost: $350 cleanup plus $850 repair per severity point. Even a
  severity-five response ($6,000) costs less than one baseline contract.
- Fine: at most $25,000 and at most 10% of current Capital. Fines communicate a
  consequence but cannot seize the treasury.
- Zoning: $2,500. Default demolition salvage: 50%. East expansion: $1,000,000.
- Freight priority: $120/min while active.

These values are MVP tuning baselines, not promises of final feel. Playtest
changes must update `EconomyBalance`, the scenario expectations, and this
document together.

## Deterministic session scenarios

The balanced-growth scenario contains starter construction, five representative
contract rewards, a severity-five response, a capped fine, a public-service
upkeep choice, and later productive growth. CI runs the same ordered scenario
to each required horizon:

| Horizon | Target | Result | Assets / missions | Net cashflow |
|---:|---|---:|---:|---:|
| 15 min | First investment, ≥$100k, ≥1 asset | $526,200 | 1 / 1 | +$2,880/min |
| 30 min | Second decision, ≥$100k, ≥2 assets | $280,900 | 2 / 2 | +$4,780/min |
| 60 min | Incident recovery, ≥$150k, ≥2 assets | $486,300 | 2 / 3 | +$4,780/min |
| 120 min | Sustainable growth, ≥$200k, ≥4 assets | $277,600 | 4 / 5 | +$10,530/min |

Every checkpoint is `STABLE`, deterministic across repeat runs, and deeply
immutable. Separate recovery scenarios cover reserve rejection, insolvency,
repeat assistance after exhaustion, spending restrictions, fine caps,
save/reload, and recovery completion.

## Presentation and persistence

City Pulse displays status, explanation, runway/reserve target, recovery
actions, and the assistance button in an accessible live region. A deduplicated
structured economy alert escalates from warning to critical and resolves after
recovery. UI and alerts only project economy snapshots.

Recovery metadata is an optional addition to economy feature version 1, so old
saves restore with a clean inactive recovery record. New saves round-trip the
complete contract without replaying a grant.
