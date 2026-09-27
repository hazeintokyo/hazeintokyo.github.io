(() => {
  const openButton = document.querySelector('[data-menu-open]');
  const closeButton = document.querySelector('[data-menu-close]');
  const menu = document.querySelector('[data-menu]');
  const main = document.querySelector('[data-haze]');
  const tabs = [...menu.querySelectorAll('[role="tab"]')];
  const panels = [...menu.querySelectorAll('[role="tabpanel"]')];
  const scheduleList = menu.querySelector('[data-schedule-list]');
  let previousFocus;
  const eventParts = value => {
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
    if (!match) return null;
    const [, year, month, day, hour, minute] = match;
    const localDate = new Date(Date.UTC(+year, +month - 1, +day));
    const weekday = new Intl.DateTimeFormat('en-US', {weekday: 'short', timeZone: 'UTC'}).format(localDate);
    return {year, month, date: day, weekday: `(${weekday.toUpperCase()})`, time: `${hour}:${minute}`};
  };
  const safeUrl = value => {
    try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : null; }
    catch (_) { return null; }
  };
  const renderSchedules = events => {
    const upcoming = events.filter(event => event && typeof event.id === 'string' && eventParts(event.startsAt) && Number.isFinite(Date.parse(event.startsAt)) && Date.parse(event.startsAt) >= Date.now()).sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
    scheduleList.replaceChildren();
    if (!upcoming.length) { const empty = document.createElement('p'); empty.className = 'schedule-status'; empty.textContent = 'No upcoming events.'; scheduleList.append(empty); return; }
    upcoming.forEach(event => {
      const parts = eventParts(event.startsAt), endParts = event.endsAt ? eventParts(event.endsAt) : null, row = document.createElement('article'); row.className = 'schedule-row';
      const displayTime = event.time || parts.time;
      if (displayTime === 'TBA') row.classList.add('schedule-row--tba');
      const date = document.createElement('div'); date.className = 'schedule-row__date'; date.textContent = `${parts.year}.${parts.month}.${parts.date} ${parts.weekday}`;
      const time = document.createElement('div'); time.className = 'schedule-row__time'; time.textContent = `${displayTime}${endParts ? ` – ${endParts.time}` : ''}`;
      const details = document.createElement('div'); details.className = 'event-details';
      const title = event.title ? document.createElement('h3') : null;
      if (title) { title.className = 'event-title'; title.textContent = event.title; }
      const venueUrl = safeUrl(event.venueUrl);
      const venue = document.createElement('p'); venue.className = 'event-venue';
      if (event.venue) {
        if (venueUrl) { const venueLink = document.createElement('a'); venueLink.href = venueUrl; venueLink.target = '_blank'; venueLink.rel = 'noreferrer'; venueLink.textContent = event.venue; venue.append(venueLink); }
        else venue.textContent = event.venue;
      }
      const area = document.createElement('p'); area.className = 'event-area'; area.textContent = event.location || '';
      const links = document.createElement('div'); links.className = 'event-links';
      (Array.isArray(event.links) ? event.links : []).forEach(link => { const url = safeUrl(link?.url); if (!url || typeof link.label !== 'string') return; const anchor = document.createElement('a'); anchor.href = url; anchor.target = '_blank'; anchor.rel = 'noreferrer'; anchor.setAttribute('aria-label', link.label); anchor.title = link.label; const shortLabel = link.label === 'RA.co' ? 'RA' : link.label.toLowerCase().includes('instagram') ? 'IG' : link.label.slice(0, 2).toUpperCase(); anchor.textContent = `[${shortLabel}]`; links.append(anchor); });
      if (title) details.append(title); if (event.venue) details.append(venue); if (event.location) details.append(area); row.append(date, time, details); if (links.childElementCount) row.append(links); scheduleList.append(row);
    });
  };
  fetch('data/schedule.json').then(response => { if (!response.ok) throw Error('Schedule unavailable'); return response.json(); }).then(data => renderSchedules(Array.isArray(data) ? data : [])).catch(() => { scheduleList.replaceChildren(); const error = document.createElement('p'); error.className = 'schedule-status'; error.textContent = 'Schedules unavailable.'; scheduleList.append(error); });
  const setOpen = open => {
    menu.hidden = !open;
    main.inert = open;
    openButton.setAttribute('aria-expanded', String(open));
    document.body.classList.toggle('menu-open', open);
    document.dispatchEvent(new CustomEvent('haze:menu', {detail: {open}}));
    if (open) { previousFocus = document.activeElement; closeButton.focus(); }
    else (previousFocus?.isConnected ? previousFocus : openButton).focus();
  };
  openButton.addEventListener('click', () => setOpen(true));
  closeButton.addEventListener('click', () => setOpen(false));
  const selectTab = tab => {
    tabs.forEach(candidate => {
      const selected = candidate === tab;
      candidate.setAttribute('aria-selected', String(selected));
      candidate.tabIndex = selected ? 0 : -1;
      document.getElementById(candidate.getAttribute('aria-controls')).hidden = !selected;
    });
  };
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => selectTab(tab));
    tab.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      selectTab(tabs[next]);
      tabs[next].focus();
    });
  });
  menu.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); setOpen(false); return; }
    if (event.key !== 'Tab') return;
    const focusables = [...menu.querySelectorAll('button, a[href]')];
    const first = focusables[0], last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
})();
