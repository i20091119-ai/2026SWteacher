window.Admin = {
  view: "actual",
  data: null,

  async render() {
    document.getElementById("whoami").textContent = `관리자 · ${STATE.user.email || ""}`;
    const monthInput = document.getElementById("admMonth");
    if (!monthInput.value) monthInput.value = todayYm();
    monthInput.onchange = () => Admin.loadMonth();
    document.querySelectorAll(".seg button").forEach((b) => {
      b.onclick = () => {
        document.querySelectorAll(".seg button").forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
        Admin.view = b.dataset.view;
        Admin.renderViews();
      };
    });
    document.getElementById("admPrintBtn").onclick = () => window.print();
    document.getElementById("admFilter").onchange = () => Admin.renderViews();
    await Admin.loadMonth();
  },

  async loadMonth() {
    const ym = document.getElementById("admMonth").value;
    const cached = STATE.restoreMonthCache(ym);
    if (cached) {
      Admin.data = cached;
      Admin._renderAll(ym, cached);
    }
    try {
      const data = await API.getMonth(ym);
      Admin.data = data;
      STATE.saveMonthCache(ym, data);
      Admin._renderAll(ym, data);
      Admin._prefetchNeighbors(ym);
    } catch (e) {
      if (!cached) throw e;
      console.warn("[admin loadMonth] refresh 실패, 캐시 유지", e);
    }
  },

  async _prefetchNeighbors(ym) {
    const targets = [prevYm(ym), nextYm(ym)];
    for (const t of targets) {
      if (STATE.cache.monthData[t]) continue;
      try {
        const d = await API.getMonth(t);
        STATE.saveMonthCache(t, d);
      } catch (e) { /* 조용히 무시 */ }
    }
  },

  _renderAll(ym, data) {
    const sel = document.getElementById("admFilter");
    const prevVal = sel.value;
    sel.innerHTML = '<option value="">전체</option>' +
      STATE.instructors.map((n) => `<option>${n}</option>`).join("");
    sel.value = prevVal;
    Admin.renderPublishState(ym, data);
    Admin.renderSubmit(data);
    Admin.renderCarryover(ym);
    Admin.renderSwaps(ym, data);
    Admin.renderPrograms(data);
    Admin.renderNextUp(ym, data);
    Admin.renderViews();
  },

  renderPublishState(ym, data) {
    const btn = document.getElementById("admPublishBtn");
    const pill = document.getElementById("admPublishState");
    const published = !!data.published;
    if (published) {
      btn.textContent = "공개 취소";
      btn.classList.remove("btn-primary");
      pill.textContent = "✓ 공개됨 — 강사가 확정 활동표를 봅니다";
      pill.classList.remove("status-warn");
      pill.classList.add("status-ok");
    } else {
      btn.textContent = "활동표 공개";
      btn.classList.add("btn-primary");
      pill.textContent = "비공개 — 강사가 아직 못 봅니다";
      pill.classList.remove("status-ok");
      pill.classList.add("status-warn");
    }
    btn.onclick = async () => {
      const next = !published;
      if (next && !confirm(`${ym} 활동표를 공개하시겠습니까?\n공개 후 강사는 활동불가일을 더 이상 수정할 수 없고, 수업 교체 요청만 가능합니다.`)) return;
      if (!next && !confirm(`${ym} 활동표 공개를 취소하시겠습니까?`)) return;
      btn.disabled = true;
      try {
        await API.setSetting("publish." + ym, next ? 1 : "");
        // 캐시 무효화 후 새 데이터 로드
        delete STATE.cache.monthData[ym];
        try { sessionStorage.removeItem("swt_month_" + ym); } catch (e) {}
        await Admin.loadMonth();
      } catch (e) {
        alert("공개 상태 변경 실패: " + e.message);
      } finally {
        btn.disabled = false;
      }
    };
  },

  renderSubmit(data) {
    const ym = document.getElementById("admMonth").value;
    const tbl = document.getElementById("submitTable");
    let allSubmitted = true;
    const rows = STATE.instructors.map((n) => {
      const s = (data.submits || []).find((x) => x.ym === ym && x.name === n);
      if (!s || !s.submitted) allSubmitted = false;
      return `<tr><td>${nameLabel(n)}</td><td>${s && s.submitted ? "제출" : "미제출"}</td><td>${s && s.submittedAt ? s.submittedAt : "-"}</td></tr>`;
    }).join("");
    tbl.innerHTML = `<thead><tr><th>강사</th><th>제출 여부</th><th>제출 일시</th></tr></thead><tbody>${rows}</tbody>` +
      (allSubmitted ? '<caption class="ok">전원 제출 · 편성 가능</caption>' : '<caption class="warn">미제출자 있음</caption>');
  },

  renderCarryover(ym) {
    const target = document.getElementById("admCarryover");
    const prev = prevYm(ym);
    try {
      // 전월 데이터는 동일 getMonth 응답의 prevAssignments에서 (별도 호출 안 함)
      const prevAssignments = (Admin.data && Admin.data.prevAssignments) || [];
      const co = Carryover.computeFromMonth(prev, prevAssignments);
      const names = Object.keys(co).sort((a, b) => a.localeCompare(b, "ko"));
      const cap = Ledger.capForYm(prev);
      if (!names.length) {
        target.innerHTML = `<div class="muted">${prev} 기준 이월 대상이 없습니다. (주간 상한 ${cap}h)</div>`;
        return;
      }
      const placed = Carryover.placedInMonth((Admin.data && Admin.data.assignments) || []);
      const status = Carryover.matchStatus(co, placed);

      const allWeeks = new Set();
      names.forEach((n) => co[n].cutItems.forEach((it) => allWeeks.add(it.wkStart)));
      const weeks = [...allWeeks].sort();

      const missingCount = names.filter((n) => status[n].status === "missing").length;
      const partialCount = names.filter((n) => status[n].status === "partial").length;
      const completeCount = names.filter((n) => status[n].status === "complete").length;

      let html = "";
      html += `<div class="co-summary-bar">`;
      html += `<span class="muted">${prev} → ${ym} · 주간 상한 ${cap}h</span>`;
      if (missingCount) html += ` <span class="badge badge-warn">미반영 ${missingCount}명</span>`;
      if (partialCount) html += ` <span class="badge badge-amber">일부 ${partialCount}명</span>`;
      if (completeCount) html += ` <span class="badge badge-green">완료 ${completeCount}명</span>`;
      html += `</div>`;

      html += `<div class="co-matrix-wrap"><table class="co-matrix"><thead><tr><th>주차</th>`;
      names.forEach((n) => { html += `<th>${nameLabel(n)}</th>`; });
      html += `</tr></thead><tbody>`;

      weeks.forEach((wk, idx) => {
        html += `<tr><td><b>${idx + 1}주차</b><br><span class="muted">${wk.slice(5)}~</span></td>`;
        names.forEach((n) => {
          const items = co[n].cutItems.filter((it) => it.wkStart === wk);
          if (!items.length) {
            html += `<td class="co-cell-empty">—</td>`;
          } else {
            const inner = items.map((it) => {
              const tags = [];
              if (it.cutHResearch > 0) tags.push(`<span class="co-tag research">연 ${it.cutHResearch}h</span>`);
              if (it.cutHSupport > 0) tags.push(`<span class="co-tag support">지 ${it.cutHSupport}h</span>`);
              return `<div class="co-cut-item">${it.date.slice(5)} ${tags.join("")}</div>`;
            }).join("");
            html += `<td>${inner}</td>`;
          }
        });
        html += `</tr>`;
      });

      html += `<tr class="co-summary"><td>보전 권장</td>`;
      names.forEach((n) => {
        const r = co[n];
        const parts = [];
        if (r.recommendedResearchH > 0) parts.push(`<span class="co-tag research">연 ${r.recommendedResearchH}h</span>`);
        if (r.recommendedSupportH > 0) parts.push(`<span class="co-tag support">지 ${r.recommendedSupportH}h</span>`);
        html += `<td>${parts.join(" ") || "—"}</td>`;
      });
      html += `</tr>`;

      html += `<tr class="co-summary"><td>${ym} 편성</td>`;
      names.forEach((n) => {
        const s = status[n];
        const klass = "co-status-" + s.status;
        const icon = s.status === "complete" ? "✓ 완료" : s.status === "partial" ? "⚠ 일부" : "✗ 미반영";
        const detail = `연 ${s.placedResearch}h · 지 ${s.placedSupport}h`;
        const remaining = (s.remResearch > 0 || s.remSupport > 0)
          ? `<div class="muted">남음: ${s.remResearch > 0 ? `연 ${s.remResearch}h ` : ""}${s.remSupport > 0 ? `지 ${s.remSupport}h` : ""}</div>`
          : "";
        html += `<td class="${klass}"><div>${detail}</div><div><b>${icon}</b></div>${remaining}</td>`;
      });
      html += `</tr>`;

      html += `</tbody></table></div>`;
      html += `<p class="muted" style="margin-top:8px">관리자가 ${ym} 캘린더에 <b>연구이월</b>/<b>지원이월</b> kind로 항목을 추가하면 "편성" 행이 자동으로 갱신됩니다.</p>`;
      target.innerHTML = html;
    } catch (e) {
      target.innerHTML = `<div class="muted">전월(${prev}) 이월 계산 실패: ${e.message}</div>`;
    }
  },

  renderNextUp(ym, data) {
    const target = document.getElementById("admNextUp");
    const ins = STATE.instructors;
    // 시드 포인터: seeds[kind] (0~3)
    const seedFamily = (data.seeds || []).find((s) => s.ym === ym && s.kind === "가족체험");
    const seedWeekend = (data.seeds || []).find((s) => s.ym === ym && s.kind === "주말어드벤처");
    const sF = seedFamily ? Number(seedFamily.pointer) : 0;
    const sW = seedWeekend ? Number(seedWeekend.pointer) : 0;
    const fam = Rotation.nextFamily(ym, ins, sF, data.assignments || [], {});
    const wk = Rotation.nextWeekend(ym, ins, sW, data.assignments || []);
    target.innerHTML = `
      <div class="grid-2">
        <div>
          <h3>가족체험SW · 다음 회차</h3>
          <p>주강사: <b>${nameLabel(fam.main)}</b>${fam.main === "이상우" ? `<span class="muted"> (내부 순번: ${nameLabel(fam.mainInternal)})</span>` : ""}<br>
          보조강사: <b>${nameLabel(fam.sub)}</b><br>
          <span class="muted">현재 ${ym} 가족체험 편성 회차: ${fam.placedCount} · 다음 회차 후 포인터: ${fam.nextPointerAfter}</span></p>
          <label>가족체험 시작 포인터(이 달):
            <input type="number" min="0" max="3" value="${sF}" id="seedFamily" />
          </label>
          <button type="button" id="seedFamilySave">저장</button>
        </div>
        <div>
          <h3>주말어드벤처 · 다음 묶음</h3>
          <ul>${wk.slots.map((s) => `<li>${s.role}: <b>${nameLabel(s.name)}</b></li>`).join("")}</ul>
          <span class="muted">현재 ${ym} 주말어드벤처 편성 묶음: ${wk.placedBundles} · 묶음 후 포인터: ${wk.nextPointerAfter}</span><br>
          <label>주말어드벤처 시작 포인터(이 달):
            <input type="number" min="0" max="3" value="${sW}" id="seedWeekend" />
          </label>
          <button type="button" id="seedWeekendSave">저장</button>
        </div>
      </div>
      <p class="muted">자동 배치는 하지 않습니다. 캘린더에서 직접 배치하세요.</p>
    `;
    document.getElementById("seedFamilySave").onclick = async () => {
      const v = Number(document.getElementById("seedFamily").value);
      await API.setSeed(ym, "가족체험", v);
      await Admin.loadMonth();
    };
    document.getElementById("seedWeekendSave").onclick = async () => {
      const v = Number(document.getElementById("seedWeekend").value);
      await API.setSeed(ym, "주말어드벤처", v);
      await Admin.loadMonth();
    };
  },

  renderViews() {
    Admin.renderCalendarView();
    Admin.renderWeekly();
    Admin.renderSummary();
  },

  renderCalendarView() {
    const wrap = document.getElementById("admCalendar");
    wrap.innerHTML = "";
    const ym = document.getElementById("admMonth").value;
    const data = Admin.data || { assignments: [], unavails: [], holidays: [], programs: [] };
    const filterName = document.getElementById("admFilter").value;
    const holidays = new Set(data.holidays || []);
    const unavByDate = {};
    (data.unavails || []).forEach((u) => { (unavByDate[u.date] ||= []).push(u); });
    const programs = data.programs || [];
    // 실제 뷰: 모든 배치 표시. 장부 뷰: carry=true(이월 표시) 제외
    const visibleKinds = Admin.view === "ledger"
      ? (a) => !isTrue(a.carry)
      : null;
    const grid = Cal.buildGrid(ym, {
      holidays,
      renderDay: (ds, cell) => {
        // 학생 프로그램 (불가 표시보다 먼저 — 위쪽에 보이게)
        programs.filter((p) => ds >= p.dateStart && ds <= p.dateEnd).forEach((p) => {
          const div = document.createElement("div");
          const cls = p.session === "오후" ? "pm" : p.session === "오전" ? "am" : "none";
          div.className = "program program-" + cls;
          const parts = [];
          if (p.session) parts.push(p.session);
          parts.push(p.school);
          if (p.students > 0) parts.push(p.students + "명");
          div.textContent = parts.join(" ");
          div.title = `${p.dateStart}${p.dateStart !== p.dateEnd ? "~" + p.dateEnd : ""} ${parts.join(" ")}${p.note ? " · " + p.note : ""}`;
          div.dataset.stop = "1";
          cell.appendChild(div);
        });
        if (unavByDate[ds] && unavByDate[ds].length) {
          const flag = document.createElement("div");
          flag.className = "uflag";
          flag.textContent = "불가:" + unavByDate[ds].map((u) => u.name).join(",");
          cell.appendChild(flag);
        }
        let items = (data.assignments || []).filter((a) => a.date === ds);
        if (visibleKinds) items = items.filter(visibleKinds);
        if (filterName) items = items.filter((a) => a.name === filterName);
        items.forEach((a) => {
          const s = document.createElement("div");
          let cls = `slot kind-${a.kind.replace(/[()]/g, "")}`;
          if (isTrue(a.carry)) cls += " carry-flag";
          s.className = cls;
          s.dataset.stop = "1";
          const h = Number(a.hExplain || 0) + Number(a.hSupport || 0) + Number(a.hResearch || 0);

          const isCarryKind = (a.kind === "연구이월" || a.kind === "지원이월");
          const isCarryMarked = isTrue(a.carry);
          let badge = "";
          let labelKindShort = a.kind;
          if (isCarryKind) {
            badge = '<span class="carry-badge carry-in">⇩ 이월</span> ';
            labelKindShort = a.kind.replace("이월", "");
          } else if (isCarryMarked) {
            badge = '<span class="carry-badge carry-out">↻ 다음달이월</span> ';
          }
          const label = labelKindShort + (a.form ? "·" + a.form : "") + (a.role ? "·" + a.role : "");
          s.innerHTML = `${badge}${label} · ${nameLabel(a.name)} (${h}h)`;
          if (a.memo && String(a.memo).trim()) {
            const m = document.createElement("div");
            m.className = "slot-memo";
            m.textContent = "📝 " + a.memo;
            s.appendChild(m);
          }
          const tips = [];
          if (isCarryKind) tips.push("전월에서 이월된 보전 활동");
          if (isCarryMarked) tips.push("다음 달로 이월 표시된 활동 (당월 장부에서 제외)");
          if (a.memo) tips.push("비고: " + a.memo);
          if (tips.length) s.title = tips.join("\n");
          s.onclick = () => Admin.openModal(a);
          cell.appendChild(s);
        });
        const add = document.createElement("div");
        add.className = "add"; add.textContent = "+ 추가"; add.dataset.stop = "1";
        add.onclick = () => Admin.openModal({ date: ds });
        cell.appendChild(add);
      },
    });
    wrap.appendChild(grid);
  },

  labelOf(a) {
    if (a.form && a.role) return `${a.kind}·${a.form}·${a.role}`;
    if (a.form) return `${a.kind}·${a.form}`;
    return a.kind;
  },

  renderWeekly() {
    const wrap = document.getElementById("admWeekly");
    const ym = document.getElementById("admMonth").value;
    const data = Admin.data || { assignments: [] };
    const filterName = document.getElementById("admFilter").value;
    const useLedger = Admin.view === "ledger";
    const view = useLedger
      ? Ledger.ledgerView(ym, data.assignments || [])
      : Ledger.actualView(ym, data.assignments || []);
    const names = Object.keys(view).filter((n) => !filterName || n === filterName);
    let html = "";
    names.forEach((n) => {
      const rows = useLedger ? view[n].weeks : view[n];
      html += `<h3>${nameLabel(n)}</h3>`;
      // 실제 뷰: 이월(연구)/이월(지원) 컬럼 추가. 장부 뷰는 이월이 합계에 포함되므로 별도 컬럼 없음.
      html += `<table><thead><tr><th>주 시작(일)</th><th>해설</th><th>지원</th><th>연구</th>` +
        (useLedger ? "" : "<th>이월(연)</th><th>이월(지)</th>") +
        `<th>합계</th>${useLedger ? "<th>잘린 시수</th>" : "<th>초과</th>"}</tr></thead><tbody>`;
      rows.forEach((w) => {
        const tag = useLedger
          ? (w.cutExplain > 0 ? "warn" : "")
          : (w.over > 0 ? "warn" : "");
        const last = useLedger ? w.cutExplain : w.over;
        const carryCells = useLedger ? "" :
          `<td>${w.carryResearch || 0}</td><td>${w.carrySupport || 0}</td>`;
        html += `<tr class="${tag}"><td>${w.wkStart}</td><td>${w.hExplain}</td><td>${w.hSupport}</td><td>${w.hResearch}</td>${carryCells}<td>${w.total}</td><td>${last}</td></tr>`;
      });
      html += `</tbody></table>`;
      if (useLedger) {
        const t = view[n].totals;
        html += `<p>월 합계 — 해설 ${t.hExplain}h · 지원 ${t.hSupport}h · 연구 ${t.hResearch}h · 금액 ${t.amount.toLocaleString()}원</p>`;
      }
    });
    wrap.innerHTML = html || '<div class="muted">데이터 없음</div>';
  },

  renderSummary() {
    const wrap = document.getElementById("admSummary");
    const ym = document.getElementById("admMonth").value;
    const data = Admin.data || { assignments: [] };
    const ass = data.assignments || [];
    // 월별 유형별 집계
    const kinds = ["해설", "연구", "지원", "연구이월", "지원이월"];
    const byKind = {};
    kinds.forEach((k) => (byKind[k] = { h: 0, amt: 0 }));
    ass.forEach((a) => {
      const h = Number(a.hExplain || 0) + Number(a.hSupport || 0) + Number(a.hResearch || 0);
      if (!byKind[a.kind]) byKind[a.kind] = { h: 0, amt: 0 };
      byKind[a.kind].h += h;
      byKind[a.kind].amt += (a.kind === "해설")
        ? Number(a.hExplain || 0) * Ledger.rateExplain + (Number(a.hSupport || 0) + Number(a.hResearch || 0)) * Ledger.rateOther
        : (Number(a.hExplain || 0) * Ledger.rateExplain + (Number(a.hSupport || 0) + Number(a.hResearch || 0)) * Ledger.rateOther);
    });
    let html = `<h3>월별 유형별 집계 (${ym})</h3>`;
    html += "<table><thead><tr><th>유형</th><th>시수</th><th>금액</th></tr></thead><tbody>";
    Object.keys(byKind).forEach((k) => {
      html += `<tr><td>${k}</td><td>${byKind[k].h}</td><td>${byKind[k].amt.toLocaleString()}</td></tr>`;
    });
    html += "</tbody></table>";

    // 강사별 실제 vs 장부 비교
    const actual = Ledger.actualView(ym, ass);
    const ledger = Ledger.ledgerView(ym, ass);
    html += "<h3>강사별 — 실제 vs 장부</h3>";
    html += "<table><thead><tr><th>강사</th><th>실제 합계(h)</th><th>장부 합계(h)</th><th>장부 금액</th></tr></thead><tbody>";
    STATE.instructors.forEach((n) => {
      const aSum = (actual[n] || []).reduce((s, w) => s + w.total, 0);
      const lTot = (ledger[n] && ledger[n].totals) || { hExplain: 0, hSupport: 0, hResearch: 0, amount: 0 };
      const lSum = lTot.hExplain + lTot.hSupport + lTot.hResearch;
      html += `<tr><td>${nameLabel(n)}</td><td>${aSum}</td><td>${lSum}</td><td>${lTot.amount.toLocaleString()}</td></tr>`;
    });
    html += "</tbody></table>";
    wrap.innerHTML = html;
  },

  openModal(a) {
    const m = document.getElementById("modal");
    const c = document.getElementById("modalContent");
    const title = document.getElementById("modalTitle");
    const isEdit = !!a.id;
    title.textContent = isEdit ? "배치 편집" : "배치 추가";
    const kinds = ["해설", "연구", "지원", "연구이월", "지원이월"];
    const forms = ["", "학교체험", "가족체험", "주말어드벤처"];
    const roles = ["", "주", "보조", "토오전", "토오후", "일오전"];
    const opt = (arr, v) => arr.map((x) => `<option ${x === v ? "selected" : ""} value="${x}">${x || "-"}</option>`).join("");

    // 강사 영역: 신규는 다중 체크박스, 편집은 단일 select
    const allInstructors = [...STATE.instructors, "이상우"];
    const namesHtml = isEdit
      ? `<label>강사
          <select id="m_name">
            ${["", ...allInstructors].map((n) => `<option ${n === (a.name || "") ? "selected" : ""}>${n}</option>`).join("")}
          </select>
        </label>`
      : `<label class="full">강사 <span class="muted">(여러 명 선택 가능)</span>
          <div class="checkbox-group" id="m_names">
            ${allInstructors.map((n) => `
              <label class="chip"><input type="checkbox" value="${n}" />${nameLabel(n) !== n ? nameLabel(n) : `<span>${n}</span>`}</label>
            `).join("")}
          </div>
        </label>`;

    c.innerHTML = `
      <div class="grid-2">
        <label>날짜<input type="date" id="m_date" value="${a.date || ""}"/></label>
        <label>유형 <select id="m_kind">${opt(kinds, a.kind || "해설")}</select></label>
        <label>형태 <select id="m_form">${opt(forms, a.form || "")}</select></label>
        <label>역할 <select id="m_role">${opt(roles, a.role || "")}</select></label>
        <label>해설시수 <input type="number" step="0.5" id="m_hE" value="${a.hExplain || 0}"/></label>
        <label>지원시수 <input type="number" step="0.5" id="m_hS" value="${a.hSupport || 0}"/></label>
        <label>연구시수 <input type="number" step="0.5" id="m_hR" value="${a.hResearch || 0}"/></label>
      </div>
      ${namesHtml}
      <p class="muted" style="margin-top:8px">형태 선택 시 표준 시수가 자동으로 채워집니다(연구·지원 유형은 직접 입력).</p>
      <label>메모 <input type="text" id="m_memo" value="${a.memo || ""}" style="width:100%"/></label>
      <label class="checkbox-inline" style="display:flex;align-items:center;gap:8px;margin-top:10px;padding:10px 12px;background:var(--amber-soft);border:1px solid #fde68a;border-radius:8px;cursor:pointer">
        <input type="checkbox" id="m_carry" ${isTrue(a.carry) ? "checked" : ""} />
        <span><b>↻ 이월 표시</b> — 이 활동을 다음 달로 이월 (당월 장부/금액에서 제외)</span>
      </label>
      ${isEdit ? '<p><button type="button" id="m_del" style="color:#c53030">삭제</button></p>' : ""}
    `;
    // form/kind/role 변경 시 표준 시수 자동 적용
    const apply = () => Admin.applyDefaultHours();
    document.getElementById("m_kind").onchange = apply;
    document.getElementById("m_form").onchange = apply;
    document.getElementById("m_role").onchange = apply;
    m.classList.remove("hidden");
    document.getElementById("modalCancel").onclick = () => m.classList.add("hidden");
    document.getElementById("modalSave").onclick = async () => {
      const common = {
        date: document.getElementById("m_date").value,
        kind: document.getElementById("m_kind").value,
        form: document.getElementById("m_form").value,
        role: document.getElementById("m_role").value,
        hExplain: Number(document.getElementById("m_hE").value || 0),
        hSupport: Number(document.getElementById("m_hS").value || 0),
        hResearch: Number(document.getElementById("m_hR").value || 0),
        memo: document.getElementById("m_memo").value,
        carry: document.getElementById("m_carry").checked,
      };
      if (!common.date || !common.kind) { alert("날짜·유형은 필수입니다."); return; }
      try {
        if (isEdit) {
          const name = document.getElementById("m_name").value;
          if (!name) { alert("강사를 선택하세요."); return; }
          await API.saveAssignment({ id: a.id, name, ...common });
        } else {
          const names = Array.from(document.querySelectorAll("#m_names input:checked")).map((c) => c.value);
          if (!names.length) { alert("강사를 1명 이상 선택하세요."); return; }
          const batch = names.map((name) => ({ name, ...common }));
          try {
            await API.saveAssignmentsBatch(batch);
          } catch (e) {
            // 옛 GAS(새 배포 전)이면 saveAssignmentsBatch가 없음 → 단일 호출 loop로 fallback
            if (/알 수 없는 action/.test(String(e.message))) {
              for (const item of batch) await API.saveAssignment(item);
            } else {
              throw e;
            }
          }
        }
        m.classList.add("hidden");
        await Admin.loadMonth();
      } catch (e) { alert("저장 실패: " + e.message); }
    };
    if (isEdit) {
      document.getElementById("m_del").onclick = async () => {
        if (!confirm("삭제하시겠습니까?")) return;
        await API.deleteAssignment(a.id);
        m.classList.add("hidden");
        await Admin.loadMonth();
      };
    }
  },

  renderSwaps(ym, data) {
    const wrap = document.getElementById("admSwaps");
    if (!wrap) return;
    const swaps = data.swaps || [];
    const assignments = data.assignments || [];
    const findA = (id) => assignments.find((a) => a.id === id);
    const labelA = (a) => a ? `${a.date} ${Admin.labelOf(a)}` : "(배치 없음)";

    const pending = swaps.filter((s) => s.status === "pending_admin")
      .sort((a, b) => String(a.requestedAt).localeCompare(String(b.requestedAt)));
    const recent = swaps.filter((s) => s.status !== "pending_admin")
      .sort((a, b) => String(b.finalizedAt || b.requestedAt).localeCompare(String(a.finalizedAt || a.requestedAt)))
      .slice(0, 10);

    let html = "";
    if (!pending.length && !recent.length) {
      html = '<div class="muted">이번 달 신청된 일정 변경 요청이 없습니다.</div>';
    } else {
      if (pending.length) {
        html += `<h3 class="subsection">승인 대기 <span class="badge badge-amber">${pending.length}건</span></h3>`;
        html += '<div id="admSwapsPendingList"></div>';
      }
      if (recent.length) {
        html += `<h3 class="subsection">최근 처리 내역</h3>`;
        html += '<div id="admSwapsRecentList"></div>';
      }
    }
    wrap.innerHTML = html;

    const pendingList = document.getElementById("admSwapsPendingList");
    if (pendingList) {
      pending.forEach((s) => {
        const a = findA(s.assignmentId);
        const div = document.createElement("div");
        div.className = "swap-row swap-status-pending_admin";
        const span = document.createElement("span");
        span.innerHTML = `<b>${nameLabel(s.requester)}</b> → <b>${nameLabel(s.target)}</b> · ${labelA(a)} <span class="muted">(${(s.requestedAt || "").slice(0, 10)})</span>`;
        div.appendChild(span);
        const ok = document.createElement("button");
        ok.type = "button"; ok.textContent = "승인"; ok.className = "primary";
        ok.onclick = async () => { await Admin.swapAction(API.approveSwap, s.id, "승인"); };
        const no = document.createElement("button");
        no.type = "button"; no.textContent = "거절";
        no.onclick = async () => {
          if (!confirm(`${s.requester} → ${s.target} 요청을 거절하시겠습니까?`)) return;
          await Admin.swapAction(API.rejectSwap, s.id, "거절");
        };
        div.appendChild(ok);
        div.appendChild(no);
        pendingList.appendChild(div);
      });
    }
    const recentList = document.getElementById("admSwapsRecentList");
    if (recentList) {
      recent.forEach((s) => {
        const a = findA(s.assignmentId);
        const div = document.createElement("div");
        div.className = "swap-row swap-status-" + s.status;
        const tag = ({ completed: "✓ 승인", rejected: "✗ 거절", cancelled: "· 취소" })[s.status] || s.status;
        div.innerHTML = `<span><b>${nameLabel(s.requester)}</b> → <b>${nameLabel(s.target)}</b> · ${labelA(a)} <span class="muted">· ${tag} · ${(s.finalizedAt || s.requestedAt || "").slice(0, 10)}</span></span>`;
        recentList.appendChild(div);
      });
    }
  },

  async swapAction(fn, swapId, label) {
    try {
      await fn(swapId);
      await Admin.loadMonth();
    } catch (e) { alert(label + " 실패: " + e.message); }
  },

  renderPrograms(data) {
    const wrap = document.getElementById("admPrograms");
    if (!wrap) return;
    const programs = (data.programs || []).slice()
      .sort((a, b) => a.dateStart.localeCompare(b.dateStart));
    if (!programs.length) {
      wrap.innerHTML = '<div class="muted">이 달에 등록된 학생 프로그램이 없습니다.</div>';
    } else {
      let html = '<table><thead><tr><th>기간</th><th>시간</th><th>학교</th><th>학생수</th><th>메모</th><th></th></tr></thead><tbody>';
      programs.forEach((p) => {
        const range = p.dateStart === p.dateEnd ? p.dateStart : `${p.dateStart} ~ ${p.dateEnd}`;
        html += `<tr>
          <td>${range}</td>
          <td>${p.session ? `<span class="badge ${p.session === "오후" ? "badge-warn" : "badge-amber"}">${p.session}</span>` : '<span class="muted">—</span>'}</td>
          <td><b>${p.school}</b></td>
          <td>${p.students}명</td>
          <td class="muted">${p.note || ""}</td>
          <td>
            <button data-id="${p.id}" data-act="edit" class="btn">편집</button>
            <button data-id="${p.id}" data-act="del" class="btn">삭제</button>
          </td>
        </tr>`;
      });
      html += '</tbody></table>';
      wrap.innerHTML = html;
      wrap.querySelectorAll("button[data-act='edit']").forEach((b) => {
        b.onclick = () => {
          const p = programs.find((x) => x.id === b.dataset.id);
          Admin.openProgramModal(p);
        };
      });
      wrap.querySelectorAll("button[data-act='del']").forEach((b) => {
        b.onclick = async () => {
          if (!confirm("프로그램을 삭제하시겠습니까?")) return;
          try { await API.deleteProgram(b.dataset.id); await Admin.loadMonth(); }
          catch (e) { alert("삭제 실패: " + e.message); }
        };
      });
    }
    const addBtn = document.getElementById("admProgramAddBtn");
    if (addBtn) addBtn.onclick = () => Admin.openProgramModal(null);
  },

  openProgramModal(p) {
    p = p || {};
    const m = document.getElementById("modal");
    const c = document.getElementById("modalContent");
    document.getElementById("modalTitle").textContent = p.id ? "학생 프로그램 편집" : "학생 프로그램 추가";
    const sess = p.session || "오전";
    c.innerHTML = `
      <div class="grid-2">
        <label>시작일 <input type="date" id="p_start" value="${p.dateStart || ""}"/></label>
        <label>종료일 <input type="date" id="p_end" value="${p.dateEnd || p.dateStart || ""}"/></label>
        <label>시간대
          <select id="p_session">
            <option value="오전" ${sess === "오전" ? "selected" : ""}>오전</option>
            <option value="오후" ${sess === "오후" ? "selected" : ""}>오후</option>
            <option value="" ${sess === "" ? "selected" : ""}>(시간 없음)</option>
          </select>
        </label>
        <label>학교 <input type="text" id="p_school" value="${(p.school || "").replace(/"/g, "&quot;")}" placeholder="예: 호계초"/></label>
        <label>학생수 <input type="number" id="p_students" value="${p.students || 0}" min="0"/></label>
      </div>
      <label>메모 <input type="text" id="p_note" value="${(p.note || "").replace(/"/g, "&quot;")}" style="width:100%"/></label>
      ${p.id ? `<p><button type="button" id="p_del" style="color:#c53030">삭제</button></p>` : ""}
    `;
    m.classList.remove("hidden");
    document.getElementById("modalCancel").onclick = () => m.classList.add("hidden");
    document.getElementById("modalSave").onclick = async () => {
      const payload = {
        id: p.id || null,
        dateStart: document.getElementById("p_start").value,
        dateEnd: document.getElementById("p_end").value || document.getElementById("p_start").value,
        session: document.getElementById("p_session").value,
        school: document.getElementById("p_school").value.trim(),
        students: Number(document.getElementById("p_students").value || 0),
        note: document.getElementById("p_note").value.trim(),
      };
      if (!payload.dateStart || !payload.school) { alert("시작일·학교는 필수입니다."); return; }
      if (payload.dateEnd < payload.dateStart) { alert("종료일이 시작일보다 빠릅니다."); return; }
      try {
        if (payload.id) await API.updateProgram(payload);
        else await API.createProgram(payload);
        m.classList.add("hidden");
        await Admin.loadMonth();
      } catch (e) { alert("저장 실패: " + e.message); }
    };
    if (p.id) {
      document.getElementById("p_del").onclick = async () => {
        if (!confirm("삭제하시겠습니까?")) return;
        try {
          await API.deleteProgram(p.id);
          m.classList.add("hidden");
          await Admin.loadMonth();
        } catch (e) { alert("삭제 실패: " + e.message); }
      };
    }
  },

  // 형태별 표준 시수 자동 채움 (해설 kind에만 적용)
  applyDefaultHours() {
    const kind = document.getElementById("m_kind").value;
    const form = document.getElementById("m_form").value;
    const role = document.getElementById("m_role").value;
    if (kind !== "해설") return;
    let hE = null, hS = null, hR = null;
    if (form === "가족체험" || form === "학교체험") {
      hE = 3; hS = 0; hR = 0;
    } else if (form === "주말어드벤처") {
      // 일오전 = 해설 3h + 지원 1h (도합 4h)
      // 토오전/토오후 = 해설 3h + 지원 0.5h
      hE = 3; hS = (role === "일오전") ? 1 : 0.5; hR = 0;
    } else {
      return;
    }
    document.getElementById("m_hE").value = hE;
    document.getElementById("m_hS").value = hS;
    document.getElementById("m_hR").value = hR;
  },
};
