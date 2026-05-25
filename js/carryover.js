// 월별 해설 초과 → 다음 달 이월 권장 시수 계산 (×1.5).
window.Carryover = {
  // monthAssignments(전월): 실제 뷰 기준 해설 초과 시수를 강사별 합산.
  computeFromMonth(ym, assignments) {
    Ledger.syncRates();
    const weeks = Ledger.weeksOf(ym, assignments);
    const out = {}; // name -> { overflowExplainH, compensationAmount, recommendedH }
    Object.keys(weeks).forEach((name) => {
      let overflow = 0;
      Object.values(weeks[name]).forEach((w) => {
        const itemsReal = w.items.filter((it) => it.kind !== "연구이월" && it.kind !== "지원이월");
        const hE = itemsReal.reduce((s, it) => s + Number(it.hExplain || 0), 0);
        const hS = itemsReal.reduce((s, it) => s + Number(it.hSupport || 0), 0);
        const hR = itemsReal.reduce((s, it) => s + Number(it.hResearch || 0), 0);
        const total = hE + hS + hR;
        const over = Math.max(0, total - Ledger.CAP);
        // 초과는 해설에서 발생한 것으로 본다 → 해설 초과 시수로 간주(해설 시수 한도 내).
        overflow += Math.min(hE, over);
      });
      if (overflow > 0) {
        out[name] = {
          overflowExplainH: overflow,
          compensationAmount: overflow * Ledger.rateExplain,
          recommendedH: +(overflow * (Ledger.rateExplain / Ledger.rateOther)).toFixed(2), // ×1.5
        };
      }
    });
    return out;
  },
};
