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
    STATE.cache.monthData[ym] = data;
    Instructor.renderCalendar(ym, data);
    Instructor.renderUnavailList(data);
    Instructor.renderSubmitState(data);
    Instructor.renderSchedule(ym, data);
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
        // 토글
        const on = !mineDates.has(ds);
        try {
          await API.saveUnavailable(ds, on);
          await Instructor.loadMonth();
        } catch (e) {
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
        await API.saveUnavailable(u.date, false);
        await Instructor.loadMonth();
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
};
