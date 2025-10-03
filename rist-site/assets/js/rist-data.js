/* assets/js/rist-data.js */
window.RIST = (function () {
  'use strict';

  const CONFIG = {
    SHEET_ID: '1gOv67Z8hAYJB8dlDmdpzxVeYWlhcjbEc_X_R3VbBxb0', // <= replace with your Google Sheet ID
    TABS: { notices: 'Notices', faculty: 'Faculty', events: 'Events' },
    CACHE_TTL: 10 * 60 * 1000 // 10 minutes
  };

  /* ---------- helpers ---------- */
  function osUrl(tab) {
    return `https://opensheet.elk.sh/${CONFIG.SHEET_ID}/${encodeURIComponent(tab)}`;
  }
  function cacheKey(key) { return `rist-${CONFIG.SHEET_ID}-${key}`; }
  function cacheGet(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (Date.now() - obj.time > CONFIG.CACHE_TTL) return null;
      return obj.data;
    } catch { return null; }
  }
  function cacheSet(key, data) {
    try { localStorage.setItem(key, JSON.stringify({ time: Date.now(), data })); } catch {}
  }
  async function getRows(tab, key) {
    const ck = cacheKey(key);
    const cached = cacheGet(ck);
    if (cached) return cached;
    const url = osUrl(tab);
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) throw new Error(`Failed to load ${tab}: ${res.status}`);
    const json = await res.json();
    cacheSet(ck, json);
    return json;
  }
  function parseDateFlexible(s) {
    if (!s) return null;
    const d = new Date(s);
    if (!isNaN(d)) return d;
    const parts = String(s).trim().split(/[\s/.-]+/);
    if (parts.length >= 3) {
      const [a,b,c] = parts;
      const maybe = new Date(`${a} ${b} ${c}`); if (!isNaN(maybe)) return maybe;
      const maybe2 = new Date(`${c}-${b}-${a}`); if (!isNaN(maybe2)) return maybe2;
    }
    return null;
  }
  function toISODate(d) {
    const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,'0'), day = String(d.getDate()).padStart(2,'0');
    return `${y}-${m}-${day}`;
  }

  /* ---------- Notices ---------- */
  function normalizeNotice(r) {
    const d = parseDateFlexible(r.Date);
    const pinned = String(r.Pinned || '').toUpperCase() === 'TRUE';
    const type = String(r.Type || 'general').toLowerCase();
    const isNew = d ? ((Date.now() - d.getTime()) / (1000*60*60*24) <= 14) : false;
    return {
      date: d, dateText: d ? d.toLocaleDateString(undefined,{day:'2-digit',month:'short',year:'numeric'}) : '',
      isNew, pinned,
      type: ['admission','exam','event','general'].includes(type) ? type : 'general',
      title: r.Title || 'Notice',
      summary: r.Summary || '',
      linkLabel: r.LinkLabel || '',
      linkURL: r.LinkURL || ''
    };
  }
  async function fetchNotices() {
    const rows = await getRows(CONFIG.TABS.notices, 'notices');
    return rows.map(normalizeNotice).sort((a,b)=>{
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      const da = a.date ? a.date.getTime() : 0;
      const db = b.date ? b.date.getTime() : 0;
      return db - da;
    });
  }
  function renderNotices(containerId, notices) {
    const list = document.getElementById(containerId);
    if (!list) return;
    list.innerHTML = '';
    if (!notices.length) {
      const empty = document.createElement('div');
      empty.className = 'card';
      empty.style.cssText = 'padding:14px 16px; text-align:center; color:var(--muted)';
      empty.textContent = 'No notices right now.';
      list.appendChild(empty);
      return;
    }
    notices.forEach(n => {
      const d = document.createElement('details');
      d.className = 'notice reveal';
      if (n.pinned) d.open = true;
      const summary = document.createElement('summary');
      summary.innerHTML = `
        <span class="caret">▸</span>
        <span class="chip" data-type="${n.type}">${n.type.charAt(0).toUpperCase()+n.type.slice(1)}</span>
        <span class="notice-title">${n.title}</span>
        <span class="date-tag">${n.dateText}${n.isNew ? ' <span class="badge-new">NEW</span>' : ''}</span>
      `;
      const body = document.createElement('div'); body.className = 'notice-body'; body.textContent = n.summary;
      const actions = document.createElement('div'); actions.className = 'notice-actions';
      if (n.linkURL) {
        const a = document.createElement('a');
        a.className = /download|pdf/i.test(n.linkLabel) ? 'btn btn-outline' : 'btn btn-primary';
        a.href = n.linkURL; a.target='_blank'; a.rel='noopener';
        a.textContent = n.linkLabel || 'Read more';
        actions.appendChild(a);
      }
      d.append(summary, body, actions);
      list.appendChild(d);
      if (window.io) window.io.observe(d); else d.classList.add('visible');
    });
  }

  /* ---------- Events ---------- */
  function statusFromDates(start, end, explicit) {
    if (explicit) {
      const t = String(explicit).toLowerCase();
      if (t.includes('past')) return 'past';
      if (t.includes('upcoming')) return 'upcoming';
    }
    const today = new Date(); today.setHours(0,0,0,0);
    const s = start ? new Date(start.getFullYear(), start.getMonth(), start.getDate()) : null;
    const e = end ? new Date(end.getFullYear(), end.getMonth(), end.getDate()) : null;
    if (e && e < today) return 'past';
    if (s && s <= today && (!e || e >= today)) return 'ongoing';
    return 'upcoming';
  }
  function normalizeEvent(r) {
    const s = parseDateFlexible(r.StartDate);
    const e = parseDateFlexible(r.EndDate);
    return {
      start: s || new Date(),
      end: e || null,
      startISO: s ? toISODate(s) : undefined,
      endISO: e ? toISODate(e) : undefined,
      title: r.Title || 'Event',
      subtitle: r.Subtitle || '',
      venue: r.Venue || 'RIST Campus',
      description: r.Description || '',
      regLabel: r.RegisterLabel || '',
      regURL: r.RegisterURL || '',
      detailsURL: r.DetailsURL || '',
      pinned: String(r.Pinned || '').toUpperCase() === 'TRUE',
      status: statusFromDates(s,e,r.Status)
    };
  }
  async function fetchEvents() {
    const rows = await getRows(CONFIG.TABS.events, 'events');
    const data = rows.map(normalizeEvent);
    const upcoming = data.filter(d => d.status !== 'past').sort((a,b) => a.start - b.start);
    const past = data.filter(d => d.status === 'past').sort((a,b) => b.start - a.start);
    const pinnedUp = upcoming.filter(e => e.pinned);
    const restUp = upcoming.filter(e => !e.pinned);
    return [...pinnedUp, ...restUp, ...past];
  }
  function renderEvents(containerId, events) {
    const grid = document.getElementById(containerId);
    if (!grid) return;
    grid.innerHTML = '';
    if (!events.length) {
      const empty = document.createElement('div');
      empty.className = 'card';
      empty.style.cssText = 'padding:14px 16px; text-align:center; color:var(--muted)';
      empty.textContent = 'No events right now.';
      grid.appendChild(empty); return;
    }
    events.forEach(ev => {
      const card = document.createElement('article'); card.className = 'card event-card reveal'; card.dataset.status = ev.status;
      const head = document.createElement('div'); head.className = 'event-head';
      const df = document.createElement('div'); df.className = 'date-flag';
      df.innerHTML = `<span class="day">${String(ev.start.getDate()).padStart(2,'0')}</span><span class="mon">${ev.start.toLocaleString(undefined,{month:'short'})}</span>`;
      const titleWrap = document.createElement('div');
      const h3 = document.createElement('h3'); h3.className = 'title'; h3.style.margin='0'; h3.textContent = ev.title;
      const meta = document.createElement('p'); meta.className='meta'; meta.textContent = [ev.venue, ev.subtitle].filter(Boolean).join(' • ');
      titleWrap.append(h3, meta); head.append(df, titleWrap);
      const body = document.createElement('div'); body.className = 'body';
      if (ev.description) { const p = document.createElement('p'); p.className='meta'; p.textContent = ev.description; body.appendChild(p); }
      const actions = document.createElement('div'); actions.className='actions';
      if (ev.regURL) { const a=document.createElement('a'); a.className='btn btn-primary'; a.href=ev.regURL; a.target='_blank'; a.rel='noopener'; a.textContent=ev.regLabel || 'Register'; actions.appendChild(a); }
      if (ev.detailsURL) { const a=document.createElement('a'); a.className='btn btn-outline'; a.href=ev.detailsURL; a.target='_blank'; a.rel='noopener'; a.textContent='Details'; actions.appendChild(a); }
      body.appendChild(actions);
      card.append(head, body); grid.appendChild(card);
      if (window.io) window.io.observe(card); else card.classList.add('visible');
    });
  }

  // Exposed: so index.html can call RIST.setupEventsFilters()
  function setupEventsFilters() {
    const wrap = document.querySelector('[data-events-filter]');
    if (!wrap) return;
    const buttons = Array.from(wrap.querySelectorAll('button[data-filter]'));
    function apply(filter) {
      const cards = Array.from(document.querySelectorAll('.event-card'));
      cards.forEach(c => {
        const st = c.dataset.status || 'upcoming';
        const show = (filter === 'all') || (filter === 'upcoming' && (st==='upcoming' || st==='ongoing')) || (filter==='past' && st==='past');
        c.hidden = !show;
      });
    }
    if (!wrap._bound) {
      buttons.forEach(btn => {
        btn.addEventListener('click', () => {
          buttons.forEach(b => { b.classList.remove('active'); b.setAttribute('aria-pressed','false'); });
          btn.classList.add('active'); btn.setAttribute('aria-pressed','true');
          apply(btn.dataset.filter);
        });
      });
      wrap._bound = true;
    }
    const active = buttons.find(b => b.classList.contains('active')) || buttons[0];
    apply(active?.dataset.filter || 'all');
  }

  function injectEventJsonLd(events, limit=5) {
    const upcoming = events.filter(e => e.status !== 'past').slice(0, limit);
    if (!upcoming.length) return;
    const base = (location.origin || 'https://example.com');
    const graph = upcoming.map(ev => ({
      '@type':'Event',
      name: ev.title,
      startDate: ev.startISO,
      endDate: ev.endISO,
      eventStatus: 'https://schema.org/EventScheduled',
      eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
      description: ev.description || undefined,
      location: { '@type':'Place', name: ev.venue || 'RIST Campus' },
      organizer: { '@type':'CollegeOrUniversity', name:'Regent Institute of Science & Technology', url: base },
      url: ev.detailsURL || (base + '/#events')
    }));
    const data = { '@context':'https://schema.org', '@graph': graph };
    const s = document.createElement('script'); s.type='application/ld+json'; s.textContent = JSON.stringify(data);
    document.head.appendChild(s);
  }

  /* ---------- Faculty ---------- */
  function normalizeFaculty(r) {
    const val = (...keys) => { for (const k of keys) { if (r[k] !== undefined && String(r[k]).trim() !== '') return r[k]; } return ''; };
    const name = val('Name','Full Name','Faculty Name','Faculty');
    const title = val('Title','Designation','Position');
    const department = val('Department','Dept','Dept.');
    const email = val('Email','Mail','E-mail');
    const linkedin = val('LinkedIn','Linkedin','Linked In','Linked_in','Profile');
    const photo = val('PhotoURL','Photo','Image','Picture','Avatar');
    const tagsStr = val('Tags','Skills','Expertise','Areas');
    const order = Number(val('Order','Sort','Rank') || 9999);
    const featured = String(val('Featured','Star','Highlight','IsFeatured') || '').toUpperCase() === 'TRUE';
    const slugExp = val('Slug');
    const bio = val('Bio','About','Summary');
    const slug = slugExp || (name ? name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'') : '');
    const tags = String(tagsStr || '').split(',').map(s=>s.trim()).filter(Boolean);
    return { name, title, department, email, linkedin, photo, tags, order, featured, slug, bio };
  }
  async function fetchFaculty() {
    try {
      const rows = await getRows(CONFIG.TABS.faculty, 'faculty');
      const data = rows.map(normalizeFaculty).sort((a,b) => {
        if (a.featured !== b.featured) return a.featured ? -1 : 1;
        if (a.order !== b.order) return a.order - b.order;
        return (a.name||'').localeCompare(b.name||'');
      });
      return data;
    } catch (e) {
      console.error('fetchFaculty failed. Check SHEET_ID, sharing, tab name.', {
        sheetId: CONFIG.SHEET_ID,
        url: osUrl(CONFIG.TABS.faculty)
      }, e);
      throw e;
    }
  }
  function renderFaculty(containerId, list, opts = {}) {
    const { linkToProfile = false } = opts;
    const grid = document.getElementById(containerId);
    if (!grid) return;
    grid.innerHTML = '';
    if (!list.length) {
      const empty = document.createElement('div');
      empty.className = 'card';
      empty.style.cssText = 'padding:14px 16px; text-align:center; color:var(--muted)';
      empty.textContent = 'No faculty to show.';
      grid.appendChild(empty); return;
    }
    list.forEach(f => {
      const card = document.createElement('article');
      card.className = 'card faculty-card reveal';
      const avatar = document.createElement('div'); avatar.className = 'avatar';
      if (f.photo) {
        const img = document.createElement('img'); img.loading='lazy'; img.alt = f.name || 'Faculty'; img.src = f.photo;
        img.onerror = () => { avatar.innerHTML=''; const fb=document.createElement('div'); fb.className='avatar-fallback'; fb.textContent = (f.name||'?').split(' ').map(s=>s[0]).slice(0,2).join('').toUpperCase(); avatar.appendChild(fb); };
        avatar.appendChild(img);
      } else {
        const fb=document.createElement('div'); fb.className='avatar-fallback'; fb.textContent = (f.name||'?').split(' ').map(s=>s[0]).slice(0,2).join('').toUpperCase(); avatar.appendChild(fb);
      }
      const body = document.createElement('div'); body.className='body';
      const h3 = document.createElement('h3'); h3.className='title'; h3.textContent = f.name || 'Faculty';
      const meta = document.createElement('p'); meta.className='meta'; meta.textContent = [f.title, f.department].filter(Boolean).join(', ');
      const tagsWrap = document.createElement('div'); (f.tags||[]).slice(0,6).forEach(t=>{ const tag=document.createElement('span'); tag.className='tag'; tag.textContent=t; tagsWrap.appendChild(tag); });
      const links = document.createElement('div'); links.className='faculty-links';
      if (f.email) { const a=document.createElement('a'); a.className='icon-btn'; a.href=`mailto:${f.email}`; a.textContent='✉️'; links.appendChild(a); }
      if (f.linkedin) { const a=document.createElement('a'); a.className='icon-btn'; a.href=f.linkedin; a.target='_blank'; a.rel='noopener'; a.textContent='in'; links.appendChild(a); }
      body.append(h3, meta, tagsWrap, links);

      if (linkToProfile && f.slug) {
        const profileUrl = `faculty-profile.html?slug=${encodeURIComponent(f.slug)}`;
        const linkName = document.createElement('a'); linkName.href = profileUrl; linkName.setAttribute('aria-label', `View profile of ${f.name}`); linkName.append(...h3.childNodes); h3.appendChild(linkName);
        const linkAvatar = document.createElement('a'); linkAvatar.href = profileUrl; linkAvatar.setAttribute('aria-label', `View profile of ${f.name}`); linkAvatar.append(...avatar.childNodes); avatar.innerHTML=''; avatar.appendChild(linkAvatar);
      }

      card.append(avatar, body);
      grid.appendChild(card);
      if (window.io) window.io.observe(card); else card.classList.add('visible');
    });
  }
  function injectPersonJsonLd(person) {
    const base = (location.origin || 'https://example.com');
    const data = {
      '@context': 'https://schema.org',
      '@type': 'Person',
      name: person.name,
      jobTitle: person.title || undefined,
      image: person.photo || undefined,
      email: person.email ? `mailto:${person.email}` : undefined,
      url: location.href,
      worksFor: { '@type': 'CollegeOrUniversity', name: 'Regent Institute of Science & Technology', url: base },
      affiliation: person.department || undefined,
      sameAs: person.linkedin ? [person.linkedin] : undefined
    };
    const s = document.createElement('script'); s.type='application/ld+json'; s.textContent = JSON.stringify(data);
    document.head.appendChild(s);
  }

  return {
    config: CONFIG,
    // Fetch
    fetchNotices, fetchEvents, fetchFaculty,
    // Render
    renderNotices, renderEvents, renderFaculty,
    // Filters & SEO
    setupEventsFilters, injectEventJsonLd, injectPersonJsonLd
  };
})();