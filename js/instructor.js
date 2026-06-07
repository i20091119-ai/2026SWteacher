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
    const cached = STATE.restoreMonthCache(ym);
    if (cached) Instructor._renderAll(ym, cached);
    try {
      const data = await API.getMonth(ym);
      console.log("[loadMonth]", ym, cached ? "(cache→refresh)" : "(fresh)",
        "programs=", (data.programs || []).length,
        "assignments=", (data.assignments || []).length,
      );
      STATE.saveMonthCache(ym, data);
      Instructor._renderAll(ym, data);
      // 인접 달 prefetch (백그라운드)
      Instructor._prefetchNeighbors(ym);
    } catch (e) {
      if (!cached) throw e;
      console.warn("[loadMonth] refresh 실패, 캐시 유지", e);
    }
  },
  async _prefetchNeighbors(ym) {
    const targets = [prevYm(ym), nextYm(ym)];
    for (const t of targets) {
      if (STATE.cache.monthData[t]) continue;
      try {
        const d = await API.getMonth(t);
        STATE.saveMonthCache(t, d);
      } catch (e) { /* prefetch 실패는 조용히 무시 */ }
    }
  },
  _renderAll(ym, data) {
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
    const programs = data.programs || [];
    const wrap = document.getElementById("insCalendar");
    wrap.innerHTML = "";
    const grid = Cal.buildGrid(ym, {
      holidays,
      renderDay: (ds, cell) => {
        if (mineDates.has(ds)) cell.classList.add("unavail");
        // 학생 프로그램 (강사·관리자 공통)
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
          cell.appendChild(div);
        });
        // 확정된 본인 배치 표시
        (data.assignments || []).filter((a) => a.name === me && a.date === ds).forEach((a) => {
          const s = document.createElement("div");
          s.className = `slot kind-${a.kind}`;
          s.textContent = Instructor.labelOf(a);
          cell.appendChild(s);
        });
      },
      onDayClick: async (ds, cell) => {
        if (data.published) {
          alert("확정 활동표가 공개되어 활동불가일을 변경할 수 없습니다.\n변경이 필요하면 수업 교체 기능을 사용하세요.");
          return;
        }
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
      btn.disabled = !!data.published;
      if (data.published) btn.title = "확정 활동표 공개 후엔 해제할 수 없습니다";
      btn.onclick = async () => {
        if (data.published) return;
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
    const submitted = !!(s && s.submitted);
    const published = !!data.published;
    const el = document.getElementById("insSubmitState");
    const btn = document.getElementById("insSubmitBtn");

    if (submitted) {
      const t = String(s.submittedAt || "");
      const short = t.length >= 16 ? `${t.slice(5, 10)} ${t.slice(11, 16)}` : t;
      el.textContent = short ? `완료 · ${short}` : "완료";
      el.classList.remove("status-warn");
      el.classList.add("status-ok");
      if (published) {
        // 확정 공개 후 → 취소 불가
        btn.textContent = "제출 완료";
        btn.classList.remove("btn-primary");
        btn.disabled = true;
        btn.title = "확정 활동표가 공개되어 제출을 취소할 수 없습니다";
      } else {
        // 취소 가능
        btn.textContent = "제출 취소";
        btn.classList.remove("btn-primary");
        btn.disabled = false;
        btn.title = "";
      }
    } else {
      btn.textContent = "제출하기";
      btn.classList.add("btn-primary");
      btn.disabled = false;
      btn.title = "";
      el.textContent = "미제출";
      el.classList.remove("status-ok");
      el.classList.add("status-warn");
    }
  },
  async submit() {
    const ym = document.getElementById("insMonth").value;
    const btn = document.getElementById("insSubmitBtn");
    if (btn.disabled) return;
    const data = STATE.cache.monthData[ym];
    const me = STATE.user.name;
    const s = (data && data.submits || []).find((s) => s.ym === ym && s.name === me);
    const currentlySubmitted = !!(s && s.submitted);
    const next = !currentlySubmitted;
    const prevText = btn.textContent;
    btn.disabled = true;
    btn.textContent = next ? "제출 중..." : "취소 중...";
    try {
      await API.submitUnavailable(ym, next);
      await Instructor.loadMonth();
    } catch (e) {
      btn.disabled = false;
      btn.textContent = prevText;
      alert((next ? "제출" : "제출 취소") + " 실패: " + e.message);
    }
  },
  renderSchedule(ym, data) {
    const wrap = document.getElementById("insSchedule");
    wrap.innerHTML = "";
    if (!data.published) {
      wrap.innerHTML = '<div class="muted">아직 확정 공개 전입니다.</div>';
      return;
    }
    const me = STATE.user.name;
    const holidays = new Set((data.holidays || []));
    const programs = data.programs || [];
    const grid = Cal.buildGrid(ym, {
      holidays,
      renderDay: (ds, cell) => {
        // 학생 프로그램
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
          cell.appendChild(div);
        });
        // 모든 강사 배치 (본인은 파랑 outline 강조)
        (data.assignments || []).filter((a) => a.date === ds).forEach((a) => {
          const s = document.createElement("div");
          let cls = `slot kind-${a.kind}`;
          if (a.name === me) cls += " mine";
          if (isTrue(a.carry)) cls += " carry-flag";
          s.className = cls;
          const h = Number(a.hExplain || 0) + Number(a.hSupport || 0) + Number(a.hResearch || 0);
          const prefix = isTrue(a.carry) ? "↻ " : "";
          s.innerHTML = `${prefix}${Instructor.labelOf(a)} · ${nameLabel(a.name)} (${h}h)`;
          if (isTrue(a.carry)) s.title = "다음 달로 이월 표시된 활동";
          cell.appendChild(s);
        });
      },
    });
    wrap.appendChild(grid);
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
      newWrap.innerHTML = '<div class="muted">확정 활동표 발표 후 신청 가능합니다.</div>';
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
        span.innerHTML = `${labelA(a)} → <b>${nameLabel(s.target)}</b> <span class="muted">· ${statusLabel}</span>`;
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
          others.map((n) => `<option${n === "이상우" ? ' style="color:#d97706;font-weight:700"' : ""}>${n}</option>`).join("");
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

  renderMyCarryover(ym, data) {
    const wrap = document.getElementById("insMyCarryover");
    if (!wrap) return;
    const me = STATE.user.name;
    const prev = prevYm(ym);
    try {
      // 전월 데이터는 동일 getMonth 응답의 prevAssignments에서 (별도 호출 안 함)
      const co = Carryover.computeFromMonth(prev, data.prevAssignments || []);
      const myRec = co[me];
      const cap = Ledger.capForYm(prev);
      const placed = Carryover.placedInMonth(data.assignments || []);
      const myPlaced = placed[me] || { research: 0, support: 0 };
      const hasPlaced = myPlaced.research > 0 || myPlaced.support > 0;

      if (!myRec && !hasPlaced) {
        wrap.innerHTML = `<div class="muted">${prev}에 서류상 빠진 활동이 없고, ${ym}에 편성된 보전 항목도 없습니다. (주간 상한 ${cap}h)</div>`;
        return;
      }

      let html = "";

      if (myRec) {
        const cutHtml = myRec.cutItems
          .sort((a, b) => String(a.date).localeCompare(String(b.date)))
          .map((it) => {
            const tags = [];
            if (it.cutHResearch > 0) tags.push(`<span class="co-tag research">연구 ${it.cutHResearch}h</span>`);
            if (it.cutHSupport > 0) tags.push(`<span class="co-tag support">지원 ${it.cutHSupport}h</span>`);
            return `<li><span class="co-date">${it.date}</span> ${tags.join(" ")}</li>`;
          }).join("");

        html += `
          <div class="co-section">
            <div class="co-section-title">⚠ ${prev}에서 서류상 빠진 실제 활동 <span class="muted">(주간 상한 ${cap}h 초과분)</span></div>
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
        `;

        const status = Carryover.matchStatus({ [me]: myRec }, placed)[me];
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

        html += `
          <div class="co-section">
            <div class="co-section-title">📅 ${ym} 편성 현황</div>
            <div class="co-status-line ${statusKlass}">
              <span>연구이월 ${status.placedResearch}h · 지원이월 ${status.placedSupport}h</span>
              <b>${statusText}</b>
            </div>
            ${remainingLine}
          </div>
        `;
      } else if (hasPlaced) {
        // 전월 잘림 데이터 없음 — 이번 달 보전 편성 항목 리스트만 표시
        const items = (data.assignments || [])
          .filter((a) => a.name === me && (a.kind === "연구이월" || a.kind === "지원이월"))
          .sort((a, b) => String(a.date).localeCompare(String(b.date)));
        const itemsHtml = items.map((a) => {
          const h = Number(a.hExplain || 0) + Number(a.hSupport || 0) + Number(a.hResearch || 0);
          const tag = a.kind === "연구이월"
            ? `<span class="co-tag research">연구 ${h}h</span>`
            : `<span class="co-tag support">지원 ${h}h</span>`;
          const memo = a.memo ? `<span class="muted"> · ${a.memo}</span>` : "";
          return `<li><span class="co-date">${a.date}</span> ${tag}${memo}</li>`;
        }).join("");
        html += `
          <div class="co-section">
            <div class="co-section-title">📅 ${ym} 편성된 보전 항목 <span class="muted">(${prev} 잘림 데이터는 시스템에 없음)</span></div>
            <ul class="co-cut-list">${itemsHtml}</ul>
            <div class="muted" style="margin-top:6px">합계: 연구 ${myPlaced.research}h · 지원 ${myPlaced.support}h</div>
          </div>
        `;
      }

      wrap.innerHTML = html;
    } catch (e) {
      wrap.innerHTML = `<div class="muted">전월(${prev}) 이월 계산 실패: ${e.message}</div>`;
    }
  },
};
