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
    await API.submitUnavailable(ym, true);
    await Instructor.loadMonth();
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
    const inbox = document.getElementById("insSwapInbox");
    const sent = document.getElementById("insSwapSent");
    const newWrap = document.getElementById("insSwapNew");
    inbox.innerHTML = ""; sent.innerHTML = ""; newWrap.innerHTML = "";
    if (!data.published) {
      newWrap.innerHTML = '<div class="muted">확정 근무표 발표 후 신청 가능합니다.</div>';
      return;
    }
    const swaps = data.swaps || [];
    const assignments = data.assignments || [];
    const findAssignment = (id) => assignments.find((a) => a.id === id);
    const labelA = (a) => a ? `${a.date} ${Instructor.labelOf(a)}` : "(배치 없음)";

    // 받은 요청 (내가 target)
    const myInbox = swaps.filter((s) => s.target === me && s.status === "pending_accept");
    if (myInbox.length) {
      inbox.innerHTML = "<h3 style='font-size:15px'>받은 요청</h3>";
      myInbox.forEach((s) => {
        const a = findAssignment(s.assignmentId);
        const div = document.createElement("div");
        div.className = "swap-row";
        div.innerHTML = `<span><b>${s.requester}</b> → 나: ${labelA(a)}</span>`;
        const ok = document.createElement("button");
        ok.type = "button"; ok.textContent = "수락";
        ok.onclick = async () => { await Instructor.swapAction(API.acceptSwap, s.id); };
        const no = document.createElement("button");
        no.type = "button"; no.textContent = "거절";
        no.onclick = async () => { await Instructor.swapAction(API.declineSwap, s.id); };
        div.appendChild(ok); div.appendChild(no);
        inbox.appendChild(div);
      });
    }

    // 보낸 요청 (내가 requester)
    const mySent = swaps.filter((s) => s.requester === me &&
      (s.status === "pending_accept" || s.status === "pending_confirm"));
    if (mySent.length) {
      sent.innerHTML = "<h3 style='font-size:15px;margin-top:12px'>보낸 요청</h3>";
      mySent.forEach((s) => {
        const a = findAssignment(s.assignmentId);
        const div = document.createElement("div");
        div.className = "swap-row";
        const statusLabel = s.status === "pending_accept" ? "대상 수락 대기" : "최종 확정 대기";
        div.innerHTML = `<span>${labelA(a)} → <b>${s.target}</b> (${statusLabel})</span>`;
        if (s.status === "pending_confirm") {
          const confirm = document.createElement("button");
          confirm.type = "button"; confirm.textContent = "최종 확정";
          confirm.className = "primary";
          confirm.onclick = async () => { await Instructor.swapAction(API.confirmSwap, s.id); };
          div.appendChild(confirm);
        }
        const cancel = document.createElement("button");
        cancel.type = "button"; cancel.textContent = "취소";
        cancel.onclick = async () => { await Instructor.swapAction(API.cancelSwap, s.id); };
        div.appendChild(cancel);
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
};
