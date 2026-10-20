// Entry-rule variants evaluated on a recorded list of 5-minute checks
const oi = s => s.oi ?? 0, age = s => s.age ?? -1;
const base = s => oi(s) <= 30 && age(s) >= 15 && s.c >= 1;
const R = [
  ['CURRENT: OI 1h ≤ 30%, top ≥ 15 min old, reversal ≥ 1', base],
  ['No wait rules: reversal ≥ 1', s => s.c >= 1],
  ['No wait rules: reversal ≥ 2', s => s.c >= 2],
  ['No wait rules: reversal ≥ 3', s => s.c >= 3],
  ['Drop OI rule only (top ≥ 15 min, reversal ≥ 1)', s => age(s) >= 15 && s.c >= 1],
  ['Drop top-age rule only (OI ≤ 30%, reversal ≥ 1)', s => oi(s) <= 30 && s.c >= 1],
  ['OI limit 50% instead of 30%', s => oi(s) <= 50 && age(s) >= 15 && s.c >= 1],
  ['Top age 5 min instead of 15', s => oi(s) <= 30 && age(s) >= 5 && s.c >= 1],
  ['Top age 10 min instead of 15', s => oi(s) <= 30 && age(s) >= 10 && s.c >= 1],
  ['Current OR (reversal ≥ 2)', s => base(s) || s.c >= 2],
  ['Current OR (reversal ≥ 3)', s => base(s) || s.c >= 3],
  ['Current OR (reversal ≥ 2 and price ≥ 3% off the top)', s => base(s) || (s.c >= 2 && s.below >= 3)],
  ['Current OR (reversal ≥ 2 and price ≥ 5% off the top)', s => base(s) || (s.c >= 2 && s.below >= 5)],
  ['Current OR (reversal ≥ 3 and price ≥ 5% off the top)', s => base(s) || (s.c >= 3 && s.below >= 5)],
  ['Current OR (reversal ≥ 2 and price ≥ 8% off the top)', s => base(s) || (s.c >= 2 && s.below >= 8)],
  ['Current OR (reversal ≥ 2 and top ≥ 5 min old)', s => base(s) || (s.c >= 2 && age(s) >= 5)],
  ['Current OR (reversal ≥ 2, top ≥ 5 min, ≥ 3% off top)', s => base(s) || (s.c >= 2 && age(s) >= 5 && s.below >= 3)],
  ['Current OR (15m reversal ≥ 2 and ≥ 5% off top)', s => base(s) || (s.c15 >= 2 && s.below >= 5)],
];
// first step that satisfies the rule, before the watch ends as "missed"
const firstEntry = (steps, rule) => { for (const s of steps) { if (s.k === 'missed') return null; if (rule(s)) return s; } return null; };
module.exports = { R, firstEntry };