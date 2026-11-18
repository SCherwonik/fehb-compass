# Family members: one year of care per covered person

Date: 2026-11-18. Status: awaiting owner approval. Nothing built.

## Intent and why

Self Plus One and Family enrollments cost the same expected care as Self today, because the app models one covered
person's year (see `personLimits` in `src/engine/cost.js`). A coworker saw that switching to Family did not change
expected care. That is wrong for a family: each person has their own deductible and out-of-pocket max inside the
family limits, and one sick person in four is capped at the self-only max while two sick people can reach the family max.
The goal is totals that follow how the limits really work, and a way to see them ("See the math").

## Goals

- Self Plus One has 2 members. Family has a user-set number of members (3 to 8).
- Each member has a name, a scenario, and the existing fine-tunes (visits, ER, hospital stays, monthly drugs).
- Custom costs and medications attach to one member.
- Expected care for a plan is the sum of the members, with each member capped at the self-only limits and the family
  total capped at the family limits. Shared-deductible HDHPs share the deductible across members.
- "See the math" (cards and Board dialog) shows one block per member, then the family totals, with the deductible
  and out-of-pocket max bars for the person and the family.
- Self enrollment looks and works exactly as it does today. Old links open as a one-person year.

## Non-goals and anti-goals

- No guessing at facts the data lacks. The embedded-versus-shared deductible split stays as `deductibleType` models
  it, and the app keeps saying so (About > How it works). Member order is stated as an assumption where it matters.
- Not a per-member plan choice: everyone is on the same plan.
- Premiums do not change with member count (the enrollment type sets the premium).
- Anti-goal: slower or less certain results than today. Existing engine tests must still pass unchanged.
- Medications never go in the URL, per member as well.

## Constraints

- Static vanilla JS ES modules, no build step, no contact email anywhere.
- State lives in the URL hash plus guarded localStorage (`src/state.js`); keep the hash short, and keep legacy hashes
  decoding to a valid state.
- Medications stay in local storage only (existing rule).

## Approaches considered

- A. Run each member separately, add up, cap at the family max. Reuses the engine, exact for regular plans, wrong for
  shared-deductible HDHPs.
- B. One merged pass with shared tallies. Correct everywhere, but rewrites the center of the engine and needs a guess
  about who is cared for first.
- C. (chosen by the owner) Run members one after another, handing each the running tally of what the family has
  already used. Exact for regular plans in any order, right for shared-deductible HDHPs, small engine change.

## Design (decided)

**Engine.** `expectedOop` gains an optional start state: `carry = { dedPaid, oopPaid, oonDedPaid, oonOopPaid }`,
the family deductible and out-of-pocket max already used by earlier members. It returns the same fields plus
`carryOut`. A new `familyTotal(plan, inputs)` runs the members in order, passing each one's `carryOut` to the next,
and sums them. Limits come from `personLimits` for the person plus the enrollment's family values for the family caps:
- Regular plans (`embedded`): each member's own deductible and out-of-pocket max are the self-only ones; the family
  out-of-pocket max is the enrollment's value and limits what later members still pay.
- `aggregate` and `unknown` HDHPs: the deductible is the enrollment's value and is shared (members draw on one
  tally); each member's out-of-pocket max is still capped at the self-only one, plus the family cap.
- Self enrollment, or one member: same result as today, bit for bit.

**State.** `members: [{ id, name, scenario, overrides }]`, 1 to 8. Custom lines gain `member` (the member's id).
Enrollment decides the count: self 1, self_plus_one 2, family `familySize` (new, 3 to 8, default 4). Today's
`scenario`, `overrides` and `custom` become member 1 and are migrated on load, so old links still work. Hash gets a
compact members param and a `familySize` value; custom lines carry a short member index. Medications are keyed by
member id in local storage and never encoded.

**Inputs UI.** "Your year" shows a members list when enrollment is not Self: each member row has a name field, a
scenario control and fine-tunes (collapsed for all but the open member). Family has a "How many covered people"
stepper. Custom costs and medications show a member selector. Self enrollment shows today's controls unchanged.

**Cost model and ranking.** `costInputs(state)` returns members' usages; `planTotal` calls `familyTotal` when there
is more than one member, and the breakdown carries `members: [{name, oop, services, ...}]` plus `family: {...}`.
Ranking, savings and the Board use the total as before.

**See the math.** One block per member (same itemized lines as today), then a family block: sum, family
out-of-pocket max bar, shared-deductible bar (HDHPs), and a note on member order only for shared-deductible plans.

**Tests.** Existing tests unchanged and passing. New: one member equals today's totals on every plan; identical
members on regular plans equal min(sum, family max); one sick member never exceeds the self-only max; shared-deductible
plans count the deductible once across members; legacy hash migration; members round-trip through the hash without
medications.

## Left to the builder

Control layout and copy, the exact hash param names, how member order is shown in the dialog, and CSS. Any plan
whose data lacks a family value falls back to the self-only value and says so in "See the math".
