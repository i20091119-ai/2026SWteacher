window.Instructor = {
  async render() {
    document.getElementById("whoami").textContent = `강사 · ${STATE.user.name}`;
    const monthInput = document.getElementById("insMonth");
    if (!monthInput.value) monthInput.value = todayYm();
    monthInput.onchange = () => Instructor.loadMonth();
    document.getElementById("insSubmitBtn").onclick = Instructor.submit;
    await Instructor.loadMonth();
  },
  async loadMonth() {
    const ym = document.getElementById("insMonth").value;
    const data = await API.getMonth(ym);
    const me = STATE.user.name;
    const myUnavails = (data.unavails || []).filter((u) => u.name === me);
    console.log("[loadMonth]", ym, "me=", JSON.stringify(me),
      "전체 unavails 수=", (data.unavails || []).length,
      "내 unavails 수=", myUnavails.length,
      "unavails 샘플:", (data.unavails || []).slice(0, 3),
    );
    STATE.cache.monthData[ym] = data;
    Instructor.renderCalendar(ym, data);
    Instructor.renderUnavailList(data);
    Instructor.renderSubmitState(data);
    Instructor.renderSchedule(ym, data);
    Instructor.renderSwaps(ym, data);
    Instructor.renderMyCarryover(ym, data);
  },
  renderCalendar(ym, data) {
    const me = STATE.user.name;
    const mineDates = new Set(
      (data.unavails || []).filter((u) => u.name === me).map((u) => u.date)
    );
    const holidays = new Set((data.holidays || []));
    const wrap = document.getElementById("insCalendar");
    wrap.innerHTML = "";
    const grid = Cal.buildGrid(ym, {
      holidays,
      renderDay: (ds, cell) => {
        if (mineDates.has(ds)) cell.classList.add("unavail");
        // 확정된 본인 배치 표시
        (data.assignments || []).filter((a) => a.name === me && a.date === ds).forEach((a) => {
          const s = document.createElement("div");
          s.className = `slot kind-${a.kind}`;
          s.textContent = Instructor.labelOf(a);
          cell.appendChild(s);
        });
      },
      onDayClick: async (ds, cell) => {
        const on = !mineDates.has(ds);
        // 즉각적인 시각 피드백 + 로컬 상태 갱신 (loadMonth 호출 안 함)
        if (on) {
          cell.classList.add("unavail");
          mineDates.add(ds);
          data.unavails = data.unavails || [];
          if (!data.unavails.some((u) => u.name === me && u.date === ds)) {
            data.unavails.push({ name: me, date: ds, reason: "" });
          }
        } else {
          cell.classList.remove("unavail");
          mineDates.delete(ds);
          data.unavails = (data.unavails || []).filter((u) => !(u.name === me && u.date === ds));
        }
        Instructor.renderUnavailList(data);
        console.log("[insClick]", ds, "→", on ? "등록" : "해제");
        try {
          const res = await API.saveUnavailable(ds, on);
          console.log("[insClick] 응답", res);
        } catch (e) {
          // 실패 시 시각/상태 되돌리기
          if (on) {
            cell.classList.remove("unavail");
            mineDates.delete(ds);
            data.unavails = data.unavails.filter((u) => !(u.name === me && u.date === ds));
          } else {
            cell.classList.add("unavail");
            mineDates.add(ds);
            data.unavails.push({ name: me, date: ds, reason: "" });
          }
          Instructor.renderUnavailList(data);
          console.error("[insClick] 실패", e);
          alert("저장 실패: " + e.message);
        }
      },
    });
    wrap.appendChild(grid);
  },
  renderUnavailList(data) {
    const me = STATE.user.name;
    const ul = document.getElementById("insUnavailList");
    ul.innerHTML = "";
    (data.unavails || []).filter((u) => u.name === me).sort((a, b) => a.date.localeCompare(b.date)).forEach((u) => {
      const li = document.createElement("li");
      li.innerHTML = `<span>${u.date}</span>`;
      const btn = document.createElement("button");
      btn.type = "button"; btn.textContent = "해제";
      btn.onclick = async () => {
        // 로컬 상태에서 즉시 제거 + 캘린더에서 색 제거
        data.unavails = (data.unavails || []).filter((x) => !(x.name === me && x.date === u.date));
        Instructor.renderUnavailList(data);
        const cell = document.querySelector(`#insCalendar .cal-cell[data-date="${u.date}"]`);
        if (cell) cell.classList.remove("unavail");
        try {
          await API.saveUnavailable(u.date, false);
        } catch (e) {
          alert("해제 실패: " + e.message);
        }
      };
      li.appendChild(btn);
      ul.appendChild(li);
    });
  },
  renderSubmitState(data) {
    const ym = document.getElementById("insMonth").value;
    const me = STATE.user.name;
    const s = (data.submits || []).find((s) => s.ym === ym && s.name === me);
    const el = document.getElementById("insSubmitState");
    if (s && s.submitted) {
      el.textContent = `제출 완료 · ${s.submittedAt}`;
      el.style.color = "var(--ok)";
    } else {
      el.textContent = "미제출";
      el.style.color = "var(--warn)";
    }
  },
  async submit() {
    const ym = document.getElementById("insMonth").value;
    const btn = document.getElementById("insSubmitBtn");
    const prevText = btn.textContent;
    btn.disabled = true;
    btn.textContent = "제출 중...";
    try {
      await API.submitUnavailable(ym, true);
      await Instructor.loadMonth();
    } catch (e) {
      alert("제출 실패: " + e.message);
    } finally {
      btn.disabled = false;
      btn.textContent = prevText;
    }
  },
  renderSchedule(ym, data) {
    const wrap = document.getElementById("insSchedule");
    wrap.innerHTML = "";
    if (!data.published) { wrap.innerHTML = '<div class="muted">아직 확정 공개 전입니다.</div>'; return; }
    const tbl = document.createElement("table");
    tbl.innerHTML = "<thead><tr><th>날짜</th><th>유형</th><th>형태</th><th>역할</th><th>강사</th><th>시수</th></tr></thead>";
    const tb = document.createElement("tbody");
    (data.assignments || []).slice().sort((a, b) => a.date.localeCompare(b.date)).forEach((a) => {
      const tr = document.createElement("tr");
      const h = Number(a.hExplain || 0) + Number(a.hSupport || 0) + Number(a.hResearch || 0);
      tr.innerHTML = `<td>${a.date}</td><td>${a.kind}</td><td>${a.form || "-"}</td><td>${a.role || "-"}</td><td>${a.name}</td><td>${h}</td>`;
      tb.appendChild(tr);
    });
    tbl.appendChild(tb);
    wrap.appendChild(tbl);
  },
  labelOf(a) {
    if (a.form && a.role) return `${a.kind}·${a.form}·${a.role}`;
    if (a.form) return `${a.kind}·${a.form}`;
    return a.kind;
  },

  renderSwaps(ym, data) {
    const me = STATE.user.name;
    const sent = document.getElementById("insSwapSent");
    const newWrap = document.getElementById("insSwapNew");
    const inbox = document.getElementById("insSwapInbox");
    if (inbox) inbox.innerHTML = "";
    sent.innerHTML = ""; newWrap.innerHTML = "";
    if (!data.published) {
      newWrap.innerHTML = '<div class="muted">확정 근무표 발표 후 신청 가능합니다.</div>';
      return;
    }
    const swaps = data.swaps || [];
    const assignments = data.assignments || [];
    const findAssignment = (id) => assignments.find((a) => a.id === id);
    const labelA = (a) => a ? `${a.date} ${Instructor.labelOf(a)}` : "(배치 없음)";

    // 내가 보낸 요청
    const mySent = swaps
      .filter((s) => s.requester === me)
      .sort((a, b) => String(b.requestedAt).localeCompare(String(a.requestedAt)));
    if (mySent.length) {
      sent.innerHTML = "<h3 class='subsection'>내가 보낸 요청</h3>";
      mySent.forEach((s) => {
        const a = findAssignment(s.assignmentId);
        const div = document.createElement("div");
        div.className = "swap-row swap-status-" + s.status;
        const statusLabel = ({
          pending_admin: "⏳ 관리자 승인 대기",
          completed: "✓ 승인 완료",
          rejected: "✗ 관리자 거절",
          cancelled: "취소됨",
        })[s.status] || s.status;
        const span = document.createElement("span");
        span.innerHTML = `${labelA(a)} → <b>${s.target}</b> <span class="muted">· ${statusLabel}</span>`;
        div.appendChild(span);
        if (s.status === "pending_admin") {
          const cancel = document.createElement("button");
          cancel.type = "button"; cancel.textContent = "취소";
          cancel.onclick = async () => { await Instructor.swapAction(API.cancelSwap, s.id); };
          div.appendChild(cancel);
        }
        sent.appendChild(div);
      });
    }

    // 신청할 수 있는 내 수업
    const myAssignments = assignments.filter((a) => a.name === me);
    if (!myAssignments.length) {
      newWrap.innerHTML = '<div class="muted">이 달에 본인 배치가 없습니다.</div>';
      return;
    }
    const activeBy = new Set(swaps
      .filter((s) => s.status === "pending_accept" || s.status === "pending_confirm")
      .map((s) => s.assignmentId));
    const others = STATE.instructors.filter((n) => n !== me);
    myAssignments.sort((a, b) => a.date.localeCompare(b.date)).forEach((a) => {
      const div = document.createElement("div");
      div.className = "swap-row";
      const left = document.createElement("span");
      left.innerHTML = `${a.date} <b>${Instructor.labelOf(a)}</b>`;
      div.appendChild(left);
      if (activeBy.has(a.id)) {
        const tag = document.createElement("span");
        tag.className = "muted"; tag.textContent = " (진행 중)";
        div.appendChild(tag);
      } else {
        const sel = document.createElement("select");
        sel.innerHTML = '<option value="">대상 강사 선택</option>' +
          others.map((n) => `<option>${n}</option>`).join("");
        const btn = document.createElement("button");
        btn.type = "button"; btn.textContent = "교체 신청";
        btn.onclick = async () => {
          const target = sel.value;
          if (!target) { alert("대상 강사를 선택하세요"); return; }
          try {
            await API.createSwap(a.id, target);
            await Instructor.loadMonth();
          } catch (e) { alert("신청 실패: " + e.message); }
        };
        div.appendChild(sel); div.appendChild(btn);
      }
      newWrap.appendChild(div);
    });
  },

  async swapAction(fn, swapId) {
    try {
      await fn(swapId);
      await Instructor.loadMonth();
    } catch (e) { alert("실패: " + e.message); }
  },

  async renderMyCarryover(ym, data) {
    const wrap = document.getElementById("insMyCarryover");
    if (!wrap) return;
    const me = STATE.user.name;
    const prev = prevYm(ym);
    wrap.innerHTML = '<div class="muted">불러오는 중...</div>';
    try {
      const prevData = await API.getMonth(prev);
      const co = Carryover.computeFromMonth(prev, prevData.assignments || []);
      const myRec = co[me];
      const cap = Ledger.capForYm(prev);
      if (!myRec) {
        wrap.innerHTML = `<div class="muted">${prev}에 서류상 빠진 근무가 없습니다. (주간 상한 ${cap}h)</div>`;
        return;
      }
      const placed = Carryover.placedInMonth(data.assignments || []);
      const status = Carryover.matchStatus({ [me]: myRec }, placed)[me];

      const cutHtml = myRec.cutItems
        .sort((a, b) => String(a.date).localeCompare(String(b.date)))
        .map((it) => {
          const tags = [];
          if (it.cutHResearch > 0) tags.push(`<span class="co-tag research">연구 ${it.cutHResearch}h</span>`);
          if (it.cutHSupport > 0) tags.push(`<span class="co-tag support">지원 ${it.cutHSupport}h</span>`);
          return `<li><span class="co-date">${it.date}</span> ${tags.join(" ")}</li>`;
        }).join("");

      const statusKlass = "co-status-" + status.status;
      const statusText = status.status === "complete" ? "✓ 보전 완료"
        : status.status === "partial" ? "⚠ 일부 반영"
        : "✗ 미반영";

      const remParts = [];
      if (status.remResearch > 0) remParts.push(`연구 ${status.remResearch}h`);
      if (status.remSupport > 0) remParts.push(`지원 ${status.remSupport}h`);
      const remainingLine = remParts.length
        ? `<div class="muted" style="margin-top:4px">남은 보전: ${remParts.join(" · ")}</div>`
        : "";

      wrap.innerHTML = `
        <div class="co-section">
          <div class="co-section-title">⚠ ${prev}에서 서류상 빠진 실제 근무 <span class="muted">(주간 상한 ${cap}h 초과분)</span></div>
          <ul class="co-cut-list">${cutHtml}</ul>
        </div>
        <div class="co-section">
          <div class="co-section-title">📌 ${ym} 보전 권장 시수</div>
          <div class="co-recommend">
            ${myRec.recommendedResearchH > 0 ? `<span class="co-tag research">연구 ${myRec.recommendedResearchH}h</span>` : ""}
            ${myRec.recommendedSupportH > 0 ? `<span class="co-tag support">지원 ${myRec.recommendedSupportH}h</span>` : ""}
            <span class="muted">합계 ${myRec.recommendedH}h</span>
          </div>
        </div>
        <div class="co-section">
          <div class="co-section-title">📅 ${ym} 편성 현황</div>
          <div class="co-status-line ${statusKlass}">
            <span>연구이월 ${status.placedResearch}h · 지원이월 ${status.placedSupport}h</span>
            <b>${statusText}</b>
          </div>
          ${remainingLine}
        </div>
      `;
    } catch (e) {
      wrap.innerHTML = `<div class="muted">전월(${prev}) 데이터 로드 실패: ${e.message}</div>`;
    }
  },
};
