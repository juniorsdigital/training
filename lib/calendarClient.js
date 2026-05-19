'use strict';

/**
 * Browser calendar helpers — expects globals from index.html:
 * today, activePlan, DAYS_SHORT, MONTHS_FULL, Z_LABEL, Z_CSS, inferPhaseCodeUi,
 * displayPlanLabel, escapeHtml, getLocalISODate, getWeeksData, intervalsFtpOverride,
 * updateCalendarTitle, getDateForDay, planWeekCount, currentWeekIdx, formatDate,
 * PHASE_COLORS, authedJsonFetch, refreshCanonicalPlan, projectedTss
 */

let calViewYear = new Date().getFullYear();
let calViewMonth = new Date().getMonth();
let calViewMode = 'month';
let calModalState = null;
let calDragDayId = null;

function calSyncViewFromToday() {
  calViewYear = today.getFullYear();
  calViewMonth = today.getMonth();
}

function calGetTssLib() {
  return globalThis.projectedTss || null;
}

function calGetUserFtp() {
  return intervalsFtpOverride && intervalsFtpOverride > 0
    ? intervalsFtpOverride
    : (calGetTssLib()?.DEFAULT_FTP || 239);
}

function calGetPlanDateRange(plan) {
  if (!plan?.start_date) return null;
  const start = plan.start_date.slice(0, 10);
  const tw = Number(plan.total_weeks);
  if (!Number.isFinite(tw) || tw < 1) return { start, end: start };
  const endD = new Date(`${start}T00:00:00`);
  endD.setDate(endD.getDate() + tw * 7 - 1);
  return { start, end: getLocalISODate(endD) };
}

function calDateToPlanIndices(isoDate, plan) {
  const start = new Date(`${plan.start_date}T00:00:00`);
  const d = new Date(`${isoDate}T00:00:00`);
  const diff = Math.round((d - start) / 86400000);
  const dayIndex = ((diff % 7) + 7) % 7;
  const existing = (plan.days || []).find((row) => String(row.day_date).slice(0, 10) === isoDate);
  if (existing) {
    return {
      week_index: Number(existing.week_index),
      day_index: Number(existing.day_index),
      day_date: isoDate
    };
  }
  const weekOffset = Math.floor(diff / 7);
  const usesOneBased = (plan.days || []).some((row) => Number(row.week_index) >= 1);
  const week_index = usesOneBased ? weekOffset + 1 : weekOffset;
  return { week_index, day_index: dayIndex, day_date: isoDate };
}

function calBuildSessionsByDate(plan) {
  const map = new Map();
  (plan?.days || []).forEach((row) => {
    const iso = String(row.day_date || '').slice(0, 10);
    if (!iso) return;
    if (!map.has(iso)) map.set(iso, []);
    map.get(iso).push(row);
  });
  map.forEach((list) => list.sort((a, b) => (Number(a.session_slot) || 0) - (Number(b.session_slot) || 0)));
  return map;
}

function calGetDayProjectedTss(dayRow) {
  const lib = calGetTssLib();
  if (!lib || !dayRow) return null;
  const st = String(dayRow.session_type || 'rest').toLowerCase();
  if (st === 'rest') return 0;
  const est = lib.estimateProjectedTss({
    sessionType: st,
    ftp: calGetUserFtp(),
    targetWattsLabel: dayRow.target_watts_label,
    goals: dayRow.goals || []
  });
  return est.tss;
}

function calSumProjectedTssForSessions(sessions) {
  let sum = 0;
  let any = false;
  (sessions || []).forEach((row) => {
    if (String(row.session_type || 'rest').toLowerCase() === 'rest') return;
    const t = calGetDayProjectedTss(row);
    if (t != null) {
      sum += t;
      any = true;
    }
  });
  return any ? sum : null;
}

function calGetWeekTssGoal(plan, weekIndex) {
  let goal = null;
  (plan?.days || []).forEach((d) => {
    if (Number(d.week_index) !== Number(weekIndex)) return;
    const wt =
      d.week_target_tss === null || d.week_target_tss === undefined || d.week_target_tss === ''
        ? null
        : Number(d.week_target_tss);
    if (wt != null && Number.isFinite(wt)) goal = wt;
  });
  if (goal != null) return goal;
  const wk = getWeeksData().find((w) => Number(w.wk) === Number(weekIndex));
  return wk?.tss != null ? Number(wk.tss) : null;
}

function calSumProjectedTssForWeek(plan, weekIndex) {
  let sum = 0;
  let any = false;
  (plan?.days || []).forEach((d) => {
    if (Number(d.week_index) !== Number(weekIndex)) return;
    if (String(d.session_type || 'rest').toLowerCase() === 'rest') return;
    const t = calGetDayProjectedTss(d);
    if (t != null) {
      sum += t;
      any = true;
    }
  });
  return any ? sum : null;
}

function calIsDateInPlanRange(isoDate, plan) {
  const range = calGetPlanDateRange(plan);
  if (!range) return true;
  return isoDate >= range.start && isoDate <= range.end;
}

function calSessionPassesFilter(dayRow, filter, search) {
  if (String(dayRow.session_type || 'rest').toLowerCase() === 'rest') return false;
  const code = String(dayRow.phase_code || inferPhaseCodeUi(dayRow.phase_label, dayRow.phase_code) || '');
  if (filter !== 'all' && code !== filter) return false;
  if (search) {
    const q = search.toLowerCase();
    const hay = `${dayRow.label || ''} ${dayRow.details || ''}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

function calMondayStartOffset(year, month) {
  const first = new Date(year, month, 1);
  const dow = first.getDay();
  return dow === 0 ? 6 : dow - 1;
}

function calFormatChipMeta(dayRow) {
  const lib = calGetTssLib();
  const st = String(dayRow.session_type || 'rest').toLowerCase();
  const zl = Z_LABEL[st] || st.toUpperCase();
  const dur = lib?.goalValue(dayRow.goals, 'goal_duration_min');
  const tss = calGetDayProjectedTss(dayRow);
  return {
    zl,
    durStr: dur != null ? `${Math.round(dur)}m` : '',
    tssStr: tss != null ? `~${Math.round(tss)}` : '—',
    zc: Z_CSS[st] || 'bg-rest c-rest'
  };
}

function calBuildChipHtml(row, iso) {
  const m = calFormatChipMeta(row);
  return [
    '<div class="cal-session" draggable="true" data-day-id="',
    escapeHtml(row.id),
    '" data-iso="',
    iso,
    '">',
    '<span class="cal-session-pill ',
    m.zc,
    '">',
    escapeHtml(m.zl),
    '</span><span class="cal-session-body"><div class="cal-session-lbl">',
    escapeHtml(displayPlanLabel(row.label)),
    '</div><div class="cal-session-meta">',
    escapeHtml(m.durStr),
    m.durStr ? ' · ' : '',
    m.tssStr,
    ' TSS</div></span><button type="button" class="cal-session-del" data-del-id="',
    escapeHtml(row.id),
    '" title="Delete">×</button></div>'
  ].join('');
}


function calSetStatus(msg, isError) {
  const el = document.getElementById('calStatus');
  if (!el) return;
  el.textContent = msg || '';
  el.classList.toggle('err', Boolean(isError));
}

function calRenderMonthHeader() {
  const hdr = document.getElementById('calMonthHdr');
  if (!hdr) return;
  hdr.innerHTML = DAYS_SHORT.map((d) => '<div>' + d + '</div>').join('');
}

function calRenderWeekStrip(year, month) {
  const strip = document.getElementById('calWeekStrip');
  if (!strip || !activePlan) {
    if (strip) strip.innerHTML = '';
    return;
  }
  const weeksSeen = new Set();
  const parts = [];
  const last = new Date(year, month + 1, 0).getDate();
  for (let day = 1; day <= last; day++) {
    const iso = getLocalISODate(new Date(year, month, day));
    if (!calIsDateInPlanRange(iso, activePlan)) continue;
    const { week_index } = calDateToPlanIndices(iso, activePlan);
    if (weeksSeen.has(week_index)) continue;
    weeksSeen.add(week_index);
    const proj = calSumProjectedTssForWeek(activePlan, week_index);
    const goal = calGetWeekTssGoal(activePlan, week_index);
    parts.push(
      '<span>Week <b>' +
        week_index +
        '</b>: ' +
        (proj != null ? '~' + Math.round(proj) : '—') +
        ' projected / ' +
        (goal != null ? '~' + Math.round(goal) : '—') +
        ' goal</span>'
    );
  }
  strip.innerHTML = parts.join('') || '<span>No plan weeks in this month.</span>';
}

function calRenderWeekTable(filter, search) {
  const tbody = document.getElementById('calBody');
  if (!tbody) return;
  const rows = getWeeksData().filter((wk) => {
    if (filter !== 'all' && wk.pCode !== filter) return false;
    if (search) {
      const q = search.toLowerCase();
      return wk.days.some(
        (d) =>
          String(d.lbl || '')
            .toLowerCase()
            .includes(q) ||
          String(d.det || '')
            .toLowerCase()
            .includes(q)
      );
    }
    return true;
  });
  tbody.innerHTML = rows
    .map((wk) => {
      const isCurWk = wk.wk === currentWeekIdx + 1;
      const startD = getDateForDay(wk.wk - 1, 0);
      const pColorVar = PHASE_COLORS[wk.pCode] || '--accent';
      const cells = wk.days
        .map((day, i) => {
          const d = getDateForDay(wk.wk - 1, i);
          const isTodayCell = d.getTime() === today.getTime();
          const zc = Z_CSS[day.t] || '';
          const zl = Z_LABEL[day.t] || 'REST';
          return (
            '<td style="' +
            (isTodayCell ? 'background:rgba(249,115,22,0.08);' : '') +
            '"><span class="cal-pill ' +
            zc +
            '">' +
            zl +
            '</span><br><span style="font-size:9px;color:var(--muted)">' +
            formatDate(d) +
            '</span><br><span class="cal-day-txt">' +
            escapeHtml(displayPlanLabel(day.lbl)) +
            '</span></td>'
          );
        })
        .join('');
      return (
        '<tr class="' +
        (isCurWk ? 'cur-wk' : '') +
        '"><td class="cal-wk">' +
        wk.wk +
        '</td><td><span style="font-size:10px;font-weight:700;color:var(' +
        pColorVar +
        ')">' +
        escapeHtml(wk.phase) +
        '</span><br><span style="font-size:9px;color:var(--muted)">' +
        formatDate(startD) +
        '</span></td>' +
        cells +
        '<td class="cal-tss">' +
        (wk.tss != null && Number.isFinite(Number(wk.tss)) ? '~' + wk.tss : '—') +
        '</td></tr>'
      );
    })
    .join('');
}

function calRenderMonthGrid(filter, search) {
  const grid = document.getElementById('calMonthGrid');
  if (!grid) return;
  if (!activePlan?.id) {
    grid.innerHTML =
      '<div style="grid-column:1/-1;padding:20px;color:var(--muted);font-size:12px">Load a canonical plan from Plan Editor to use the calendar.</div>';
    grid.innerHTML =
      '<div style="grid-column:1/-1;padding:20px;color:var(--muted);font-size:12px">Load a canonical plan from Plan Editor to use the calendar.</div>';
    return;
  }
  const sessionsByDate = calBuildSessionsByDate(activePlan);
  const pad = calMondayStartOffset(calViewYear, calViewMonth);
  const daysInMonth = new Date(calViewYear, calViewMonth + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < pad; i++) {
    const d = new Date(calViewYear, calViewMonth, -pad + i + 1);
    cells.push({ iso: getLocalISODate(d), outside: true });
  }
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push({ iso: getLocalISODate(new Date(calViewYear, calViewMonth, day)), outside: false });
  }
  while (cells.length % 7 !== 0) {
    const n = cells.length - pad - daysInMonth + 1;
    cells.push({ iso: getLocalISODate(new Date(calViewYear, calViewMonth + 1, n)), outside: true });
  }
  const todayIso = getLocalISODate(today);
  grid.innerHTML = cells
    .map(({ iso, outside }) => {
      const inPlan = calIsDateInPlanRange(iso, activePlan);
      const allSessions = sessionsByDate.get(iso) || [];
      const visible = allSessions.filter((row) => calSessionPassesFilter(row, filter, search));
      const dayNum = Number(iso.slice(8, 10));
      const chips = visible.map((row) => calBuildChipHtml(row, iso)).join('');
      const daySum = calSumProjectedTssForSessions(allSessions);
      const foot = daySum != null ? '~' + Math.round(daySum) + ' TSS' : '';
      const addBtn = inPlan && !outside ? '<button type="button" class="cal-month-add" data-add-iso="' + iso + '" title="Add workout">+</button>' : '';
      const cls = [
        'cal-month-cell',
        outside ? 'cal-month-cell--outside' : '',
        !inPlan ? 'cal-month-cell--outplan' : '',
        iso === todayIso ? 'cal-month-cell--today' : ''
      ]
        .filter(Boolean)
        .join(' ');
      return (
        '<div class="' +
        cls +
        '" data-drop-iso="' +
        iso +
        '" data-in-plan="' +
        (inPlan ? '1' : '0') +
        '"><div class="cal-month-cell-top"><span class="cal-month-date">' +
        dayNum +
        '</span>' +
        addBtn +
        '</div><div class="cal-month-sessions">' +
        chips +
        '</div><div class="cal-day-tss-foot">' +
        foot +
        '</div></div>'
      );
    })
    .join('');
}

function calReadModalWatts() {
  const wattsEl = document.getElementById('calModalWatts');
  const minEl = document.getElementById('calModalWattsMin');
  const maxEl = document.getElementById('calModalWattsMax');
  const wMin = minEl?.value ? Number(minEl.value) : null;
  const wMax = maxEl?.value ? Number(maxEl.value) : null;
  if (wMin != null && wMax != null && wMin > 0 && wMax > 0) {
    return { watts: null, wattsMin: wMin, wattsMax: wMax };
  }
  const w = wattsEl?.value ? Number(wattsEl.value) : null;
  return { watts: w && w > 0 ? w : null, wattsMin: null, wattsMax: null };
}

function calUpdateModalPreview() {
  const lib = calGetTssLib();
  const preview = document.getElementById('calModalPreview');
  if (!preview || !lib) return;
  const typeEl = document.getElementById('calModalType');
  const durEl = document.getElementById('calModalDur');
  const manualCb = document.getElementById('calModalManualTss');
  const tssEl = document.getElementById('calModalTss');
  const st = String(typeEl?.value || 'rest').toLowerCase();
  if (st === 'rest') {
    preview.textContent = '0 TSS · rest day';
    return;
  }
  const manual = manualCb?.checked;
  const wattInputs = calReadModalWatts();
  const goals = lib.buildGoalsFromWorkoutForm({
    sessionType: st,
    durationMin: Number(durEl?.value),
    manualTss: manual ? Number(tssEl?.value) : null,
    manualOverride: manual,
    watts: wattInputs.watts,
    wattsMin: wattInputs.wattsMin,
    wattsMax: wattInputs.wattsMax
  });
  const est = lib.estimateProjectedTss({
    sessionType: st,
    durationMin: Number(durEl?.value),
    ftp: calGetUserFtp(),
    watts: wattInputs.watts,
    wattsMin: wattInputs.wattsMin,
    wattsMax: wattInputs.wattsMax,
    goals,
    manualTss: manual ? Number(tssEl?.value) : null
  });
  const ifStr = est.ifUsed != null ? 'IF ' + est.ifUsed.toFixed(2) : '';
  const durStr = durEl?.value ? durEl.value + ' min' : '';
  let wStr = '';
  if (est.wattsMin != null && est.wattsMax != null) wStr = ' · ' + Math.round(est.wattsMin) + '–' + Math.round(est.wattsMax) + 'W';
  else if (est.wattsUsed != null) wStr = ' · ' + Math.round(est.wattsUsed) + 'W';
  preview.textContent =
    (est.tss != null ? '~' + est.tss + ' TSS' : '— TSS') + (ifStr ? ' · ' + ifStr : '') + wStr + (durStr ? ' · ' + durStr : '');
}

function calPopulateModalTypes() {
  const sel = document.getElementById('calModalType');
  if (!sel) return;
  sel.innerHTML = Object.keys(Z_LABEL)
    .map((k) => '<option value="' + k + '">' + Z_LABEL[k] + '</option>')
    .join('');
}

function calOpenModal(mode, isoDate, dayRow) {
  calModalState = { mode, isoDate, dayId: dayRow?.id || null };
  const overlay = document.getElementById('calDayModal');
  const title = document.getElementById('calModalTitle');
  if (!overlay) return;
  calPopulateModalTypes();
  const typeEl = document.getElementById('calModalType');
  const durRow = document.getElementById('calModalDurRow');
  const labelEl = document.getElementById('calModalLabel');
  const durEl = document.getElementById('calModalDur');
  const wattsEl = document.getElementById('calModalWatts');
  const wattsMinEl = document.getElementById('calModalWattsMin');
  const wattsMaxEl = document.getElementById('calModalWattsMax');
  const detEl = document.getElementById('calModalDetails');
  const manualCb = document.getElementById('calModalManualTss');
  const tssEl = document.getElementById('calModalTss');
  const lib = calGetTssLib();

  if (title) title.textContent = mode === 'edit' ? 'Edit workout' : 'Add workout';
  const st = dayRow ? String(dayRow.session_type || 'z2').toLowerCase() : 'z2';
  if (typeEl) typeEl.value = st;
  const dur = lib?.goalValue(dayRow?.goals, 'goal_duration_min') ?? 90;
  if (durEl) durEl.value = dur;
  if (labelEl) labelEl.value = dayRow ? displayPlanLabel(dayRow.label) : '';
  const gMin = lib?.goalValue(dayRow?.goals, 'goal_wattage_min');
  const gMax = lib?.goalValue(dayRow?.goals, 'goal_wattage_max');
  if (gMin != null && gMax != null) {
    if (wattsEl) wattsEl.value = '';
    if (wattsMinEl) wattsMinEl.value = gMin;
    if (wattsMaxEl) wattsMaxEl.value = gMax;
  } else {
    if (wattsMinEl) wattsMinEl.value = '';
    if (wattsMaxEl) wattsMaxEl.value = '';
    const fromLabel = lib?.parseWattsRange?.(dayRow?.target_watts_label);
    if (fromLabel?.min != null && fromLabel?.max != null) {
      if (wattsMinEl) wattsMinEl.value = fromLabel.min;
      if (wattsMaxEl) wattsMaxEl.value = fromLabel.max;
      if (wattsEl) wattsEl.value = '';
    } else {
      if (wattsEl) {
        wattsEl.value =
          lib?.goalValue(dayRow?.goals, 'goal_wattage') || lib?.parseWatts(dayRow?.target_watts_label) || '';
      }
    }
  }
  if (detEl) detEl.value = dayRow?.details || '';
  const manualGoal = (dayRow?.goals || []).find((g) => String(g.goal_type) === 'goal_tss' && String(g.notes || '').includes('source:manual'));
  if (manualCb) manualCb.checked = Boolean(manualGoal);
  if (tssEl) {
    tssEl.disabled = !manualCb?.checked;
    tssEl.value = manualGoal?.target_value ?? lib?.goalValue(dayRow?.goals, 'goal_tss') ?? '';
  }
  if (durRow) durRow.style.display = st === 'rest' ? 'none' : '';
  overlay.hidden = false;
  calUpdateModalPreview();
}

function calCloseModal() {
  const overlay = document.getElementById('calDayModal');
  if (overlay) overlay.hidden = true;
  calModalState = null;
}

async function calSaveModal() {
  if (!activePlan?.id || !calModalState) return;
  const lib = calGetTssLib();
  const typeEl = document.getElementById('calModalType');
  const durEl = document.getElementById('calModalDur');
  const labelEl = document.getElementById('calModalLabel');
  const detEl = document.getElementById('calModalDetails');
  const manualCb = document.getElementById('calModalManualTss');
  const tssEl = document.getElementById('calModalTss');
  const st = String(typeEl?.value || 'rest').toLowerCase();
  const label = String(labelEl?.value || '').trim() || (st === 'rest' ? 'REST' : '');
  if (!label) {
    calSetStatus('Label is required.', true);
    return;
  }
  const wattInputs = calReadModalWatts();
  const indices = calDateToPlanIndices(calModalState.isoDate, activePlan);
  const phaseRow = (activePlan.days || []).find((d) => Number(d.week_index) === Number(indices.week_index));
  const goals =
    st === 'rest'
      ? []
      : lib.buildGoalsFromWorkoutForm({
          sessionType: st,
          durationMin: Number(durEl?.value),
          label,
          watts: wattInputs.watts,
          wattsMin: wattInputs.wattsMin,
          wattsMax: wattInputs.wattsMax,
          manualTss: manualCb?.checked ? Number(tssEl?.value) : null,
          manualOverride: Boolean(manualCb?.checked)
        });
  const payload = {
    id: calModalState.dayId || undefined,
    week_index: indices.week_index,
    day_index: indices.day_index,
    day_date: indices.day_date,
    session_type: st,
    label,
    details: detEl?.value ? String(detEl.value).trim() : null,
    target_watts_label:
      st === 'rest'
        ? null
        : lib.formatWattsLabel(wattInputs.watts, wattInputs.wattsMin, wattInputs.wattsMax),
    phase_label: phaseRow?.phase_label || null,
    phase_code: phaseRow?.phase_code || null,
    session_slot: 0,
    goals,
    tss_manual_override: Boolean(manualCb?.checked),
    ftp: calGetUserFtp()
  };
  calSetStatus('Saving…');
  try {
    await authedJsonFetch('/api/training-plan-days?planId=' + encodeURIComponent(activePlan.id), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    calCloseModal();
    await refreshCanonicalPlan();
    calRenderCurrent();
    calSetStatus('Saved.');
  } catch (e) {
    calSetStatus(e.message || 'Save failed.', true);
  }
}

async function calDeleteDay(dayId) {
  if (!dayId) return;
  if (!confirm('Delete this workout?')) return;
  calSetStatus('Deleting…');
  try {
    await authedJsonFetch('/api/training-plan-days?dayId=' + encodeURIComponent(dayId), { method: 'DELETE' });
    await refreshCanonicalPlan();
    calRenderCurrent();
    calSetStatus('Deleted.');
  } catch (e) {
    calSetStatus(e.message || 'Delete failed.', true);
  }
}

function calPrimarySessionOnDate(isoDate) {
  const rows = (activePlan?.days || []).filter((d) => String(d.day_date).slice(0, 10) === isoDate);
  const workout = rows.find((d) => String(d.session_type || 'rest').toLowerCase() !== 'rest');
  return workout || null;
}

async function calDropSession(fromDayId, targetIso) {
  if (!activePlan?.id || !fromDayId || !targetIso) return;
  const fromRow = (activePlan.days || []).find((d) => String(d.id) === String(fromDayId));
  if (!fromRow) return;
  const fromIso = String(fromRow.day_date).slice(0, 10);
  if (fromIso === targetIso) return;
  if (!calIsDateInPlanRange(targetIso, activePlan)) return;
  const targetWorkout = calPrimarySessionOnDate(targetIso);
  const indices = calDateToPlanIndices(targetIso, activePlan);
  calSetStatus('Saving…');
  try {
    if (targetWorkout) {
      await authedJsonFetch('/api/training-plan-days?planId=' + encodeURIComponent(activePlan.id), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          op: 'swap',
          day_a_id: fromDayId,
          day_b_id: targetWorkout.id,
          ftp: calGetUserFtp()
        })
      });
    } else {
      await authedJsonFetch('/api/training-plan-days?planId=' + encodeURIComponent(activePlan.id), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          op: 'move',
          from_day_id: fromDayId,
          to_week_index: indices.week_index,
          to_day_index: indices.day_index,
          ftp: calGetUserFtp()
        })
      });
    }
    await refreshCanonicalPlan();
    calRenderCurrent();
    calSetStatus('Updated.');
  } catch (e) {
    calSetStatus(e.message || 'Move failed.', true);
  }
}

function calGetActiveFilter() {
  return document.querySelector('#calFilter .cal-pb.active')?.dataset.phase || 'all';
}

function calGetSearch() {
  return document.getElementById('calSearch')?.value || '';
}

function calRenderCurrent() {
  const filter = calGetActiveFilter();
  const search = calGetSearch();
  updateCalendarTitle();
  if (calViewMode === 'week') {
    document.getElementById('calMonthGrid')?.parentElement;
    const grid = document.getElementById('calMonthGrid');
    const weekWrap = document.getElementById('calWeekWrap');
    const monthNav = document.querySelector('.cal-month-nav');
    const monthHdr = document.getElementById('calMonthHdr');
    const weekStrip = document.getElementById('calWeekStrip');
    if (grid) grid.hidden = true;
    if (monthNav) monthNav.hidden = true;
    if (monthHdr) monthHdr.hidden = true;
    if (weekStrip) weekStrip.hidden = true;
    if (weekWrap) weekWrap.hidden = false;
    calRenderWeekTable(filter, search);
    return;
  }
  const grid = document.getElementById('calMonthGrid');
  const weekWrap = document.getElementById('calWeekWrap');
  const monthNav = document.querySelector('.cal-month-nav');
  const monthHdr = document.getElementById('calMonthHdr');
  const weekStrip = document.getElementById('calWeekStrip');
  if (grid) grid.hidden = false;
  if (monthNav) monthNav.hidden = false;
  if (monthHdr) monthHdr.hidden = false;
  if (weekStrip) weekStrip.hidden = false;
  if (weekWrap) weekWrap.hidden = true;
  const label = document.getElementById('calMonthLabel');
  if (label) label.textContent = MONTHS_FULL[calViewMonth] + ' ' + calViewYear;
  calRenderMonthHeader();
  calRenderWeekStrip(calViewYear, calViewMonth);
  calRenderMonthGrid(filter, search);
}

function calEnsureViewMonth() {
  if (!activePlan?.start_date) return;
  const range = calGetPlanDateRange(activePlan);
  const todayIso = getLocalISODate(today);
  if (range && todayIso >= range.start && todayIso <= range.end) {
    calViewYear = today.getFullYear();
    calViewMonth = today.getMonth();
    return;
  }
  const start = new Date(activePlan.start_date + 'T00:00:00');
  calViewYear = start.getFullYear();
  calViewMonth = start.getMonth();
}

function calOnPanelOpen() {
  if (!activePlan?.id) {
    refreshCanonicalPlan()
      .catch(() => {})
      .finally(() => {
        calEnsureViewMonth();
        calRenderCurrent();
      });
    return;
  }
  calEnsureViewMonth();
  calRenderCurrent();
}

let calInteractionsReady = false;

function calInitInteractions() {
  if (calInteractionsReady) return;
  calInteractionsReady = true;
  if (typeof today !== 'undefined') calSyncViewFromToday();
  calPopulateModalTypes();

  document.getElementById('calMonthPrev')?.addEventListener('click', () => {
    calViewMonth -= 1;
    if (calViewMonth < 0) {
      calViewMonth = 11;
      calViewYear -= 1;
    }
    calRenderCurrent();
  });
  document.getElementById('calMonthNext')?.addEventListener('click', () => {
    calViewMonth += 1;
    if (calViewMonth > 11) {
      calViewMonth = 0;
      calViewYear += 1;
    }
    calRenderCurrent();
  });
  document.getElementById('calMonthToday')?.addEventListener('click', () => {
    calViewYear = today.getFullYear();
    calViewMonth = today.getMonth();
    calRenderCurrent();
  });
  document.getElementById('calViewToggle')?.addEventListener('click', () => {
    calViewMode = calViewMode === 'month' ? 'week' : 'month';
    document.getElementById('calViewToggle').textContent = calViewMode === 'month' ? 'Week table' : 'Month grid';
    calRenderCurrent();
  });
  document.getElementById('calModalCancel')?.addEventListener('click', calCloseModal);
  document.getElementById('calModalSave')?.addEventListener('click', () => calSaveModal());
  document.getElementById('calDayModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'calDayModal') calCloseModal();
  });
  ['calModalType', 'calModalDur', 'calModalWatts', 'calModalWattsMin', 'calModalWattsMax', 'calModalManualTss', 'calModalTss'].forEach((id) => {
    document.getElementById(id)?.addEventListener('input', () => {
      const st = document.getElementById('calModalType')?.value;
      const durRow = document.getElementById('calModalDurRow');
      if (durRow) durRow.style.display = st === 'rest' ? 'none' : '';
      const manualCb = document.getElementById('calModalManualTss');
      const tssEl = document.getElementById('calModalTss');
      if (id === 'calModalManualTss' && tssEl) tssEl.disabled = !manualCb?.checked;
      calUpdateModalPreview();
    });
  });
  document.getElementById('calDurPresets')?.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-min]');
    if (!btn) return;
    document.querySelectorAll('#calDurPresets button').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    const durEl = document.getElementById('calModalDur');
    if (durEl) durEl.value = btn.dataset.min;
    calUpdateModalPreview();
  });

  const grid = document.getElementById('calMonthGrid');
  grid?.addEventListener('click', (e) => {
    const add = e.target.closest('[data-add-iso]');
    if (add) {
      calOpenModal('add', add.dataset.addIso, null);
      return;
    }
    const del = e.target.closest('[data-del-id]');
    if (del) calDeleteDay(del.dataset.delId);
    const chip = e.target.closest('.cal-session');
    if (chip && !e.target.closest('.cal-session-del')) {
      const row = (activePlan?.days || []).find((d) => String(d.id) === chip.dataset.dayId);
      if (row && window.matchMedia('(pointer: coarse)').matches) {
        const dest = prompt('Move to date (YYYY-MM-DD)', chip.dataset.iso);
        if (dest) calDropSession(chip.dataset.dayId, dest.slice(0, 10));
      } else if (row) {
        calOpenModal('edit', chip.dataset.iso, row);
      }
    }
  });

  grid?.addEventListener('dragstart', (e) => {
    const chip = e.target.closest('.cal-session');
    if (!chip) return;
    calDragDayId = chip.dataset.dayId;
    chip.classList.add('cal-session--dragging');
    e.dataTransfer?.setData('text/plain', calDragDayId);
    e.dataTransfer.effectAllowed = 'move';
  });
  grid?.addEventListener('dragend', (e) => {
    e.target.closest('.cal-session')?.classList.remove('cal-session--dragging');
    document.querySelectorAll('.cal-month-cell--drop-target').forEach((el) => el.classList.remove('cal-month-cell--drop-target'));
    calDragDayId = null;
  });
  grid?.addEventListener('dragover', (e) => {
    const cell = e.target.closest('[data-drop-iso]');
    if (!cell || cell.dataset.inPlan !== '1') return;
    e.preventDefault();
    cell.classList.add('cal-month-cell--drop-target');
  });
  grid?.addEventListener('dragleave', (e) => {
    e.target.closest('[data-drop-iso]')?.classList.remove('cal-month-cell--drop-target');
  });
  grid?.addEventListener('drop', (e) => {
    e.preventDefault();
    const cell = e.target.closest('[data-drop-iso]');
    cell?.classList.remove('cal-month-cell--drop-target');
    if (!cell || cell.dataset.inPlan !== '1') return;
    const id = calDragDayId || e.dataTransfer?.getData('text/plain');
    calDropSession(id, cell.dataset.dropIso);
  });
}

globalThis.calendarClient = {
  calRenderCurrent,
  calOnPanelOpen,
  calInitInteractions,
  calGetDayProjectedTss,
  calSumProjectedTssForSessions
};

