// MotoMonitor admin page. Reads riders' data with the admin's own login (database rules allow admins to READ);
// every change goes through the admin-users Edge Function, which checks the admin role on the server.
// All rider data is inserted as text (never as HTML), so nothing a rider types can run on this page.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './config.js';

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'motomonitor-admin-auth' },
});

const app = document.getElementById('app');
const whoEl = document.getElementById('who');
const logoutBtn = document.getElementById('logout');
const toastEl = document.getElementById('toast');

/** @type {{ id: string, email: string } | null} */
let me = null;

// ── Helpers ──

/** Build an element. Strings become text nodes, so data is never parsed as HTML. */
function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

function show(...nodes) {
  app.replaceChildren(...nodes.flat());
  window.scrollTo(0, 0);
}

let toastTimer;
function toast(message, kind = 'ok') {
  toastEl.textContent = message;
  toastEl.className = `toast ${kind === 'error' ? 'error' : ''}`;
  toastEl.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastEl.hidden = true), kind === 'error' ? 7000 : 4000);
}

const dateFmt = new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium' });
const dateTimeFmt = new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium', timeStyle: 'short' });
const fmtDate = (v) => (v ? dateFmt.format(new Date(v)) : '—');
const fmtDateTime = (v) => (v ? dateTimeFmt.format(new Date(v)) : 'Never');
const fmtNum = (n) => Number(n ?? 0).toLocaleString('en-PH');
const fmtMoney = (n) => (n === null || n === undefined ? '—' : `₱${fmtNum(n)}`);

const STATUS = {
  active: ['Active', 'ok'],
  pending_first_login: ['Pending first login', 'warn'],
  must_change_password: ['Must change password', 'warn'],
  temp_expired: ['Temp password expired', 'danger'],
  disabled: ['Disabled', 'muted'],
};
function statusBadge(status) {
  const [label, kind] = STATUS[status] ?? [status, 'muted'];
  return h('span', { class: `badge ${kind}` }, label);
}

const ERRORS = {
  not_logged_in: 'Your login expired. Please log in again.',
  not_admin: 'This account is not an admin.',
  invalid_email: 'Enter a valid email address.',
  missing_name: 'Enter the rider’s full name.',
  invalid_username: 'Usernames are 3–20 characters: lowercase letters, numbers, dot or underscore.',
  username_taken: 'That username is already taken.',
  email_exists: 'An account with this email already exists.',
  cannot_target_self: 'You can’t do this to your own account.',
  not_found: 'That account no longer exists.',
  network: 'Can’t reach the server. Check your internet connection.',
};

/** Call the admin-users Edge Function. Throws an Error with a readable message. */
async function adminAction(body) {
  const { data, error } = await sb.functions.invoke('admin-users', { body });
  if (!error) return data;
  let code = 'network';
  try {
    code = (await error.context.json()).error ?? 'unknown';
  } catch {
    /* no JSON body: network or gateway error */
  }
  throw new Error(ERRORS[code] ?? `Something went wrong (${code}). Please try again.`);
}

function check(result) {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

// ── Overdue (same rule as the app's src/lib/status.ts) ──

function addMonths(iso, months) {
  const d = new Date(iso);
  const day = d.getDate();
  d.setMonth(d.getMonth() + Math.round(months));
  if (d.getDate() !== day) d.setDate(0);
  return d;
}

function isOverdue(bike, item, now = new Date()) {
  if (!item.enabled) return false;
  if (item.interval_km > 0 && Number(bike.odometer) - Number(item.last_km) >= Number(item.interval_km)) return true;
  if (item.interval_months > 0 && addMonths(item.last_date, item.interval_months) <= now) return true;
  return false;
}

// ── One-time temporary password dialog ──

function showTemporaryPassword({ heading, email, password, expiresAt }, onClose) {
  const secret = h('code', { class: 'secret', 'aria-label': 'Temporary password' }, password);
  const copyBtn = h('button', { class: 'btn btn-secondary btn-block', type: 'button' }, '📋 Copy password');
  const closeBtn = h('button', { class: 'btn btn-primary btn-block', type: 'button' }, 'I’ve sent it — close');
  const dlg = h(
    'dialog',
    { class: 'modal', 'aria-labelledby': 'pw-title' },
    h('h2', { id: 'pw-title' }, heading),
    h('p', null, 'Temporary password for ', h('strong', null, email), ':'),
    secret,
    copyBtn,
    h(
      'p',
      { class: 'warnbox' },
      'This is shown only once. Send it to the rider privately (e.g. a direct message), not in a group chat. ',
      `It works until ${fmtDateTime(expiresAt)}. The app will make them choose their own password when they log in.`,
    ),
    closeBtn,
  );

  let gone = false;
  const close = () => {
    if (gone) return;
    gone = true;
    secret.textContent = ''; // wipe it from the page
    clearTimeout(autoClose);
    if (dlg.open) dlg.close();
    dlg.remove();
    onClose?.();
  };
  const autoClose = setTimeout(close, 10 * 60 * 1000);

  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(secret.textContent);
      copyBtn.textContent = '✓ Copied';
    } catch {
      // Clipboard blocked (e.g. some in-app browsers): select it so the admin can copy by hand.
      const range = document.createRange();
      range.selectNodeContents(secret);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
      copyBtn.textContent = 'Selected — copy it manually';
    }
  });
  closeBtn.addEventListener('click', close);
  dlg.addEventListener('cancel', (e) => {
    e.preventDefault(); // Esc: make them confirm with the button
  });
  document.body.append(dlg);
  dlg.showModal();
}

// ── Views ──

function loginView(message) {
  whoEl.textContent = '';
  logoutBtn.hidden = true;
  const email = h('input', { id: 'email', type: 'email', autocomplete: 'username', required: true });
  const password = h('input', { id: 'password', type: 'password', autocomplete: 'current-password', required: true });
  const err = h('p', { class: 'error', hidden: !message }, message ?? '');
  const submit = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, 'Log in');
  const form = h(
    'form',
    {
      class: 'card',
      onsubmit: async (e) => {
        e.preventDefault();
        submit.disabled = true;
        err.hidden = true;
        const { error } = await sb.auth.signInWithPassword({ email: email.value.trim(), password: password.value });
        password.value = '';
        submit.disabled = false;
        if (error) {
          err.textContent = error.message.includes('Invalid login') ? 'Wrong email or password.' : error.message;
          err.hidden = false;
          return;
        }
        route();
      },
    },
    h('h1', null, 'Admin log in'),
    h('p', { class: 'muted small' }, 'Use your MotoMonitor account. Only accounts with the admin role can open this page.'),
    h('div', { class: 'field' }, h('label', { for: 'email' }, 'Email'), email),
    h('div', { class: 'field' }, h('label', { for: 'password' }, 'Password'), password),
    err,
    submit,
  );
  show(h('div', { class: 'narrow' }, form));
  email.focus();
}

async function dashboardView() {
  show(h('p', { class: 'muted' }, 'Loading…'));
  const [statsRows, riders, socialRows] = await Promise.all([
    sb.rpc('admin_stats').then(check),
    sb.rpc('admin_list_riders').then(check),
    sb.rpc('admin_social_stats').then(check),
  ]);
  const stats = statsRows[0] ?? {};
  const social = socialRows[0] ?? {};

  const stat = (num, label, alert) => h('div', { class: `stat ${alert ? 'alert' : ''}` }, h('div', { class: 'num' }, fmtNum(num)), h('div', { class: 'label' }, label));

  const tbody = h('tbody');
  const search = h('input', { type: 'search', class: 'search', placeholder: 'Search name, username or email', 'aria-label': 'Search riders' });
  const renderRows = () => {
    const q = search.value.trim().toLowerCase();
    const list = riders.filter((r) => !q || [r.full_name, r.username, r.email].some((v) => (v ?? '').toLowerCase().includes(q)));
    tbody.replaceChildren(
      ...(list.length
        ? list.map((r) =>
            h(
              'tr',
              { class: 'clickable', tabindex: '0', onclick: () => (location.hash = `#/rider/${r.id}`), onkeydown: (e) => e.key === 'Enter' && (location.hash = `#/rider/${r.id}`) },
              h(
                'td',
                { class: 'primary', 'data-label': 'Rider' },
                r.full_name || '(no name)',
                r.role === 'admin' ? [' ', h('span', { class: 'badge admin' }, 'Admin')] : null,
                h('span', { class: 'cell-sub' }, [r.username ? `@${r.username} · ` : '', r.email]),
              ),
              h('td', { 'data-label': 'Status' }, statusBadge(r.status)),
              h('td', { 'data-label': 'Signed up' }, fmtDate(r.signed_up_at)),
              h('td', { 'data-label': 'Last login' }, fmtDateTime(r.last_sign_in_at)),
              h('td', { class: 'num', 'data-label': 'Bikes' }, fmtNum(r.bikes)),
              h('td', { class: 'num', 'data-label': 'Service logs' }, fmtNum(r.service_logs)),
            ),
          )
        : [h('tr', null, h('td', { colspan: '6', class: 'muted center' }, 'No riders found.'))]),
    );
  };
  search.addEventListener('input', renderRows);
  renderRows();

  show(
    h('div', { class: 'row spread' }, h('h1', null, 'Dashboard'), h('a', { class: 'btn btn-primary', href: '#/create' }, '＋ Create user')),
    h(
      'section',
      { class: 'stats', 'aria-label': 'Totals' },
      stat(stats.riders, 'Riders'),
      stat(stats.bikes, 'Motorcycles'),
      stat(stats.service_logs_this_month, 'Service logs this month'),
      stat(stats.items_overdue, 'Items overdue', Number(stats.items_overdue) > 0),
      stat(social.friendships, 'Friendships'),
    ),
    h(
      'section',
      { class: 'card' },
      h('div', { class: 'row spread' }, h('h2', null, `Accounts (${riders.length})`), search),
      h(
        'table',
        { class: 'table' },
        h('thead', null, h('tr', null, ['Rider', 'Status', 'Signed up', 'Last login', 'Bikes', 'Service logs'].map((t, i) => h('th', { class: i > 3 ? 'num' : null }, t)))),
        tbody,
      ),
    ),
  );
}

async function riderView(id) {
  show(h('p', { class: 'muted' }, 'Loading…'));
  const [riders, bikes, items, logs, clubs, socialRows] = await Promise.all([
    sb.rpc('admin_list_riders').then(check),
    sb.from('bikes').select('*').eq('user_id', id).eq('deleted', false).order('created_at').then(check),
    sb.from('maint_items').select('*').eq('user_id', id).eq('deleted', false).then(check),
    sb.from('service_logs').select('*').eq('user_id', id).eq('deleted', false).order('date', { ascending: false }).limit(100).then(check),
    sb.from('clubs').select('*').eq('user_id', id).eq('deleted', false).order('name').then(check),
    // Counts only: the admin page never shows who a rider's friends are.
    sb.rpc('admin_rider_social', { p_id: id }).then(check),
  ]);
  const social = socialRows[0] ?? {};
  const r = riders.find((x) => x.id === id);
  if (!r) {
    show(h('a', { href: '#/' }, '← Back'), h('p', { class: 'card' }, 'This account no longer exists.'));
    return;
  }
  const self = r.id === me.id;
  const bikeName = Object.fromEntries(bikes.map((b) => [b.id, b.name]));

  const busy = (btn, fn) => async () => {
    btn.disabled = true;
    try {
      await fn();
    } catch (e) {
      toast(e.message, 'error');
    } finally {
      btn.disabled = false;
    }
  };

  const resetBtn = h('button', { class: 'btn btn-secondary', type: 'button', disabled: self }, '🔑 Reset temporary password');
  resetBtn.addEventListener(
    'click',
    busy(resetBtn, async () => {
      if (!confirm(`Make a new temporary password for ${r.email}?\n\nTheir current password stops working, and the app will make them set a new one.`)) return;
      const res = await adminAction({ action: 'reset_temp_password', user_id: r.id });
      showTemporaryPassword({ heading: 'New temporary password', email: r.email, password: res.temporary_password, expiresAt: res.expires_at }, () => riderView(id));
      res.temporary_password = undefined;
    }),
  );

  const emailBtn = h('button', { class: 'btn btn-secondary', type: 'button' }, '✉️ Email a reset code');
  emailBtn.addEventListener(
    'click',
    busy(emailBtn, async () => {
      if (!confirm(`Email ${r.email} a code to set a new password?\n\nThey enter it in the app under Log in → Forgot password.`)) return;
      const { error } = await sb.auth.resetPasswordForEmail(r.email);
      if (error) throw new Error(error.message);
      toast(`Reset code sent to ${r.email}.`);
    }),
  );

  const toggleBtn = h('button', { class: `btn ${r.disabled ? 'btn-secondary' : 'btn-danger'}`, type: 'button', disabled: self }, r.disabled ? '✅ Enable account' : '⛔ Disable account');
  toggleBtn.addEventListener(
    'click',
    busy(toggleBtn, async () => {
      const msg = r.disabled
        ? `Enable ${r.email}? They will be able to log in again.`
        : `Disable ${r.email}?\n\nThey can’t log in or sync. Their data is kept, and you can enable them again later.`;
      if (!confirm(msg)) return;
      await adminAction({ action: r.disabled ? 'enable' : 'disable', user_id: r.id });
      toast(r.disabled ? 'Account enabled.' : 'Account disabled.');
      riderView(id);
    }),
  );

  const bikeCards = bikes.map((b) => {
    const its = items.filter((i) => i.bike_id === b.id);
    const overdue = its.filter((i) => isOverdue(b, i));
    return h(
      'li',
      null,
      h('div', { class: 'row spread' }, h('strong', null, `🏍️ ${b.name || '(unnamed)'}`), overdue.length ? h('span', { class: 'badge danger' }, `${overdue.length} overdue`) : h('span', { class: 'badge ok' }, 'Up to date')),
      h('span', { class: 'cell-sub' }, [b.make, b.model, b.year].filter(Boolean).join(' ') || b.type, b.plate ? ` · ${b.plate}` : '', ` · ${fmtNum(b.odometer)} km`),
      overdue.length ? h('span', { class: 'cell-sub' }, `Overdue: ${overdue.map((i) => i.name).join(', ')}`) : null,
      h('span', { class: 'cell-sub' }, `Tracking ${its.filter((i) => i.enabled).length} of ${its.length} maintenance items`),
    );
  });

  show(
    h('a', { href: '#/' }, '← All riders'),
    h(
      'section',
      { class: 'card' },
      h('div', { class: 'row spread' }, h('h1', null, r.full_name || '(no name)'), h('div', { class: 'row' }, r.role === 'admin' ? h('span', { class: 'badge admin' }, 'Admin') : null, statusBadge(r.status))),
      h(
        'dl',
        { class: 'facts' },
        h('dt', null, 'Email'), h('dd', null, r.email, r.email_confirmed ? '' : ' (not confirmed)'),
        h('dt', null, 'Username'), h('dd', null, r.username ? `@${r.username}` : '—'),
        h('dt', null, 'Signed up'), h('dd', null, fmtDateTime(r.signed_up_at)),
        h('dt', null, 'Last login'), h('dd', null, fmtDateTime(r.last_sign_in_at)),
        h('dt', null, 'Friends'), h('dd', null, `${fmtNum(social.friends)} · Pending: ${fmtNum(social.incoming)} received, ${fmtNum(social.outgoing)} sent`),
        r.must_change_password ? [h('dt', null, 'Temp password'), h('dd', null, `expires ${fmtDateTime(r.temp_password_expires_at)}`)] : null,
      ),
      self
        ? h('p', { class: 'muted small' }, 'This is your own account. Change your password in the app.')
        : h('div', { class: 'row' }, resetBtn, emailBtn, toggleBtn),
      r.status === 'temp_expired' ? h('p', { class: 'warnbox' }, 'The temporary password expired before they logged in. Use “Reset temporary password” to make a new one.') : null,
    ),
    h(
      'div',
      { class: 'grid-2' },
      h('section', { class: 'card' }, h('h2', null, `Motorcycles (${bikes.length})`), bikes.length ? h('ul', { class: 'list' }, bikeCards) : h('p', { class: 'muted' }, 'None yet.')),
      h(
        'section',
        { class: 'card' },
        h('h2', null, `Clubs (${clubs.length})`),
        clubs.length
          ? h('ul', { class: 'list' }, clubs.map((c) => h('li', null, h('strong', null, `🛡️ ${c.name}`), h('span', { class: 'cell-sub' }, [c.role, c.since && `since ${c.since}`].filter(Boolean).join(' · ') || '—'))))
          : h('p', { class: 'muted' }, 'None.'),
      ),
    ),
    h(
      'section',
      { class: 'card' },
      h('h2', null, `Service logs (${logs.length}${logs.length === 100 ? ', latest 100' : ''})`),
      logs.length
        ? h(
            'table',
            { class: 'table' },
            h('thead', null, h('tr', null, ['Date', 'Motorcycle', 'Odometer', 'Work done', 'Cost', 'Shop'].map((t) => h('th', null, t)))),
            h(
              'tbody',
              null,
              logs.map((l) =>
                h(
                  'tr',
                  null,
                  h('td', { class: 'primary', 'data-label': 'Date' }, fmtDate(l.date)),
                  h('td', { 'data-label': 'Motorcycle' }, bikeName[l.bike_id] ?? '(deleted bike)'),
                  h('td', { 'data-label': 'Odometer' }, `${fmtNum(l.km)} km`),
                  h('td', { 'data-label': 'Work done' }, (l.item_names ?? []).join(', ') || '—'),
                  h('td', { 'data-label': 'Cost' }, fmtMoney(l.cost)),
                  h('td', { 'data-label': 'Shop' }, l.shop || '—'),
                ),
              ),
            ),
          )
        : h('p', { class: 'muted' }, 'No service logs yet.'),
    ),
  );
}

function createView() {
  const email = h('input', { id: 'c-email', type: 'email', required: true, autocomplete: 'off' });
  const name = h('input', { id: 'c-name', type: 'text', required: true, maxlength: '100', autocomplete: 'off' });
  const username = h('input', { id: 'c-username', type: 'text', maxlength: '20', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', pattern: '[a-z0-9_.]{3,20}' });
  const role = h('select', { id: 'c-role' }, h('option', { value: 'rider' }, 'Rider'), h('option', { value: 'admin' }, 'Admin'));
  const submit = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, 'Create account');
  const form = h(
    'form',
    {
      class: 'card',
      onsubmit: async (e) => {
        e.preventDefault();
        if (role.value === 'admin' && !confirm('Give this account ADMIN access? Admins can see every rider’s data.')) return;
        submit.disabled = true;
        try {
          const res = await adminAction({
            action: 'create',
            email: email.value.trim(),
            full_name: name.value.trim(),
            username: username.value.trim().toLowerCase() || undefined,
            role: role.value,
          });
          form.reset();
          const userId = res.user_id;
          showTemporaryPassword({ heading: 'Account created', email: res.email, password: res.temporary_password, expiresAt: res.expires_at }, () => (location.hash = `#/rider/${userId}`));
          res.temporary_password = undefined;
        } catch (err) {
          toast(err.message, 'error');
        } finally {
          submit.disabled = false;
        }
      },
    },
    h('h1', null, 'Create user'),
    h('p', { class: 'muted small' }, 'A strong temporary password is made on the server and shown to you once. The rider must change it the first time they log in. It expires after 7 days.'),
    h('div', { class: 'field' }, h('label', { for: 'c-email' }, 'Email'), email),
    h('div', { class: 'field' }, h('label', { for: 'c-name' }, 'Full name'), name),
    h('div', { class: 'field' }, h('label', { for: 'c-username' }, 'Username (optional)'), username, h('p', { class: 'hint' }, '3–20 characters: lowercase letters, numbers, dot or underscore. They can log in with it instead of their email.')),
    h('div', { class: 'field' }, h('label', { for: 'c-role' }, 'Role'), role),
    submit,
  );
  show(h('a', { href: '#/' }, '← All riders'), h('div', { class: 'medium' }, form));
  email.focus();
}

// ── Routing ──

async function loadMe() {
  const {
    data: { session },
  } = await sb.auth.getSession();
  if (!session) return null;
  const { data, error } = await sb.from('profiles').select('role, disabled').eq('id', session.user.id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || data.role !== 'admin' || data.disabled) {
    await sb.auth.signOut();
    return { notAdmin: true };
  }
  return { id: session.user.id, email: session.user.email };
}

async function route() {
  try {
    if (!me) {
      const result = await loadMe();
      if (!result) return loginView();
      if (result.notAdmin) return loginView('This account is not an admin.');
      me = result;
    }
    whoEl.textContent = me.email;
    logoutBtn.hidden = false;

    const hash = location.hash || '#/';
    const rider = hash.match(/^#\/rider\/([0-9a-f-]{36})$/i);
    if (rider) await riderView(rider[1]);
    else if (hash === '#/create') createView();
    else await dashboardView();
  } catch (e) {
    show(h('div', { class: 'card' }, h('p', { class: 'error' }, 'Could not load this page.'), h('p', { class: 'muted small' }, e.message), h('button', { class: 'btn btn-secondary', type: 'button', onclick: route }, 'Try again')));
  }
}

logoutBtn.addEventListener('click', async () => {
  me = null;
  await sb.auth.signOut();
  location.hash = '#/';
  loginView();
});

sb.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT' && me) {
    me = null;
    loginView('You were logged out.');
  }
});

window.addEventListener('hashchange', route);
route();
