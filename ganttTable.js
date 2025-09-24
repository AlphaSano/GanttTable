/* ganttTable.js
   Rendu d'un Gantt en <table> (1 jour/colonne, 1 tâche/ligne), un tableau par mois, A4 portrait.
   Usage minimal :
     renderGanttAsTables([
       { label: "Etude",       start: "2025-09-03", end: "2025-09-10", color: "#7aa7ff" },
       { label: "Achat",       start: "2025-09-08", end: "2025-09-18" }, // couleur par défaut
       { label: "Fabrication", start: "2025-09-15", end: "2025-10-07", color: "#4caf50" },
     ], { container: "#app" });
*/

(function (global) {
  function parseISO(dateStr) {
    // Interprétation locale 00:00 pour éviter les décalages TZ
    return new Date(dateStr + "T00:00:00");
  }

  function startOfMonth(d) {
    return new Date(d.getFullYear(), d.getMonth(), 1);
  }

  function endOfMonth(d) {
    return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
  }

  function daysInMonth(year, monthIdx /* 0-11 */) {
    return new Date(year, monthIdx + 1, 0).getDate();
  }

  function addMonths(d, n) {
    return new Date(d.getFullYear(), d.getMonth() + n, 1);
  }

  function sameMonth(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
  }

  function formatMonthFR(d) {
    return new Intl.DateTimeFormat("fr", { month: "long", year: "numeric" }).format(d);
  }

  function formatDDMM(d) {
    return d.toLocaleDateString("fr-BE", { day: "2-digit", month: "2-digit" });
  }

  function isWeekend(d) {
    const dow = d.getDay(); // 0=Dim, 6=Sam
    return dow === 0 || dow === 6;
  }

  function clampIntervalToMonth(taskStart, taskEnd, monthStart, monthEnd) {
    const s = taskStart > monthStart ? taskStart : monthStart;
    const e = taskEnd   < monthEnd   ? taskEnd   : monthEnd;
    return s <= e ? [s, e] : null;
  }

  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") node.className = v;
      else if (k === "dataset" && v && typeof v === "object") {
        Object.entries(v).forEach(([dk, dv]) => (node.dataset[dk] = dv));
      } else if (k === "style" && v && typeof v === "object") {
        Object.assign(node.style, v);
      } else {
        node.setAttribute(k, v);
      }
    }
    for (const c of children.flat()) {
      if (c == null) continue;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    }
    return node;
  }

  function injectDefaultStyles() {
    if (document.getElementById("gantt-table-styles")) return; // une seule fois
    const style = document.createElement("style");
    style.id = "gantt-table-styles";
    style.textContent = `
@page { size: A4 portrait; margin: 10mm; }
@media print { .gt-month { page-break-after: always; } .gt-month:last-child { page-break-after: auto; } }

.gt-wrap { font-family: system-ui, -apple-system, Segoe UI, Roboto, "Helvetica Neue", Arial, sans-serif; padding: 16px; }
.gt-month { margin-bottom: 18px; }
.gt-month h2 { margin: 8px 0 6px; font-size: 16px; text-transform: capitalize; }

.gt-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
.gt-table thead th { position: sticky; top: 0; background: #f2f2f2; }
.gt-table th, .gt-table td { border: 1px solid #d0d0d0; padding: 2px 4px; font-size: 11px; text-align: center; }
.gt-task, .gt-task-cell { text-align: left; width: 22ch; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.gt-days th, .gt-days td { width: calc((100% - 22ch) / var(--days)); }
.gt-we { background: #fafafa; }

.gt-bar { display: block; height: 10px; border-radius: 3px; background: #7aa7ff; }
`;
    document.head.appendChild(style);
  }

  /**
   * Render Gantt as monthly tables.
   * @param {Array<{label:string, start:string(YYYY-MM-DD), end:string(YYYY-MM-DD), color?:string}>} tasks
   * @param {Object} options
   * @param {string|Element} [options.container=document.body] CSS selector ou élément conteneur
   * @param {boolean} [options.injectStyles=true] Injecter le CSS par défaut
   * @param {boolean} [options.shadeWeekends=true] Griser les week-ends
   * @param {string}  [options.defaultColor="#7aa7ff"] Couleur par défaut des barres
   * @returns {Element} l’élément racine créé
   */
  function renderGanttAsTables(tasks, options = {}) {
    const {
      container = document.body,
      injectStyles: doInjectStyles = true,
      shadeWeekends = true,
      defaultColor = "#7aa7ff",
    } = options;

    const mount =
      typeof container === "string" ? document.querySelector(container) : container;
    if (!mount) throw new Error("Container introuvable.");

    if (!Array.isArray(tasks) || tasks.length === 0) {
      throw new Error("Aucune tâche fournie.");
    }

    // Normaliser tâches (dates -> Date)
    const norm = tasks.map((t, i) => {
      if (!t || !t.label || !t.start || !t.end) {
        throw new Error(`Tâche invalide à l’index ${i}. Requis: {label,start,end}.`);
      }
      const s = parseISO(t.start);
      const e = parseISO(t.end);
      if (isNaN(s) || isNaN(e) || s > e) {
        throw new Error(
          `Dates invalides pour "${t.label}". Format attendu YYYY-MM-DD et start <= end.`
        );
      }
      return {
        label: String(t.label),
        start: s,
        end: e,
        color: t.color || defaultColor,
      };
    });

    // Bornes globales
    let minStart = norm[0].start;
    let maxEnd = norm[0].end;
    for (const t of norm) {
      if (t.start < minStart) minStart = t.start;
      if (t.end > maxEnd) maxEnd = t.end;
    }

    const firstMonth = startOfMonth(minStart);
    const lastMonth = startOfMonth(maxEnd);

    if (doInjectStyles) injectDefaultStyles();

    const root = el("div", { class: "gt-wrap" });

    // Boucle mois par mois
    for (
      let m = new Date(firstMonth);
      m <= lastMonth;
      m = addMonths(m, 1)
    ) {
      const monthStart = startOfMonth(m);
      const monthEnd = endOfMonth(m);
      const dim = daysInMonth(monthStart.getFullYear(), monthStart.getMonth());

      const section = el("section", { class: "gt-month" },
        el("h2", {}, formatMonthFR(monthStart))
      );

      const table = el("table", { class: "gt-table", style: { ["--days"]: String(dim) } });

      // THEAD ligne 1 : "Tâche" + 1..dim
      const thead = el("thead");
      const tr1 = el("tr");
      tr1.appendChild(el("th", { class: "gt-task" }, "Tâche"));
      for (let d = 1; d <= dim; d++) {
        const cur = new Date(monthStart.getFullYear(), monthStart.getMonth(), d);
        tr1.appendChild(
          el("th", { class: shadeWeekends && isWeekend(cur) ? "gt-we" : "" }, String(d))
        );
      }
      thead.appendChild(tr1);

      // THEAD ligne 2 : "Période" + Di..Sa
      const tr2 = el("tr", { class: "gt-days" });
      tr2.appendChild(el("th", { class: "gt-task-cell" }, "Période"));
      const dow = ["Di", "Lu", "Ma", "Me", "Je", "Ve", "Sa"];
      for (let d = 1; d <= dim; d++) {
        const cur = new Date(monthStart.getFullYear(), monthStart.getMonth(), d);
        tr2.appendChild(
          el("th", { class: shadeWeekends && isWeekend(cur) ? "gt-we" : "" }, dow[cur.getDay()])
        );
      }
      thead.appendChild(tr2);

      const tbody = el("tbody");

      // Lignes de tâches (uniquement celles intersectant le mois)
      for (const t of norm) {
        const clipped = clampIntervalToMonth(t.start, t.end, monthStart, monthEnd);
        if (!clipped) continue;

        const [segStart, segEnd] = clipped;
        const tr = el("tr");
        tr.appendChild(
          el(
            "td",
            { class: "gt-task" },
            `${t.label}  (${formatDDMM(t.start)}→${formatDDMM(t.end)})`
          )
        );

        for (let d = 1; d <= dim; d++) {
          const cur = new Date(monthStart.getFullYear(), monthStart.getMonth(), d);
          const inRange = cur >= new Date(segStart.getFullYear(), segStart.getMonth(), segStart.getDate()) &&
                          cur <= new Date(segEnd.getFullYear(), segEnd.getMonth(), segEnd.getDate());
          const td = el("td", { class: shadeWeekends && isWeekend(cur) ? "gt-we" : "" });
          if (inRange) td.appendChild(el("span", { class: "gt-bar", style: { background: t.color } }));
          tr.appendChild(td);
        }
        tbody.appendChild(tr);
      }

      table.append(thead, tbody);
      section.appendChild(table);

      // Afficher le mois uniquement s’il a au moins une ligne de tâche
      if (tbody.children.length > 0) root.appendChild(section);
    }

    mount.appendChild(root);
    return root;
  }

  // Export global
  global.renderGanttAsTables = renderGanttAsTables;
})(window);
