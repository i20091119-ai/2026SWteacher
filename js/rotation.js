// 순번 추천 (자동 배치 없음). 가족체험은 슬라이딩, 주말어드벤처는 시간대 묶음 단순 순환.
// 입력:
//   instructors: 가나다순 4명 배열
//   currentSeedPointer: 해당 월 시작 포인터 (0~3)
//   month assignments: 이미 배치된 일정 (불가일 양보 계산용)
//   unavails: {name -> Set of YYYY-MM-DD}
window.Rotation = {
  // 가족체험SW: 다음 회차 (주, 보조) 추천. 6·8·10월 첫 회는 주강사 표시만 이상우.
  nextFamily(ym, ins, seedP, monthAssignments, unavails) {
    // 이미 그 달에 편성된 가족체험 회차 수를 센다 (주강사 슬롯 기준)
    const placed = monthAssignments
      .filter((a) => a.form === "가족체험" && a.role === "주")
      .length;
    const month = Number(ym.split("-")[1]);
    const isFixedMonth = [6, 8, 10].includes(month) && placed === 0;
    // 내부 포인터: 회차마다 1씩 증가
    let p = (seedP + placed) % ins.length;
    let mainIdx = p;
    let subIdx = (p + 1) % ins.length;
    // 불가자 양보 처리 — 다음 추천 날짜는 아직 모르므로 양보는 화면에서 안내만.
    return {
      main: isFixedMonth ? "이상우" : ins[mainIdx],
      mainInternal: ins[mainIdx],
      sub: ins[subIdx],
      placedCount: placed,
      nextPointerAfter: (p + 1) % ins.length,
    };
  },
  // 주말어드벤처: 다음 묶음 (토오전/토오후/일오전) 추천.
  nextWeekend(ym, ins, seedP, monthAssignments) {
    const slots = ["토오전", "토오후", "일오전"];
    // 이미 편성된 묶음 수 = 토오전 슬롯 카운트
    const placedBundles = monthAssignments.filter(
      (a) => a.form === "주말어드벤처" && a.role === "토오전"
    ).length;
    const start = (seedP + placedBundles * slots.length) % ins.length;
    return {
      slots: slots.map((s, i) => ({ role: s, name: ins[(start + i) % ins.length] })),
      placedBundles,
      nextPointerAfter: (start + slots.length) % ins.length,
    };
  },
  // 불가자 양보: 추천된 강사가 그 날짜에 불가하면 다음 강사로 미루되, 미뤄진 강사를 다음 차례로 살린다.
  // (호출부에서 날짜가 정해진 뒤 적용)
  yieldIfUnavail(name, dateStr, ins, unavails, alreadyUsed) {
    if (!unavails[name] || !unavails[name].has(dateStr)) return name;
    const start = ins.indexOf(name);
    for (let k = 1; k <= ins.length; k++) {
      const cand = ins[(start + k) % ins.length];
      if ((!unavails[cand] || !unavails[cand].has(dateStr)) && !alreadyUsed.has(cand)) return cand;
    }
    return name;
  },
};
