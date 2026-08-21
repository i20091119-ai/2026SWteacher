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
    Admin.renderInstructorsCard();
    document.getElementById("admInsAdd").onclick = Admin.addInstructor;
    document.getElementById("admInsName").addEventListener("keydown", (e) => {
      if (e.key === "Enter") Admin.addInstructor();
    });
    document.getElementById("admRefresh").onclick = Admin.refreshAll;
    await Admin.loadMonth();
  },

  renderInstructorsCard() {
    const ul = document.getElementById("admInsList");
    ul.innerHTML = "";
    STATE.instructors.forEach((n) => {
      const li = document.createElement("li");
      li.innerHTML = `<span>${n}</span>`;
      const btn = document.createElement("button");
      btn.type = "button"; btn.textContent = "삭제";
      btn.onclick = () => Admin.removeInstructor(n);
      li.appendChild(btn);
      ul.appendChild(li);
    });
    if (!STATE.instructors.length) {
      ul.innerHTML = '<li><span class="muted">등록된 강사가 없습니다.</span></li>';
    }
  },

  async addInstructor() {
    const input = document.getElementById("admInsName");
    const name = (input.value || "").trim();
    if (!name) { alert("이름을 입력하세요."); return; }
    try {
      await API.addInstructor(name);
      input.value = "";
      await Admin.refreshAll();
    } catch (e) { alert("추가 실패: " + e.message); }
  },

  async removeInstructor(name) {
    if (!confirm(`'${name}' 강사를 명단에서 내리시겠습니까?\n순번·명단에서는 즉시 빠지고, 지난 배치와 장부 기록은 그대로 보존됩니다.`)) return;
    try {
      await API.removeInstructor(name);
      await Admin.refreshAll();
    } catch (e) { alert("삭제 실패: " + e.message); }
  },

  async refreshAll() {
    setStatus("loading", "강사 명단 다시 불러오는 중...");
    try {
      api.clearCache();
      const boot = await API.bootstrap();
      STATE.instructors = boot.instructors || [];
      STATE.assignableNames = boot.assignableNames || STATE.instructors;
      STATE.settings = boot.settings || {};
      Ledger.syncRates();
      Auth.renderInstructorButtons(STATE.instructors);
      Admin.renderInstructorsCard();
      setStatus("ok", `정상 · 강사 ${STATE.instructors.length}명`);
      await Admin.loadMonth();
    } catch (e) {
      setStatus("err", "새로고침 실패: " + e.message);
    }
  },

  async loadMonth() {
    const ym = document.getElementById("admMonth").value;
    // 당월 + 전월 배치 + 명단 + 설정을 한 번에 받는다. (예전에는 getMonth 를 두 번 호출했다)
    const data = await API.getAdminMonth(ym);
    Admin.data = data;
    STATE.cache.monthData[ym] = data;
    STATE.instructors = data.instructors || STATE.instructors;
    STATE.assignableNames = data.assignableNames || STATE.instructors;
    STATE.settings = data.settings || STATE.settings;
    Ledger.syncRates();

    // 강사 필터
    const sel = document.getElementById("admFilter");
    const keep = sel.value;
    sel.innerHTML = '<option value="">전체</option>' +
      STATE.instructors.map((n) => `<option>${n}</option>`).join("");
    if (keep && STATE.instructors.includes(keep)) sel.value = keep;

    Admin.renderInstructorsCard();
    Admin.renderSubmit(data);
    Admin.renderPublish(ym, data);
    Admin.renderViews();
  },

  /** 확정 근무표 공개 토글 — 강사 화면의 '확정 근무표'가 이 값에 따라 보인다. */
  renderPublish(ym, data) {
    const el = document.getElementById("admPublish");
    if (!el) return;
    el.innerHTML = `
      <label class="publish-row">
        <input type="checkbox" id="admPublishChk" ${data.published ? "checked" : ""} />
        <span>${ym} 확정 근무표를 강사에게 공개</span>
      </label>
      <span class="muted">${data.published ? "공개 중" : "비공개 (강사 화면에 표시되지 않음)"}</span>`;
    document.getElementById("admPublishChk").onchange = async (e) => {
      const on = e.target.checked;
      e.target.disabled = true;
      try {
        await API.setPublished(ym, on);
        await Admin.loadMonth();
      } catch (err) {
        alert("변경 실패: " + err.message);
        e.target.checked = !on;
      } finally {
        e.target.disabled = false;
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
      return `<tr><td>${n}</td><td>${s && s.submitted ? "제출" : "미제출"}</td><td>${s && s.submittedAt ? s.submittedAt : "-"}</td></tr>`;
    }).join("");
    tbl.innerHTML = `<thead><tr><th>강사</th><th>제출 여부</th><th>제출 일시</th></tr></thead><tbody>${rows}</tbody>` +
      (allSubmitted ? '<caption class="ok">전원 제출 · 편성 가능</caption>' : '<caption class="warn">미제출자 있음</caption>');
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
    const data = Admin.data || { assignments: [], unavails: [], holidays: [] };
    const filterName = document.getElementById("admFilter").value;
    const holidays = new Set(data.holidays || []);
    const unavByDate = {};
    (data.unavails || []).forEach((u) => { (unavByDate[u.date] ||= []).push(u); });
    const grid = Cal.buildGrid(ym, {
      holidays,
      renderDay: (ds, cell) => {
        if (unavByDate[ds] && unavByDate[ds].length) {
          const flag = document.createElement("div");
          flag.className = "uflag";
          flag.textContent = "불가:" + unavByDate[ds].map((u) => u.name).join(",");
          cell.appendChild(flag);
        }
        let items = (data.assignments || []).filter((a) => a.date === ds);
        if (filterName) items = items.filter((a) => a.name === filterName);
        items.forEach((a) => {
          const s = document.createElement("div");
          s.className = `slot kind-${a.kind}`;
          s.dataset.stop = "1";
          s.textContent = `${Admin.labelOf(a)} · ${a.name} (${Number(a.hExplain || 0) + Number(a.hSupport || 0) + Number(a.hResearch || 0)}h)`;
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
      html += `<h3>${n}</h3>`;
      html += `<table><thead><tr><th>주 시작(일)</th><th>해설</th><th>지원</th><th>연구</th><th>합계</th>${useLedger ? "<th>장부 밖 해설</th>" : "<th>초과</th>"}</tr></thead><tbody>`;
      rows.forEach((w) => {
        const tag = useLedger
          ? (w.cutExplain > 0 ? "warn" : "")
          : (w.over > 0 ? "warn" : "");
        const last = useLedger ? w.cutExplain : w.over;
        html += `<tr class="${tag}"><td>${w.wkStart}</td><td>${w.hExplain}</td><td>${w.hSupport}</td><td>${w.hResearch}</td><td>${w.total}</td><td>${last}</td></tr>`;
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
    const kinds = ["해설", "연구", "지원"];
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
      html += `<tr><td><span class="slot kind-${k}">${k}</span></td><td>${byKind[k].h}</td><td>${byKind[k].amt.toLocaleString()}원</td></tr>`;
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
      html += `<tr><td>${n}</td><td>${aSum}</td><td>${lSum}</td><td>${lTot.amount.toLocaleString()}원</td></tr>`;
    });
    html += "</tbody></table>";
    wrap.innerHTML = html;
  },

  openModal(a) {
    const m = document.getElementById("modal");
    const c = document.getElementById("modalContent");
    const title = document.getElementById("modalTitle");
    title.textContent = a.id ? "배치 편집" : "배치 추가";
    const kinds = ["해설", "연구", "지원"];
    const forms = ["", "학교체험", "가족체험", "주말어드벤처"];
    const roles = ["", "주", "보조", "토오전", "토오후", "일오전"];
    const opt = (arr, v) => arr.map((x) => `<option ${x === v ? "selected" : ""} value="${x}">${x || "-"}</option>`).join("");
    c.innerHTML = `
      <div class="grid-2">
        <label>날짜<input type="date" id="m_date" value="${a.date || ""}"/></label>
        <label>강사
          <select id="m_name">
            ${["", ...(STATE.assignableNames.length ? STATE.assignableNames : STATE.instructors)]
              .map((n) => `<option ${n === (a.name || "") ? "selected" : ""}>${n}</option>`).join("")}
          </select>
        </label>
        <label>유형 <select id="m_kind">${opt(kinds, a.kind || "해설")}</select></label>
        <label>형태 <select id="m_form">${opt(forms, a.form || "")}</select></label>
        <label>역할 <select id="m_role">${opt(roles, a.role || "")}</select></label>
        <label>해설시수 <input type="number" step="0.5" id="m_hE" value="${a.hExplain || 0}"/></label>
        <label>지원시수 <input type="number" step="0.5" id="m_hS" value="${a.hSupport || 0}"/></label>
        <label>연구시수 <input type="number" step="0.5" id="m_hR" value="${a.hResearch || 0}"/></label>
      </div>
      <label>메모 <input type="text" id="m_memo" value="${a.memo || ""}" style="width:100%"/></label>
      ${a.id ? '<div><button type="button" id="m_del" class="btn btn-danger">이 배치 삭제</button></div>' : ""}
    `;
    m.classList.remove("hidden");
    document.getElementById("modalCancel").onclick = () => m.classList.add("hidden");
    document.getElementById("modalSave").onclick = async () => {
      const payload = {
        id: a.id || null,
        date: document.getElementById("m_date").value,
        name: document.getElementById("m_name").value,
        kind: document.getElementById("m_kind").value,
        form: document.getElementById("m_form").value,
        role: document.getElementById("m_role").value,
        hExplain: Number(document.getElementById("m_hE").value || 0),
        hSupport: Number(document.getElementById("m_hS").value || 0),
        hResearch: Number(document.getElementById("m_hR").value || 0),
        memo: document.getElementById("m_memo").value,
      };
      if (!payload.date || !payload.name || !payload.kind) { alert("날짜·강사·유형은 필수입니다."); return; }
      try {
        await API.saveAssignment(payload);
        m.classList.add("hidden");
        await Admin.loadMonth();
      } catch (e) { alert("저장 실패: " + e.message); }
    };
    if (a.id) {
      document.getElementById("m_del").onclick = async () => {
        if (!confirm("삭제하시겠습니까?")) return;
        await API.deleteAssignment(a.id);
        m.classList.add("hidden");
        await Admin.loadMonth();
      };
    }
  },
};
