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
    Instructor.renderMyWeekly(ym, data);
    Instructor.renderSchedule(ym, data);
    Instructor.renderSwaps(ym, data);
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
          let cls = `slot kind-${String(a.kind || "").replace("이월", "")}`;
          if (a.name === me) cls += " mine";
          s.className = cls;
          const h = hoursOf(a);
          const label = a.kind + (a.form ? "·" + a.form : "") + (a.role ? "·" + a.role : "");
          s.innerHTML = `${label} · ${nameLabel(a.name)} (${fmtH(h)}h)`;
          // 해설·지원이 나뉘는 활동은 내역을 함께 적는다 (수기 활동결과 작성용)
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

  renderMyWeekly(ym, data) {
    const wrap = document.getElementById("insMyWeekly");
    if (!wrap) return;
    const me = STATE.user.name;
    const myAssignments = (data.assignments || []).filter((a) => a.name === me);
    const cap = Hours.capForYm(ym);
    if (!myAssignments.length) {
      wrap.innerHTML = `<div class="muted">${ym}에 배치된 내 활동이 없습니다. (주간 상한 ${cap}h)</div>`;
      return;
    }
    // 본인 데이터만으로 actualView 계산
    const viewMap = Hours.weeklyView(ym, myAssignments);
    const view = viewMap[me] || [];
    const fmt = fmtH;
    let html = `<p class="muted" style="margin-bottom:8px">주간 상한: <b>${cap}h</b></p>`;
    const kinds = [...new Set(myAssignments.map((a) => a.kind))].sort();
    html += `<table><thead><tr><th>주 시작(일)</th>${kinds.map((k) => `<th>${k}</th>`).join("")}<th>합계</th><th>초과</th></tr></thead><tbody>`;
    const monthByKind = {};
    let monthTotal = 0;
    view.forEach((w) => {
      monthTotal += w.total;
      kinds.forEach((k) => { monthByKind[k] = (monthByKind[k] || 0) + (w.byKind[k] || 0); });
      html += `<tr class="${w.over > 0 ? "warn" : ""}"><td>${w.wkStart}</td>` +
        kinds.map((k) => `<td>${w.byKind[k] ? fmt(w.byKind[k]) : "·"}</td>`).join("") +
        `<td><b>${fmt(w.total)}</b></td><td>${w.over > 0 ? `<b>${fmt(w.over)}h</b>` : "—"}</td></tr>`;
    });
    html += `</tbody></table>`;
    html += `<p style="margin-top:10px;font-size:14px"><b>${ym} 월 합계</b> · ` +
      kinds.map((k) => `${k} ${fmt(monthByKind[k])}h`).join(" · ") +
      ` · <b>총 ${fmt(monthTotal)}h</b></p>`;
    wrap.innerHTML = html;
  }
};
