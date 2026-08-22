window.Admin = {
  data: null,

  async render() {
    document.getElementById("whoami").textContent = `관리자 · ${STATE.user.email || ""}`;
    const monthInput = document.getElementById("admMonth");
    if (!monthInput.value) monthInput.value = todayYm();
    monthInput.onchange = () => Admin.loadMonth();
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
      const data = await API.getAdminMonth(ym);
      Admin.data = data;
      // 명단·설정도 같은 응답에 들어있다 (별도 bootstrap 왕복 없음)
      if (data.instructors) STATE.instructors = data.instructors;
      if (data.assignableNames) STATE.assignableNames = data.assignableNames;
      if (data.settings) { STATE.settings = data.settings; Hours.syncCap(); }
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
        const d = await API.getAdminMonth(t);
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
    Admin.renderSwaps(ym, data);
    Admin.renderPrograms(data);
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
        await API.setPublished(ym, next);
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

  renderViews() {
    Admin.renderCalendarView();
    Admin.renderMatrix();
    Admin.renderWeekly();
    Admin.renderSummary();
  },

  /**
   * 주(행) × 강사(열) 교차표.
   * 한 주에 누가 몇 시간인지, 그 주에 누가 비어 있는지를 한 화면에서 본다.
   */
  renderMatrix() {
    const wrap = document.getElementById("admMatrix");
    if (!wrap) return;
    const ym = document.getElementById("admMonth").value;
    const data = Admin.data || { assignments: [] };
    const ass = data.assignments || [];
    const filterName = document.getElementById("admFilter").value;
    const cap = Hours.capForYm(ym);

    if (!ass.length) {
      wrap.innerHTML = `<div class="muted">${ym}에 배치된 활동이 없습니다.</div>`;
      return;
    }

    // 열: 명단 순서. 명단에 없지만 배치가 있는 이름(파견교사 등)은 뒤에 붙인다.
    const extra = [...new Set(ass.map((a) => a.name))].filter((n) => !STATE.instructors.includes(n));
    let names = [...STATE.instructors, ...sortKo(extra)];
    if (filterName) names = names.filter((n) => n === filterName);

    // 행: 그 달을 덮는 모든 주(일요일 시작). 활동이 없는 주도 빈칸으로 보여준다.
    const [y, mo] = ym.split("-").map(Number);
    const weeks = [];
    for (let d = new Date(y, mo - 1, 1); d.getMonth() === mo - 1; d.setDate(d.getDate() + 1)) {
      const wk = weekStartSun(dateStr(d));
      if (!weeks.includes(wk)) weeks.push(wk);
    }

    // (강사, 주) -> 시수
    const cell = {};
    ass.forEach((a) => {
      const k = a.name + "|" + weekStartSun(a.date);
      cell[k] = (cell[k] || 0) + hoursOf(a);
    });

    const colTotal = {};
    let grand = 0;
    let html = `<p class="muted" style="margin-bottom:10px">주간 상한: <b>${cap}h</b></p>`;
    html += `<div class="matrix-wrap"><table class="matrix"><thead><tr><th>주 시작(일)</th>` +
      names.map((n) => `<th>${nameLabel(n)}</th>`).join("") + `<th>주 합계</th></tr></thead><tbody>`;

    weeks.forEach((wk) => {
      let rowTotal = 0;
      const cells = names.map((n) => {
        const v = cell[n + "|" + wk] || 0;
        rowTotal += v;
        colTotal[n] = (colTotal[n] || 0) + v;
        if (v === 0) return `<td class="m-zero">·</td>`;
        return `<td class="${v > cap ? "warn" : ""}">${fmtH(v)}</td>`;
      }).join("");
      grand += rowTotal;
      html += `<tr><th scope="row">${wk}</th>${cells}<td class="m-total">${rowTotal ? fmtH(rowTotal) : "·"}</td></tr>`;
    });

    html += `</tbody><tfoot><tr><th scope="row">월 합계</th>` +
      names.map((n) => `<td class="m-total">${colTotal[n] ? fmtH(colTotal[n]) : "·"}</td>`).join("") +
      `<td class="m-total">${fmtH(grand)}</td></tr></tfoot></table></div>`;
    wrap.innerHTML = html;
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
        if (filterName) items = items.filter((a) => a.name === filterName);
        items.forEach((a) => {
          const s = document.createElement("div");
          s.className = `slot kind-${Admin.kindClass(a.kind)}`;
          s.dataset.stop = "1";
          const h = hoursOf(a);
          const label = a.kind + (a.form ? "·" + a.form : "") + (a.role ? "·" + a.role : "");
          s.innerHTML = `${label} · ${nameLabel(a.name)} (${fmtH(h)}h)`;
          const bd = STANDARD_HOURS.label(a);
          if (bd) {
            const d = document.createElement("div");
            d.className = "slot-breakdown";
            d.textContent = bd;
            s.appendChild(d);
          }
          if (a.memo && String(a.memo).trim()) {
            const m = document.createElement("div");
            m.className = "slot-memo";
            m.textContent = "📝 " + a.memo;
            s.appendChild(m);
            s.title = "비고: " + a.memo;
          }
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
    const ass = (data.assignments || []).filter((a) => !filterName || a.name === filterName);
    if (!ass.length) { wrap.innerHTML = '<div class="muted">데이터 없음</div>'; return; }

    const cap = Hours.capForYm(ym);
    // 강사 -> 주 -> 유형별 시수
    const map = {};
    ass.forEach((a) => {
      const wk = weekStartSun(a.date);
      ((map[a.name] ||= {})[wk] ||= { total: 0, byKind: {} });
      const w = map[a.name][wk];
      const h = hoursOf(a);
      w.total += h;
      w.byKind[a.kind] = (w.byKind[a.kind] || 0) + h;
    });
    const kinds = [...new Set(ass.map((a) => a.kind))].sort();

    let html = `<p class="muted" style="margin-bottom:10px">주간 상한: <b>${cap}h</b></p>`;
    sortKo(Object.keys(map)).forEach((n) => {
      html += `<h3>${nameLabel(n)}</h3>`;
      html += `<table><thead><tr><th>주 시작(일)</th>${kinds.map((k) => `<th>${k}</th>`).join("")}<th>합계</th><th>초과</th></tr></thead><tbody>`;
      Object.keys(map[n]).sort().forEach((wk) => {
        const w = map[n][wk];
        const over = Math.max(0, w.total - cap);
        html += `<tr class="${over > 0 ? "warn" : ""}"><td>${wk}</td>` +
          kinds.map((k) => `<td>${w.byKind[k] ? fmtH(w.byKind[k]) : "·"}</td>`).join("") +
          `<td><b>${fmtH(w.total)}</b></td><td>${over > 0 ? `<b>${fmtH(over)}h</b>` : "—"}</td></tr>`;
      });
      html += `</tbody></table>`;
    });
    wrap.innerHTML = html;
  },

  renderSummary() {
    const wrap = document.getElementById("admSummary");
    const ym = document.getElementById("admMonth").value;
    const ass = (Admin.data || { assignments: [] }).assignments || [];

    // 유형별 시수
    const byKind = {};
    ass.forEach((a) => {
      byKind[a.kind] = (byKind[a.kind] || 0) + hoursOf(a);
    });
    let html = `<h3>유형별 시수 (${ym})</h3>`;
    const kindNames = Object.keys(byKind).sort();
    html += kindNames.length
      ? `<table><thead><tr><th>유형</th><th>시수</th></tr></thead><tbody>${
          kindNames.map((k) => `<tr><td><span class="slot kind-${Admin.kindClass(k)}">${k}</span></td><td>${fmtH(byKind[k])}h</td></tr>`).join("")
        }</tbody></table>`
      : '<div class="muted">배치된 활동이 없습니다.</div>';

    // 강사별 월 합계
    const totals = Hours.monthTotals(ass);
    html += "<h3>강사별 월 합계</h3>";
    const kindCols = kindNames.length ? kindNames : ["해설", "연구", "지원"];
    html += `<table><thead><tr><th>강사</th>${kindCols.map((k) => `<th>${k}</th>`).join("")}<th>합계</th></tr></thead><tbody>`;
    const extra = Object.keys(totals).filter((n) => !STATE.instructors.includes(n));
    [...STATE.instructors, ...sortKo(extra)].forEach((n) => {
      const t = totals[n] || { byKind: {}, total: 0 };
      html += `<tr><td>${nameLabel(n)}</td>` +
        kindCols.map((k) => `<td>${t.byKind[k] ? fmtH(t.byKind[k]) : "·"}</td>`).join("") +
        `<td><b>${fmtH(t.total)}h</b></td></tr>`;
    });
    html += "</tbody></table>";
    wrap.innerHTML = html;
  },

  /** kind 를 CSS 클래스로. 폐지된 이월 유형은 원래 유형 색을 따라간다. */
  kindClass(kind) {
    return String(kind || "").replace("이월", "");
  },

  openModal(a) {
    const m = document.getElementById("modal");
    const c = document.getElementById("modalContent");
    const title = document.getElementById("modalTitle");
    const isEdit = !!a.id;
    title.textContent = isEdit ? "배치 편집" : "배치 추가";
    const kinds = ["해설", "연구", "지원"];
    const forms = ["", "학교체험", "가족체험", "주말어드벤처"];
    const roles = ["", "주", "보조", "토오전", "토오후", "토종일", "일오전"];
    const opt = (arr, v) => arr.map((x) => `<option ${x === v ? "selected" : ""} value="${x}">${x || "-"}</option>`).join("");

    // 강사 영역: 신규는 다중 체크박스, 편집은 단일 select
    const allInstructors = (STATE.assignableNames && STATE.assignableNames.length)
      ? STATE.assignableNames
      : STATE.instructors;
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
        <label>시수 <input type="number" step="0.5" min="0" id="m_h" value="${a.hours || 0}"/></label>
        <label>내역 <output id="m_breakdown" class="breakdown"></output></label>
      </div>
      ${namesHtml}
      <p class="muted" style="margin-top:8px">형태를 고르면 표준 시수가 자동으로 채워집니다. 내역(해설·지원)은 활동결과를 수기로 옮겨 적을 때 쓰라고 함께 보여줍니다.</p>
      <label>메모 <input type="text" id="m_memo" value="${a.memo || ""}" style="width:100%"/></label>
      ${isEdit ? '<p><button type="button" id="m_del" style="color:#c53030">삭제</button></p>' : ""}
    `;
    // form/kind/role 변경 시 표준 시수 자동 적용
    const apply = () => Admin.applyDefaultHours();
    document.getElementById("m_kind").onchange = apply;
    document.getElementById("m_form").onchange = apply;
    document.getElementById("m_role").onchange = apply;
    document.getElementById("m_h").oninput = () => Admin.renderBreakdown();
    Admin.renderBreakdown();
    m.classList.remove("hidden");
    document.getElementById("modalCancel").onclick = () => m.classList.add("hidden");
    document.getElementById("modalSave").onclick = async () => {
      const common = {
        date: document.getElementById("m_date").value,
        kind: document.getElementById("m_kind").value,
        form: document.getElementById("m_form").value,
        role: document.getElementById("m_role").value,
        ...STANDARD_HOURS.split(
          document.getElementById("m_kind").value,
          document.getElementById("m_form").value,
          document.getElementById("m_role").value,
          document.getElementById("m_h").value,
        ),
        memo: document.getElementById("m_memo").value,
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
  /** 형태별 표준 시수 자동 채움. 입력은 합계 하나만 받는다. */
  applyDefaultHours() {
    const kind = document.getElementById("m_kind").value;
    const form = document.getElementById("m_form").value;
    const role = document.getElementById("m_role").value;
    const h = STANDARD_HOURS.total(kind, form, role);
    if (h !== null) document.getElementById("m_h").value = h;
    Admin.renderBreakdown();
  },

  /** 입력한 합계가 해설·지원으로 어떻게 나뉘는지 보여준다. */
  renderBreakdown() {
    const el = document.getElementById("m_breakdown");
    if (!el) return;
    const s = STANDARD_HOURS.split(
      document.getElementById("m_kind").value,
      document.getElementById("m_form").value,
      document.getElementById("m_role").value,
      document.getElementById("m_h").value,
    );
    const text = STANDARD_HOURS.label(s);
    el.textContent = text || "—";
    el.classList.toggle("breakdown-on", !!text);
  },
};
