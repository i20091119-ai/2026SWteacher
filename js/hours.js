// 주간 활동 시수 집계 (일~토 기준).
// 금액·단가는 다루지 않는다. 유형별 시수와 주간 상한 초과만 본다.
/**
 * 형태·역할별 표준 시수. 총 시수 안에 해설/지원이 얼마씩인지 정한다.
 * 앱은 합계만 쓰지만, 강사가 활동결과를 수기로 옮겨 적을 때 이 내역이 필요하다.
 *
 *   가족체험 · 학교체험          → 해설 3h                 (3h)
 *   주말어드벤처 토오전 / 토오후 → 해설 3h + 지원 0.5h     (3.5h)
 *   주말어드벤처 토종일          → 해설 6h + 지원 1h       (7h, 오전+오후)
 *   주말어드벤처 일오전          → 해설 3h + 지원 1h       (4h)
 */
window.STANDARD_HOURS = {
  // 형태 -> 역할 -> { explain, support }.  역할이 ""(공란)이면 DEFAULT 를 쓴다.
  TABLE: {
    "가족체험":     { DEFAULT: { explain: 3, support: 0 } },
    "학교체험":     { DEFAULT: { explain: 3, support: 0 } },
    "주말어드벤처": {
      "토오전": { explain: 3, support: 0.5 },
      "토오후": { explain: 3, support: 0.5 },
      "토종일": { explain: 6, support: 1 },
      "일오전": { explain: 3, support: 1 },
    },
  },

  entry(kind, form, role) {
    if (kind !== "해설") return null;
    const byRole = STANDARD_HOURS.TABLE[form];
    if (!byRole) return null;
    return byRole[role] || byRole.DEFAULT || null;
  },

  /** 표준 총 시수. 정해진 게 없으면 null. */
  total(kind, form, role) {
    const e = STANDARD_HOURS.entry(kind, form, role);
    return e ? e.explain + e.support : null;
  },

  /** 총 시수를 유형·형태·역할에 맞게 해설/지원/연구로 나눈다. */
  split(kind, form, role, total) {
    const h = Number(total) || 0;
    if (kind === "지원" || kind === "지원이월") return { hExplain: 0, hSupport: h, hResearch: 0 };
    if (kind === "연구" || kind === "연구이월") return { hExplain: 0, hSupport: 0, hResearch: h };
    const e = STANDARD_HOURS.entry(kind, form, role);
    const sup = Math.min(e ? e.support : 0, h);   // 시수를 줄여 잡으면 지원 몫부터 깎인다
    return { hExplain: h - sup, hSupport: sup, hResearch: 0 };
  },

  /** "해설 3h · 지원 0.5h" 처럼 사람이 읽을 내역. 쪼갤 게 없으면 빈 문자열. */
  label(a) {
    const parts = [];
    if (Number(a.hExplain) > 0) parts.push(`해설 ${fmtH(a.hExplain)}h`);
    if (Number(a.hSupport) > 0) parts.push(`지원 ${fmtH(a.hSupport)}h`);
    if (Number(a.hResearch) > 0) parts.push(`연구 ${fmtH(a.hResearch)}h`);
    return parts.length > 1 ? parts.join(" · ") : "";
  },
};

window.Hours = {
  // 월별 상한 (설정 키 `weeklyCap.YYYY-MM` 이 있으면 그 값이 우선)
  capForYm(ym) {
    const s = STATE.settings || {};
    const m = Number(s["weeklyCap." + ym]);
    if (m > 0) return m;
    return Number(s["weeklyCap"] || 20);
  },

  syncCap() { /* 설정은 STATE.settings 에서 그때그때 읽는다 */ },

  /** 강사 -> [{ wkStart, total, over, cap, byKind }] */
  weeklyView(ym, assignments) {
    const cap = Hours.capForYm(ym);
    const map = {};
    (assignments || []).forEach((a) => {
      const wk = weekStartSun(a.date);
      ((map[a.name] ||= {})[wk] ||= { total: 0, byKind: {} });
      const w = map[a.name][wk];
      const h = hoursOf(a);
      w.total += h;
      w.byKind[a.kind] = (w.byKind[a.kind] || 0) + h;
    });
    const out = {};
    Object.keys(map).forEach((name) => {
      out[name] = Object.keys(map[name]).sort().map((wk) => ({
        wkStart: wk,
        total: map[name][wk].total,
        byKind: map[name][wk].byKind,
        over: Math.max(0, map[name][wk].total - cap),
        cap,
      }));
    });
    return out;
  },

  /** 강사 -> { total, byKind } 월 합계 */
  monthTotals(assignments) {
    const out = {};
    (assignments || []).forEach((a) => {
      const t = (out[a.name] ||= { total: 0, byKind: {} });
      const h = hoursOf(a);
      t.total += h;
      t.byKind[a.kind] = (t.byKind[a.kind] || 0) + h;
    });
    return out;
  },
};
