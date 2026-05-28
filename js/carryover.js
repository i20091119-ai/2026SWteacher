// 월별 이월 계산 — 잘린 항목 역추적 + 다음 달 보전 권장 + 매칭
window.Carryover = {
  // srcYm의 schedule을 기준으로 강사별 잘린 항목과 다음 달 보전 권장 계산.
  // 잘린 시수는 ledgerView의 결과에서 추출. 보전 비율은 ×1 (연구·지원 단가 동일).
  computeFromMonth(srcYm, srcAssignments) {
    Ledger.syncRates();
    const view = Ledger.ledgerView(srcYm, srcAssignments);
    const out = {};
    Object.keys(view).forEach((name) => {
      const allCut = [];
      let cutS = 0, cutR = 0;
      view[name].weeks.forEach((w, idx) => {
        (w.cutItems || []).forEach((it) => {
          if ((it.cutHSupport || 0) + (it.cutHResearch || 0) > 0) {
            allCut.push({ ...it, wkStart: w.wkStart, wkIdx: idx + 1 });
          }
        });
        cutS += w.cutSupport || 0;
        cutR += w.cutResearch || 0;
      });
      const cutSupportH = Math.round(cutS * 10) / 10;
      const cutResearchH = Math.round(cutR * 10) / 10;
      if (cutSupportH > 0 || cutResearchH > 0) {
        out[name] = {
          srcYm,
          cutItems: allCut,
          cutSupportH,
          cutResearchH,
          // 연구·지원 단가 동일 → ×1 보전
          recommendedSupportH: cutSupportH,
          recommendedResearchH: cutResearchH,
          recommendedH: Math.round((cutSupportH + cutResearchH) * 10) / 10,
          // (참고) 보전 금액 = 잘린 시수 × 기타 단가
          compensationAmount: (cutSupportH + cutResearchH) * Ledger.rateOther,
        };
      }
    });
    return out;
  },

  // 다음 달 schedule에서 보전 편성(연구이월/지원이월)을 강사별로 합산.
  // 시수가 hExplain/hSupport/hResearch 어디 있든 합산.
  placedInMonth(assignments) {
    const placed = {};
    (assignments || []).forEach((a) => {
      if (a.kind !== "연구이월" && a.kind !== "지원이월") return;
      const name = String(a.name || "");
      if (!placed[name]) placed[name] = { research: 0, support: 0 };
      const h = Number(a.hExplain || 0) + Number(a.hSupport || 0) + Number(a.hResearch || 0);
      if (a.kind === "연구이월") placed[name].research = Math.round((placed[name].research + h) * 10) / 10;
      else placed[name].support = Math.round((placed[name].support + h) * 10) / 10;
    });
    return placed;
  },

  // 권장과 편성을 비교해 상태(complete/partial/missing) 산출
  matchStatus(recommendations, placedInNext) {
    const out = {};
    Object.keys(recommendations).forEach((name) => {
      const rec = recommendations[name];
      const p = placedInNext[name] || { research: 0, support: 0 };
      const remResearch = Math.max(0, Math.round((rec.recommendedResearchH - p.research) * 10) / 10);
      const remSupport = Math.max(0, Math.round((rec.recommendedSupportH - p.support) * 10) / 10);
      const placedTotal = p.research + p.support;
      const recommendedTotal = rec.recommendedH;
      let status = "missing";
      if (placedTotal >= recommendedTotal - 0.05) status = "complete";
      else if (placedTotal > 0) status = "partial";
      out[name] = {
        ...rec,
        placedResearch: p.research,
        placedSupport: p.support,
        remResearch,
        remSupport,
        status,
      };
    });
    return out;
  },
};
