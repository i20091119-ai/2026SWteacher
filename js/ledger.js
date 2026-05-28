// 실제 근무 뷰 / 장부 뷰 계산
window.Ledger = {
  CAP: 14,
  rateExplain: 30000,
  rateOther: 20000,

  // settings에서 단가/상한 동기화 (기본값)
  syncRates() {
    const s = STATE.settings || {};
    Ledger.CAP = Number(s["weeklyCap"] || 14);
    Ledger.rateExplain = Number(s["rate.explain"] || 30000);
    Ledger.rateOther = Number(s["rate.other"] || 20000);
  },

  // 월별 cap (설정 키 `weeklyCap.YYYY-MM` 이 있으면 우선)
  capForYm(ym) {
    const s = STATE.settings || {};
    const m = Number(s["weeklyCap." + ym]);
    if (m > 0) return m;
    return Number(s["weeklyCap"] || 14);
  },

  // 주(일~토) 단위로 강사별 시수/항목 그룹화
  weeksOf(ym, assignments) {
    Ledger.syncRates();
    const map = {};
    (assignments || []).forEach((a) => {
      const wk = weekStartSun(a.date);
      if (!map[a.name]) map[a.name] = {};
      if (!map[a.name][wk]) map[a.name][wk] = { items: [], hExplain: 0, hSupport: 0, hResearch: 0 };
      const w = map[a.name][wk];
      w.hExplain += Number(a.hExplain || 0);
      w.hSupport += Number(a.hSupport || 0);
      w.hResearch += Number(a.hResearch || 0);
      w.items.push(a);
    });
    return map;
  },

  // 실제 근무 뷰: 합산 그대로, cap 초과 주는 over 표기.
  // 이월 항목은 실제 뷰에서 제외 (이미 보전 처리이므로 실제 근무량 아님)
  actualView(ym, assignments) {
    const cap = Ledger.capForYm(ym);
    const weeks = Ledger.weeksOf(ym, assignments);
    const out = {};
    Object.keys(weeks).forEach((name) => {
      out[name] = [];
      const ws = Object.keys(weeks[name]).sort();
      ws.forEach((wk) => {
        const w = weeks[name][wk];
        const itemsReal = w.items.filter((it) => it.kind !== "연구이월" && it.kind !== "지원이월");
        const hE = itemsReal.reduce((s, it) => s + Number(it.hExplain || 0), 0);
        const hS = itemsReal.reduce((s, it) => s + Number(it.hSupport || 0), 0);
        const hR = itemsReal.reduce((s, it) => s + Number(it.hResearch || 0), 0);
        const total = hE + hS + hR;
        const over = Math.max(0, total - cap);
        out[name].push({ wkStart: wk, total, over, hExplain: hE, hSupport: hS, hResearch: hR, cap });
      });
    });
    return out;
  },

  // 장부 뷰: 해설 우선 보존, 연구·지원이 cap 초과 시 잘림.
  // 잘림 규칙:
  //   1) 해설 시수 먼저 인정 (cap 초과해도 일단 그대로 — 해설은 잘리지 않음)
  //   2) 남은 cap 안에서 연구·지원 항목을 날짜순으로 채움
  //   3) cap 초과 시점의 항목은 비율로 부분 잘림, 이후 항목은 전부 이월
  //   4) 이월 항목(kind=연구이월/지원이월)은 그대로 인정 (이미 보전된 시수)
  ledgerView(ym, assignments) {
    Ledger.syncRates();
    const cap = Ledger.capForYm(ym);
    const weeks = Ledger.weeksOf(ym, assignments);
    const out = {};
    Object.keys(weeks).forEach((name) => {
      const ws = Object.keys(weeks[name]).sort();
      const wkRows = [];
      let totalE = 0, totalS = 0, totalR = 0;
      ws.forEach((wk) => {
        const w = weeks[name][wk];
        const carryItems = w.items.filter((it) => it.kind === "연구이월" || it.kind === "지원이월");
        const carryHS = carryItems.reduce((s, it) => s + Number(it.hSupport || 0) + (it.kind === "지원이월" ? Number(it.hExplain || 0) : 0), 0);
        const carryHR = carryItems.reduce((s, it) => s + Number(it.hResearch || 0) + (it.kind === "연구이월" ? Number(it.hExplain || 0) : 0), 0);

        const realItems = w.items.filter((it) => it.kind !== "연구이월" && it.kind !== "지원이월");
        const hE = realItems.reduce((s, it) => s + Number(it.hExplain || 0), 0);
        const remainCap = Math.max(0, cap - hE);

        const otherItems = realItems
          .filter((it) => (Number(it.hSupport || 0) + Number(it.hResearch || 0)) > 0)
          .sort((a, b) => String(a.date).localeCompare(String(b.date)));

        let usedCap = 0;
        let acceptedS = 0, acceptedR = 0;
        const cutItems = [];

        otherItems.forEach((it) => {
          const itHS = Number(it.hSupport || 0);
          const itHR = Number(it.hResearch || 0);
          const itTotal = itHS + itHR;
          if (itTotal === 0) return;

          if (usedCap >= remainCap) {
            cutItems.push({
              date: it.date, kind: it.kind, form: it.form || "", role: it.role || "",
              cutHSupport: itHS, cutHResearch: itHR, cutTotal: itTotal,
            });
          } else if (usedCap + itTotal <= remainCap) {
            acceptedS += itHS;
            acceptedR += itHR;
            usedCap += itTotal;
          } else {
            const available = remainCap - usedCap;
            const ratio = available / itTotal;
            const acceptHS = Math.round(itHS * ratio * 10) / 10;
            const acceptHR = Math.round(itHR * ratio * 10) / 10;
            acceptedS += acceptHS;
            acceptedR += acceptHR;
            const cutHS = Math.round((itHS - acceptHS) * 10) / 10;
            const cutHR = Math.round((itHR - acceptHR) * 10) / 10;
            cutItems.push({
              date: it.date, kind: it.kind, form: it.form || "", role: it.role || "",
              cutHSupport: cutHS, cutHResearch: cutHR, cutTotal: cutHS + cutHR,
            });
            usedCap = remainCap;
          }
        });

        const cutSupport = Math.round(cutItems.reduce((s, it) => s + (it.cutHSupport || 0), 0) * 10) / 10;
        const cutResearch = Math.round(cutItems.reduce((s, it) => s + (it.cutHResearch || 0), 0) * 10) / 10;

        const finalHE = hE;
        const finalHS = acceptedS + carryHS;
        const finalHR = acceptedR + carryHR;
        const total = finalHE + finalHS + finalHR;

        wkRows.push({
          wkStart: wk,
          hExplain: finalHE,
          hSupport: finalHS,
          hResearch: finalHR,
          total,
          cutItems,
          cutSupport,
          cutResearch,
          // 호환용 — 잘린 총 시수 (연구+지원). 기존 cutExplain 자리에 대체 사용
          cutExplain: cutSupport + cutResearch,
          cap,
        });
        totalE += finalHE;
        totalS += finalHS;
        totalR += finalHR;
      });
      const amount = totalE * Ledger.rateExplain + (totalS + totalR) * Ledger.rateOther;
      out[name] = { weeks: wkRows, totals: { hExplain: totalE, hSupport: totalS, hResearch: totalR, amount } };
    });
    return out;
  },
};
