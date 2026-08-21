window.Instructor = {
  selectedDate: null,
  data: null,
  async render() {
    document.getElementById("whoami").textContent = `강사 · ${STATE.user.name}`;
    const monthInput = document.getElementById("insMonth");
    if (!monthInput.value) monthInput.value = todayYm();
    monthInput.onchange = () => Instructor.loadMonth();
    document.getElementById("insSubmitBtn").onclick = Instructor.submit;
    document.getElementById("insReasonSave").onclick = Instructor.saveReasonForSelected;
    await Instructor.loadMonth();
  },
  async loadMonth() {
    const ym = document.getElementById("insMonth").value;
    const data = await API.getMonth(ym);
    STATE.cache.monthData[ym] = data;
    Instructor.data = data;
    Instructor.paint(ym, data);
  },

  /** 서버 왕복 없이 현재 데이터로 화면만 다시 그린다. */
  paint(ym, data) {
    Instructor.renderCalendar(ym, data);
    Instructor.renderUnavailList(data);
    Instructor.renderSubmitState(data);
    Instructor.renderSchedule(ym, data);
  },

  /**
   * 근무불가일 토글.
   * 먼저 화면을 바꾸고 나서 저장한다(낙관적 갱신). 실패하면 되돌린다.
   * 시트 시절에는 저장이 끝날 때까지 달력이 멈춰 있었다.
   */
  async toggleUnavail(ds) {
    const ym = document.getElementById("insMonth").value;
    const me = STATE.user.name;
    const data = Instructor.data;
    if (!data) return;
    const before = data.unavails.slice();
    const beforeSubmits = data.submits;
    const on = !before.some((u) => u.name === me && u.date === ds);
    const reason = document.getElementById("insReason").value || "";

    data.unavails = on
      ? before.concat([{ name: me, date: ds, reason }])
      : before.filter((u) => !(u.name === me && u.date === ds));
    // 불가일을 고치면 서버에서 제출 상태가 해제되므로 화면도 같이 맞춘다.
    data.submits = (data.submits || []).map((s) =>
      s.name === me ? Object.assign({}, s, { submitted: false, submittedAt: "" }) : s);
    Instructor.selectedDate = ds;
    Instructor.paint(ym, data);

    try {
      await API.saveUnavailable(ds, on, reason);
      await Instructor.loadMonth();
    } catch (e) {
      data.unavails = before;
      data.submits = beforeSubmits;
      Instructor.paint(ym, data);
      alert("저장 실패: " + e.message);
    }
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
        if (mineDates.has(ds)) {
          cell.classList.add("unavail");
          const r = (data.unavails.find((u) => u.name === me && u.date === ds) || {}).reason;
          if (r) {
            const t = document.createElement("div");
            t.className = "muted"; t.textContent = r;
            cell.appendChild(t);
          }
        }
        // 확정된 본인 배치 표시
        (data.assignments || []).filter((a) => a.name === me && a.date === ds).forEach((a) => {
          const s = document.createElement("div");
          s.className = `slot kind-${a.kind}`;
          s.textContent = Instructor.labelOf(a);
          cell.appendChild(s);
        });
      },
      onDayClick: (ds) => Instructor.toggleUnavail(ds),
    });
    wrap.appendChild(grid);
  },
  async saveReasonForSelected() {
    if (!Instructor.selectedDate) { alert("먼저 달력에서 날짜를 누르세요."); return; }
    const reason = document.getElementById("insReason").value || "";
    await API.saveUnavailable(Instructor.selectedDate, true, reason);
    await Instructor.loadMonth();
  },
  renderUnavailList(data) {
    const me = STATE.user.name;
    const ul = document.getElementById("insUnavailList");
    ul.innerHTML = "";
    (data.unavails || []).filter((u) => u.name === me).sort((a, b) => a.date.localeCompare(b.date)).forEach((u) => {
      const li = document.createElement("li");
      li.innerHTML = `<span>${u.date}${u.reason ? " — " + u.reason : ""}</span>`;
      const btn = document.createElement("button");
      btn.type = "button"; btn.textContent = "해제";
      btn.onclick = () => Instructor.toggleUnavail(u.date);
      li.appendChild(btn);
      ul.appendChild(li);
    });
  },
  renderSubmitState(data) {
    const ym = document.getElementById("insMonth").value;
    const me = STATE.user.name;
    const s = (data.submits || []).find((s) => s.ym === ym && s.name === me);
    const el = document.getElementById("insSubmitState");
    const done = !!(s && s.submitted);
    el.className = "chip " + (done ? "ok" : "warn");
    el.textContent = done ? `제출 완료 · ${(s.submittedAt || "").replace("T", " ").slice(0, 16)}` : "미제출";
  },
  async submit() {
    const ym = document.getElementById("insMonth").value;
    await API.submitUnavailable(ym, true);
    await Instructor.loadMonth();
  },
  renderSchedule(ym, data) {
    const wrap = document.getElementById("insSchedule");
    wrap.innerHTML = "";
    if (!data.published) { wrap.innerHTML = '<div class="muted">아직 확정 공개 전입니다. 관리자가 공개하면 여기에 표시됩니다.</div>'; return; }
    const tbl = document.createElement("table");
    tbl.innerHTML = "<thead><tr><th>날짜</th><th>유형</th><th>형태</th><th>역할</th><th>강사</th><th>시수</th></tr></thead>";
    const tb = document.createElement("tbody");
    (data.assignments || []).slice().sort((a, b) => a.date.localeCompare(b.date)).forEach((a) => {
      const tr = document.createElement("tr");
      const h = Number(a.hExplain || 0) + Number(a.hSupport || 0) + Number(a.hResearch || 0);
      tr.innerHTML = `<td>${a.date}</td><td><span class="slot kind-${a.kind}">${a.kind}</span></td>` +
        `<td>${a.form || "-"}</td><td>${a.role || "-"}</td><td>${a.name}</td><td>${h}</td>`;
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
};
