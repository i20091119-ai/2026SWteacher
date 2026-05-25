// 월별 캘린더 렌더 (강사·관리자 공용 기본 격자)
window.Cal = {
  buildGrid(ym, opts) {
    // opts: { onDayClick(date), renderDay(date, cell), highlightUnavailFor (name), holidays(set) }
    const [y, m] = ym.split("-").map(Number);
    const first = new Date(y, m - 1, 1);
    const last = new Date(y, m, 0);
    const grid = document.createElement("div");
    grid.className = "calendar";
    const heads = ["일", "월", "화", "수", "목", "금", "토"];
    heads.forEach((h, i) => {
      const c = document.createElement("div");
      c.className = "cal-head";
      c.textContent = h;
      if (i === 0) c.style.color = "#c53030";
      if (i === 6) c.style.color = "#2b6cb0";
      grid.appendChild(c);
    });
    for (let i = 0; i < first.getDay(); i++) {
      const c = document.createElement("div");
      c.className = "cal-cell empty";
      grid.appendChild(c);
    }
    for (let d = 1; d <= last.getDate(); d++) {
      const date = new Date(y, m - 1, d);
      const ds = dateStr(date);
      const cell = document.createElement("div");
      cell.className = "cal-cell";
      cell.dataset.date = ds;
      if (opts && opts.holidays && opts.holidays.has(ds)) cell.classList.add("holiday");
      const head = document.createElement("div");
      head.className = "date " + (date.getDay() === 0 ? "sun" : date.getDay() === 6 ? "sat" : "");
      head.textContent = `${d}`;
      cell.appendChild(head);
      if (opts && opts.renderDay) opts.renderDay(ds, cell);
      if (opts && opts.onDayClick) cell.addEventListener("click", (e) => {
        if (e.target.dataset.stop) return;
        opts.onDayClick(ds, cell);
      });
      grid.appendChild(cell);
    }
    return grid;
  },
};
