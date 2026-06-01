// lift.mjs — feature lift over wins vs losses: P(feat|loss)/P(feat|win).
// Ranks by lift × p_loss (dominant failure mode), with a min-N loss gate AND a
// per-feature support guard (a feature seen in <5 of either class is low-confidence:
// its lift is statistically meaningless even when the overall loss gate passes).
export function liftReport(matches, { minLosses = 30, minCell = 5 } = {}) {
  const wins = matches.filter(m => m.won === true);
  const losses = matches.filter(m => m.won === false);
  const keys = [...new Set(matches.flatMap(m => Object.keys(m.features || {})))];
  const present = (set, k) => set.filter(m => m.features && m.features[k]).length;
  const rows = keys.map(k => {
    const lc = present(losses, k), wc = present(wins, k);
    const pl = losses.length ? lc / losses.length : 0;
    const pw = wins.length ? wc / wins.length : 0;
    const reliable = Math.min(lc, wc) >= minCell;          // both cells have support
    const lift = pw > 0 ? pl / pw : null;                  // undefined when feature never in wins
    return {
      feature: k, loss_n: lc, win_n: wc,
      p_loss: +pl.toFixed(3), p_win: +pw.toFixed(3),
      lift: lift == null ? null : +lift.toFixed(2),
      reliable,
      // score only for reliable rows so a 1-of-59 fluke can't top the ranking
      score: reliable && lift != null ? +(pl * lift).toFixed(3) : 0,
    };
  }).sort((a, b) => b.score - a.score);
  return { n_win: wins.length, n_loss: losses.length, gate_ok: losses.length >= minLosses, rows };
}
