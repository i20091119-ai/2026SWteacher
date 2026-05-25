// 실제 근무 뷰 / 장부 뷰 계산
window.Ledger = {
  CAP: 14,
  rateExplain: 30000,
  rateOther: 20000,

  // settings에서 단가/상한 동기화
  syncRates() {
    const s = STATE.settings || {};
    Ledger.CAP = Number(s["weeklyCap"] || 14);
    Ledger.rateExplain = Number(s["rate.explain"] || 30000);
    Ledger.rateOther = Number(s["rate.other"] || 20000);
  },

  // 주(일~토) 단위로 강사별 시수 합산. assignments는 1개월치.
  weeksOf(ym, assignments) {
    Ledger.syncRates();
    // 강사 -> weekStart -> { hExplain, hSupport, hResearch, items[] }
    const map = {};
    assignments.forEach((a) => {
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

  // 실제 근무 뷰: 합산 그대로, 14h 초과 주 빨강 표시 + 초과시수 계산
  actualView(ym, assignments) {
    const weeks = Ledger.weeksOf(ym, assignments);
    const out = {}; // name -> [{wkStart, total, over, hExplain, hSupport, hResearch}]
    Object.keys(weeks).forEach((name) => {
      out[name] = [];
      const ws = Object.keys(weeks[name]).sort();
      ws.forEach((wk) => {
        const w = weeks[name][wk];
        // 이월 항목은 실제 뷰에서 제외
        const itemsReal = w.items.filter((it) => it.kind !== "연구이월" && it.kind !== "지원이월");
        const hE = itemsReal.reduce((s, it) => s + Number(it.hExplain || 0), 0);
        const hS = itemsReal.reduce((s, it) => s + Number(it.hSupport || 0), 0);
        const hR = itemsReal.reduce((s, it) => s + Number(it.hResearch || 0), 0);
        const total = hE + hS + hR;
        const over = Math.max(0, total - Ledger.CAP);
        out[name].push({ wkStart: wk, total, over, hExplain: hE, hSupport: hS, hResearch: hR });
      });
    });
    return out;
  },

  // 장부 뷰: 연구·지원 우선 포함, 해설은 주합계 ≤ 14h가 되도록 상한 처리. 이월 항목 포함.
  ledgerView(ym, assignments) {
    Ledger.syncRates();
    const weeks = Ledger.weeksOf(ym, assignments);
    const out = {}; // name -> { weeks:[...], totals:{hExplain,hSupport,hResearch,amount} }
    Object.keys(weeks).forEach((name) => {
      const ws = Object.keys(weeks[name]).sort();
      const wkRows = [];
      let totalE = 0, totalS = 0, totalR = 0;
      ws.forEach((wk) => {
        const w = weeks[name][wk];
        // 연구·지원(이월 포함)을 먼저 누적
        const otherH = w.hSupport + w.hResearch; // 이월도 hSupport/hResearch에 들어감
        const explainCap = Math.max(0, Ledger.CAP - otherH);
        const cappedExplain = Math.min(w.hExplain, explainCap);
        const cutExplain = Math.max(0, w.hExplain - cappedExplain);
        const sum = cappedExplain + otherH;
        wkRows.push({
          wkStart: wk,
          hExplain: cappedExplain,
          hSupport: w.hSupport,
          hResearch: w.hResearch,
          total: sum,
          cutExplain, // 잘려나간 해설 (이월 대상)
        });
        totalE += cappedExplain;
        totalS += w.hSupport;
        totalR += w.hResearch;
      });
      const amount = totalE * Ledger.rateExplain + (totalS + totalR) * Ledger.rateOther;
      out[name] = { weeks: wkRows, totals: { hExplain: totalE, hSupport: totalS, hResearch: totalR, amount } };
    });
    return out;
  },
};
