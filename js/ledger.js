// 실제 활동 뷰 / 장부 뷰 계산
window.Ledger = {
  CAP: 20,
  rateExplain: 30000,
  rateOther: 20000,

  // settings에서 단가/상한 동기화 (기본값)
  syncRates() {
    const s = STATE.settings || {};
    Ledger.CAP = Number(s["weeklyCap"] || 20);
    Ledger.rateExplain = Number(s["rate.explain"] || 30000);
    Ledger.rateOther = Number(s["rate.other"] || 20000);
  },

  // 월별 cap (설정 키 `weeklyCap.YYYY-MM` 이 있으면 우선)
  capForYm(ym) {
    const s = STATE.settings || {};
    const m = Number(s["weeklyCap." + ym]);
    if (m > 0) return m;
    return Number(s["weeklyCap"] || 20);
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

  // 실제 활동 뷰: 합산 그대로, cap 초과 주는 over 표기.
  // 실제 활동(이월 제외)과 이월(연구이월/지원이월)을 별도 컬럼으로 분리해 함께 반환.
  actualView(ym, assignments) {
    const cap = Ledger.capForYm(ym);
    const weeks = Ledger.weeksOf(ym, assignments);
    const out = {};
    const sumByKind = (items, kind) => items
      .filter((it) => it.kind === kind)
      .reduce((s, it) => s + Number(it.hExplain || 0) + Number(it.hSupport || 0) + Number(it.hResearch || 0), 0);
    Object.keys(weeks).forEach((name) => {
      out[name] = [];
      const ws = Object.keys(weeks[name]).sort();
      ws.forEach((wk) => {
        const w = weeks[name][wk];
        const itemsReal = w.items.filter((it) => it.kind !== "연구이월" && it.kind !== "지원이월");
        const hE = itemsReal.reduce((s, it) => s + Number(it.hExplain || 0), 0);
        const hS = itemsReal.reduce((s, it) => s + Number(it.hSupport || 0), 0);
        const hR = itemsReal.reduce((s, it) => s + Number(it.hResearch || 0), 0);
        const carryResearch = sumByKind(w.items, "연구이월");
        const carrySupport  = sumByKind(w.items, "지원이월");
        // 합계와 cap 초과 모두 이월 포함 (보전된 시수도 활동량으로 본다)
        const total = hE + hS + hR + carryResearch + carrySupport;
        const over = Math.max(0, total - cap);
        out[name].push({
          wkStart: wk, total, over,
          hExplain: hE, hSupport: hS, hResearch: hR,
          carryResearch, carrySupport,
          cap,
        });
      });
    });
    return out;
  },

  // 장부 뷰: 관리자가 모달에서 'carry=true'로 표시한 항목만 당월 장부에서 제외.
  //   - 이월 항목(kind=연구이월/지원이월)은 그대로 인정 (이미 보전된 시수)
  //   - carry=true인 활동은 cutItems로 분류 → 합계/금액에서 제외 + 다음 달 보전 권장에 포함
  //   - carry=false인 활동은 cap 무관하게 모두 합산 (자동 분할 없음)
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
        // 이월 보전 항목 (전월 잘린 것에 대한 보전)
        const carryRow = w.items.filter((it) => it.kind === "연구이월" || it.kind === "지원이월");
        const carryHS = carryRow.reduce((s, it) => s + Number(it.hSupport || 0) + (it.kind === "지원이월" ? Number(it.hExplain || 0) : 0), 0);
        const carryHR = carryRow.reduce((s, it) => s + Number(it.hResearch || 0) + (it.kind === "연구이월" ? Number(it.hExplain || 0) : 0), 0);

        // 실 활동 항목 = 이월 보전 row 제외
        const realItems = w.items.filter((it) => it.kind !== "연구이월" && it.kind !== "지원이월");
        // 관리자가 '이월 표시'한 활동은 당월 장부에서 빠짐
        const cutItemsRaw = realItems.filter((it) => isTrue(it.carry));
        const activeItems = realItems.filter((it) => !isTrue(it.carry));

        const hE = activeItems.reduce((s, it) => s + Number(it.hExplain || 0), 0);
        const hS = activeItems.reduce((s, it) => s + Number(it.hSupport || 0), 0);
        const hR = activeItems.reduce((s, it) => s + Number(it.hResearch || 0), 0);

        const cutItems = cutItemsRaw.map((it) => ({
          date: it.date, kind: it.kind, form: it.form || "", role: it.role || "",
          cutHExplain: Number(it.hExplain || 0),
          cutHSupport: Number(it.hSupport || 0),
          cutHResearch: Number(it.hResearch || 0),
          cutTotal: Number(it.hExplain || 0) + Number(it.hSupport || 0) + Number(it.hResearch || 0),
        }));
        const cutExplain  = Math.round(cutItems.reduce((s, it) => s + (it.cutHExplain || 0), 0) * 10) / 10;
        const cutSupport  = Math.round(cutItems.reduce((s, it) => s + (it.cutHSupport || 0), 0) * 10) / 10;
        const cutResearch = Math.round(cutItems.reduce((s, it) => s + (it.cutHResearch || 0), 0) * 10) / 10;

        const finalHE = hE;
        const finalHS = hS + carryHS;
        const finalHR = hR + carryHR;
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
          // 호환용 — 잘린 총 시수 (해설+연구+지원 모두 포함)
          cutExplain: cutExplain + cutSupport + cutResearch,
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
