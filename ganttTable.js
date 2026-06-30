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

   function sanitizeLabel(label) {
    if (label == null) return "";
    return String(label)
      .replace(/[\u0000-\u001F\u007F\u2028\u2029]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
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
        for (const [prop, val] of Object.entries(v)) {
          if (prop.startsWith("--")) node.style.setProperty(prop, val);
          else node.style[prop] = val;
        }
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

  // Normalise une Date à minuit (pour comparaisons jour-à-jour)
  function dayOf(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  // Mode "cells" : une barre par cellule active
  function buildCellsCells(segStart, segEnd, monthStart, dim, shadeWeekends, color) {
    const rangeStart = dayOf(segStart);
    const rangeEnd   = dayOf(segEnd);
    const tds = [];
    for (let d = 1; d <= dim; d++) {
      const cur = new Date(monthStart.getFullYear(), monthStart.getMonth(), d);
      const td  = el("td", { class: shadeWeekends && isWeekend(cur) ? "gt-we" : "" });
      if (cur >= rangeStart && cur <= rangeEnd)
        td.appendChild(el("span", { class: "gt-bar", style: { background: color } }));
      tds.push(td);
    }
    return tds;
  }

  // Mode "continuous" : une seule cellule colspan pour toute la plage
  function buildCellsContinuous(segStart, segEnd, monthStart, dim, shadeWeekends, color) {
    const rangeStart = dayOf(segStart);
    const rangeEnd   = dayOf(segEnd);
    const tds = [];
    let d = 1;

    while (d <= dim && new Date(monthStart.getFullYear(), monthStart.getMonth(), d) < rangeStart) {
      const cur = new Date(monthStart.getFullYear(), monthStart.getMonth(), d);
      tds.push(el("td", { class: shadeWeekends && isWeekend(cur) ? "gt-we" : "" }));
      d++;
    }

    let span = 0;
    while (d + span <= dim && new Date(monthStart.getFullYear(), monthStart.getMonth(), d + span) <= rangeEnd)
      span++;

    if (span > 0) {
      const barTd = el("td", { colspan: String(span) });
      barTd.appendChild(el("div", { class: "gt-bar-continuous", style: { background: color } }));
      tds.push(barTd);
      d += span;
    }

    while (d <= dim) {
      const cur = new Date(monthStart.getFullYear(), monthStart.getMonth(), d);
      tds.push(el("td", { class: shadeWeekends && isWeekend(cur) ? "gt-we" : "" }));
      d++;
    }

    return tds;
  }

  function injectDefaultStyles() {
    if (
      document.getElementById("gantt-table-styles") ||
      document.querySelector('link[rel="stylesheet"][href*="ganttTable.css"]')
    ) return;
    const style = document.createElement("style");
    style.id = "gantt-table-styles";
    style.textContent = `
@page {
  size: A4 portrait;
  margin: 10mm;
}

@media print {
  .gt-table thead th { position: static; }
  .gt-table thead { display: table-header-group; }
  .gt-table tr { break-inside: avoid; page-break-inside: avoid; }
  .gt-month > h1, .gt-month > h2, .gt-month > h3, .gt-month > h4 {
    break-after: avoid; page-break-after: avoid;
  }
  .gt-month { break-inside: auto; page-break-inside: auto; }
  .gt-bar, .gt-we, .gt-table thead th {
    print-color-adjust: exact; -webkit-print-color-adjust: exact;
  }
  .gt-task-label, .gt-task-dates {
    white-space: normal !important; overflow: visible !important;
    text-overflow: clip !important; word-break: break-word;
  }
}

.gt-wrap {
  font-family: system-ui, -apple-system, Segoe UI, Roboto, "Helvetica Neue", Arial, sans-serif;
}

.gt-month { margin-bottom: 28px; }
.gt-month + .gt-month { border-top: 1px solid #e4e4e4; padding-top: 8px; margin-top: -4px; }

.gt-month h1, .gt-month h2, .gt-month h3, .gt-month h4 {
  margin: 0 0 6px;
  font-size: 13px;
  font-weight: 600;
  color: #3a3a3a;
  letter-spacing: 0.03em;
  text-transform: capitalize;
}

.gt-table { width: 100%; border-collapse: collapse; table-layout: fixed; }

.gt-table thead th { position: sticky; top: 0; z-index: 1; }

.gt-table th, .gt-table td {
  border: 1px solid #e0e0e0;
  padding: 2px 3px;
  font-size: 10px;
  text-align: center;
}

.gt-table th:first-child, .gt-table td:first-child { text-align: left; font-size: 11px; }

.gt-table thead tr:first-child th { background: #e6e6e6; color: #555; font-weight: 600; font-size: 9px; }
.gt-table thead tr:first-child th.gt-we { background: #d8d8d8; }

.gt-table thead tr:last-child th { background: #f2f2f2; color: #555; font-weight: 400; }
.gt-table thead tr:last-child th.gt-we { background: #e8e8e8; }

.gt-task, .gt-task-cell { text-align: left; }

.gt-task-cell { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.gt-table th.gt-task, .gt-table td.gt-task,
.gt-table th.gt-task-cell, .gt-table td.gt-task-cell { padding: 2px 6px; }

.gt-task-label, .gt-task-dates {
  display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}

.gt-task-dates { font-size: 9px; color: #6a9fd4; }

.gt-we { background: #eaeaea; }

.gt-table td { position: relative; height: auto; padding: 0; }

.gt-table td > .gt-bar {
  display: block;
  margin: 5px auto;
  width: 80%;
  height: 14px;
  min-height: 8px;
  border-radius: 4px;
  background: #7aa7ff;
}

.gt-bar-continuous {
  display: block;
  margin: 5px 0;
  width: 100%;
  height: 14px;
  min-height: 8px;
  border-radius: 4px;
  background: #7aa7ff;
  opacity: 0.8;
}
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
      monthTitleLevel = 2,
      labelWidth = "15%",
      barMode = "cells",        // "cells" | "continuous"
    } = options;

    const buildDayCells = barMode === "continuous" ? buildCellsContinuous : buildCellsCells;

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

      const cleanedLabel = sanitizeLabel(t.label);
      const safeLabel = cleanedLabel || "(Libellé indisponible)";

      return {
        label: safeLabel,
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

      // Calcul du tag de titre selon monthTitleLevel
      let titleTag = "h" + Math.min(4, Math.max(1, parseInt(monthTitleLevel)));
      let monthLabel = formatMonthFR(monthStart);
      // Forcer la majuscule sur le premier caractère
      monthLabel = monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1);
      const section = el("section", { class: "gt-month" },
        el(titleTag, {}, monthLabel)
      );

      const table = el("table", { class: "gt-table" });

      // Colgroup : fixe la largeur de la colonne tâche, le reste est réparti égalment
      const colgroup = document.createElement("colgroup");
      const colLabel = document.createElement("col");
      colLabel.style.width = labelWidth;
      colgroup.appendChild(colLabel);
      for (let d = 0; d < dim; d++) colgroup.appendChild(document.createElement("col"));
      table.appendChild(colgroup);

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
      // THEAD ligne 2 : abréviations des jours
      const tr2 = el("tr", { class: "gt-days" });
      tr2.appendChild(el("th", { class: "gt-task-cell" }, "Période"));
      const dow = ["DI", "LU", "MA", "ME", "JE", "VE", "SA"];
      for (let d = 1; d <= dim; d++) {
        const cur = new Date(monthStart.getFullYear(), monthStart.getMonth(), d);
        tr2.appendChild(
          el("th", { class: shadeWeekends && isWeekend(cur) ? "gt-we" : "" }, dow[cur.getDay()])
        );
      }

      // Abréviations en premier, numéros en second
      thead.appendChild(tr2);
      thead.appendChild(tr1);

      const tbody = el("tbody");

      // Lignes de tâches (uniquement celles intersectant le mois)
      for (const t of norm) {
        const clipped = clampIntervalToMonth(t.start, t.end, monthStart, monthEnd);
        if (!clipped) continue;

        const [segStart, segEnd] = clipped;
        const sameDay =
          t.start.getFullYear() === t.end.getFullYear() &&
          t.start.getMonth()    === t.end.getMonth()    &&
          t.start.getDate()     === t.end.getDate();
        const dateStr = sameDay
          ? formatDDMM(t.start)
          : `${formatDDMM(t.start)} → ${formatDDMM(t.end)}`;

        const tr = el("tr");
        tr.appendChild(
          el("td", { class: "gt-task", title: `${t.label} ${dateStr}` },
            el("span", { class: "gt-task-label" }, t.label),
            el("span", { class: "gt-task-dates" }, dateStr)
          )
        );

        buildDayCells(segStart, segEnd, monthStart, dim, shadeWeekends, t.color)
          .forEach(td => tr.appendChild(td));
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
