// 주간 활동 시수 집계 (일~토 기준).
// 금액·장부 개념은 쓰지 않는다. 주간 상한 초과만 표시한다.
window.Hours = {
  CAP: 20,

  // 월별 상한 (설정 키 `weeklyCap.YYYY-MM` 이 있으면 그 값이 우선)
  capForYm(ym) {
    const s = STATE.settings || {};
    const m = Number(s["weeklyCap." + ym]);
    if (m > 0) return m;
    return Number(s["weeklyCap"] || 20);
  },

  syncCap() {
    Hours.CAP = Number((STATE.settings || {})["weeklyCap"] || 20);
  },

  // 주(일~토) 단위로 강사별 시수를 합산.
  weeksOf(assignments) {
    const map = {};
    (assignments || []).forEach((a) => {
      const wk = weekStartSun(a.date);
      if (!map[a.name]) map[a.name] = {};
      if (!map[a.name][wk]) map[a.name][wk] = { hExplain: 0, hSupport: 0, hResearch: 0, items: [] };
      const w = map[a.name][wk];
      w.hExplain += Number(a.hExplain || 0);
      w.hSupport += Number(a.hSupport || 0);
      w.hResearch += Number(a.hResearch || 0);
      w.items.push(a);
    });
    return map;
  },

  // 강사 -> [{ wkStart, hExplain, hSupport, hResearch, total, over, cap }]
  weeklyView(ym, assignments) {
    const cap = Hours.capForYm(ym);
    const weeks = Hours.weeksOf(assignments);
    const out = {};
    Object.keys(weeks).forEach((name) => {
      out[name] = Object.keys(weeks[name]).sort().map((wk) => {
        const w = weeks[name][wk];
        const total = w.hExplain + w.hSupport + w.hResearch;
        return {
          wkStart: wk,
          hExplain: w.hExplain,
          hSupport: w.hSupport,
          hResearch: w.hResearch,
          total,
          over: Math.max(0, total - cap),
          cap,
        };
      });
    });
    return out;
  },

  // 강사 -> { hExplain, hSupport, hResearch, total } 월 합계
  monthTotals(assignments) {
    const out = {};
    (assignments || []).forEach((a) => {
      if (!out[a.name]) out[a.name] = { hExplain: 0, hSupport: 0, hResearch: 0, total: 0 };
      const t = out[a.name];
      t.hExplain += Number(a.hExplain || 0);
      t.hSupport += Number(a.hSupport || 0);
      t.hResearch += Number(a.hResearch || 0);
      t.total = t.hExplain + t.hSupport + t.hResearch;
    });
    return out;
  },
};
