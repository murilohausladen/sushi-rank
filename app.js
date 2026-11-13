(function () {
  'use strict';

  // Chave pública (anon) do projeto Supabase. Ela só abre o que as regras do banco permitem.
  var SB_URL = 'https://dlebcpvkycdhpnyhmbhm.supabase.co';
  var SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRsZWJjcHZreWNkaHBueWhtYmhtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ2MDIzNjMsImV4cCI6MjExMDE3ODM2M30.m3lf66BNOLZz-iI7Iw6n4yeL2_cCNqZqoLvCYh5UKxs';

  var $ = function (s) { return document.querySelector(s); };
  function h(tag, attrs) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (k === 'class') e.className = v;
      else if (k === 'style') e.style.cssText = v;
      else e.setAttribute(k, v);
    });
    for (var i = 2; i < arguments.length; i++) {
      [].concat(arguments[i]).forEach(function (c) {
        if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
      });
    }
    return e;
  }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) {} }

  var sb = null;
  var cred = null;
  try { cred = JSON.parse(lsGet('sushi.cred') || 'null'); } catch (e) { cred = null; }
  var hostPin = lsGet('sushi.pin') || '';
  var isHost = false, showPin = false, confirmEnd = false, hostSig = '', removingId = null;

  var players = [], game = { status: 'live' };
  var loaded = false, failed = false, online = true;
  var myCount = 0, dirty = false, inFlight = false, timer = null;
  var editing = false, spectating = false;
  var photoData = '';
  var stageSig = '', confettiDone = false;

  var PAL = ['#ff6b57', '#f2b134', '#8fc13d', '#6fc3df', '#c39bf2', '#f59ac0'];
  function hash(s) { var x = 0; for (var i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) >>> 0; return x; }
  function dn(p) { return p.nick || p.name || 'Sem nome'; }
  function okPhoto(s) { return typeof s === 'string' && s.indexOf('data:image/jpeg;base64,') === 0 && s.length < 60000; }
  function myId() { return cred ? cred.id : null; }
  function mine() { var id = myId(); return id ? players.find(function (p) { return p.id === id; }) : null; }
  function norm(r) {
    return { id: r.id, name: r.name || '', nick: r.nick || '', photo: r.photo || '', count: r.pieces | 0, joinedAt: Date.parse(r.joined_at) || 0 };
  }

  function avatar(p, size) {
    var a = h('div', { class: 'avatar', style: '--s:' + size + 'px;--c:' + PAL[hash(p.id || 'x') % PAL.length] });
    if (okPhoto(p.photo)) a.append(h('img', { src: p.photo, alt: '' }));
    else a.textContent = (dn(p).charAt(0) || '?').toUpperCase();
    return a;
  }

  function ranked() {
    var id = myId();
    var list = players.map(function (p) {
      var c = (p.id === id && (dirty || inFlight)) ? myCount : p.count;
      return Object.assign({}, p, { count: c });
    });
    list.sort(function (a, b) {
      return b.count - a.count || a.joinedAt - b.joinedAt || a.id.localeCompare(b.id);
    });
    list.forEach(function (p, i) { p.rank = (i > 0 && p.count === list[i - 1].count) ? list[i - 1].rank : i + 1; });
    return list;
  }

  function rowEl(p, max, isMe, removable) {
    var w = max > 0 ? Math.max(4, Math.round(p.count / max * 100)) : 0;
    var asking = removable && removingId === p.id;
    var who = asking
      ? h('div', { class: 'who' }, h('strong', null, 'Remover da mesa?'), h('small', null, dn(p)))
      : h('div', { class: 'who' }, h('strong', null, dn(p)), (p.nick && p.name) ? h('small', null, p.name) : null);
    var end = h('div', { class: 'end' });
    if (asking) {
      var yes = h('button', { class: 'mini danger', type: 'button', 'aria-label': 'Confirmar remoção de ' + dn(p) }, 'Sim');
      yes.addEventListener('click', function () { removePlayer(p.id); });
      var no = h('button', { class: 'mini', type: 'button' }, 'Não');
      no.addEventListener('click', function () { removingId = null; render(); });
      end.append(yes, no);
    } else {
      end.append(h('span', { class: 'num' }, String(p.count)));
      if (removable) {
        var x = h('button', { class: 'mini x', type: 'button', 'aria-label': 'Remover ' + dn(p) }, '×');
        x.addEventListener('click', function () { removingId = p.id; render(); });
        end.append(x);
      }
    }
    return h('li', { class: 'row' + (isMe ? ' me' : ''), style: '--w:' + w + '%' },
      h('span', { class: 'badge r' + Math.min(p.rank, 4) }, max > 0 ? p.rank + 'º' : '·'),
      avatar(p, 40),
      who,
      end
    );
  }

  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.hidden = true; }, 3800);
  }
  function note(msg) { var n = $('#note'); n.textContent = msg || ''; n.hidden = !msg; }

  function errText(e) { return String((e && (e.message || e.details)) || e || ''); }

  /* ---------- render ---------- */
  function render() {
    var ready = loaded;
    var ended = game.status === 'ended';
    var me = mine();
    var list = ranked();
    var total = list.reduce(function (s, p) { return s + p.count; }, 0);
    var totalTxt = total + (total === 1 ? ' peça' : ' peças') + ' na mesa · ' + list.length + (list.length === 1 ? ' pessoa' : ' pessoas');

    var pill = $('#pill'), pt = $('#pill-text');
    if (failed) { pill.className = 'pill off'; pt.textContent = 'Sem conexão'; }
    else if (!ready) { pill.className = 'pill'; pt.textContent = 'Conectando'; }
    else if (!online) { pill.className = 'pill off'; pt.textContent = 'Reconectando'; }
    else { pill.className = 'pill ' + (ended ? 'ended' : 'live'); pt.textContent = ended ? 'Encerrada' : 'Ao vivo'; }

    var showJoin = ready && !ended && (editing || (!me && !spectating));
    var showStage = ready && ended;
    var showPlay = ready && !ended && !showJoin;

    $('#loading').hidden = ready || failed;
    $('#join').hidden = !showJoin;
    $('#play').hidden = !showPlay;
    $('#stage').hidden = !showStage;

    if (showPlay && !me) note('Você está só acompanhando. Toque em "Editar perfil" depois de entrar para contar peças.');
    else if (!failed) note('');

    if (showPlay) {
      $('#counter').hidden = !me;
      if (me) {
        var meR = list.find(function (p) { return p.id === me.id; });
        $('#me-avatar').replaceChildren(avatar(me, 48));
        $('#me-name').textContent = dn(me);
        $('#me-sub').textContent = (me.nick && me.name) ? me.name : '';
        $('#my-count').textContent = String(meR.count);
        var tied = list.filter(function (p) { return p.rank === meR.rank; }).length > 1;
        $('#my-pos').textContent = meR.count === 0 ? 'Ainda sem peças. Bora começar.'
          : (tied ? 'Empatado em ' : 'Você está em ') + meR.rank + 'º' + (tied ? '' : ' lugar');
      }
      var max = list.length ? list[0].count : 0;
      var rows = $('#rows'); rows.replaceChildren();
      if (!list.length) rows.append(h('li', { class: 'empty' }, 'Ninguém entrou ainda. Quem entrar primeiro aparece aqui.'));
      list.forEach(function (p) { rows.append(rowEl(p, max, p.id === myId(), isHost)); });
      $('#total').textContent = totalTxt;
      renderHost();
    }
    if (showStage) renderStage(list, totalTxt);
  }

  function renderHost() {
    var sig = [isHost, showPin, confirmEnd].join('|');
    if (sig === hostSig) return;
    hostSig = sig;
    var box = $('#host'); box.replaceChildren();
    if (!isHost && !showPin) {
      box.className = 'hostlink';
      box.append(h('button', { class: 'link', type: 'button', id: 'host-open' }, 'Sou o anfitrião'));
      $('#host-open').addEventListener('click', function () { showPin = true; renderHost(); var i = $('#pin'); if (i) i.focus(); });
      return;
    }
    box.className = 'card host';
    if (!isHost) {
      box.append(h('p', { class: 'eyebrow' }, 'Anfitrião'), h('p', null, 'Digite o PIN do anfitrião.'));
      var form = h('form', { class: 'pinrow', id: 'pin-form', autocomplete: 'off' },
        h('input', { id: 'pin', type: 'password', maxlength: '16', 'aria-label': 'PIN do anfitrião', autocapitalize: 'characters', autocomplete: 'off' }),
        h('button', { class: 'btn primary', type: 'submit' }, 'Entrar'),
        h('button', { class: 'btn ghost', type: 'button', id: 'pin-cancel' }, 'Cancelar'));
      box.append(form);
      form.addEventListener('submit', async function (e) {
        e.preventDefault();
        var pin = $('#pin').value.trim().toUpperCase();
        if (!pin) return;
        if (await verifyPin(pin)) { hostPin = pin; lsSet('sushi.pin', pin); isHost = true; showPin = false; render(); }
        else toast('PIN incorreto.');
      });
      $('#pin-cancel').addEventListener('click', function () { showPin = false; renderHost(); });
      return;
    }
    box.append(h('p', { class: 'eyebrow' }, 'Anfitrião'));
    var txt = h('p', null, confirmEnd ? 'Encerrar para todos e mostrar o pódio?' : 'Quando a mesa acabar, encerre a contagem. Todo mundo vê o pódio no celular.');
    var acts = h('div', { class: 'actions' });
    if (!confirmEnd) {
      acts.append(h('button', { class: 'btn danger', type: 'button', id: 'end-btn' }, 'Encerrar contagem'));
    } else {
      acts.append(h('button', { class: 'btn danger', type: 'button', id: 'end-yes' }, 'Sim, encerrar'), h('button', { class: 'btn ghost', type: 'button', id: 'end-no' }, 'Voltar'));
    }
    box.append(txt, acts);
    if (!confirmEnd) $('#end-btn').addEventListener('click', function () { confirmEnd = true; renderHost(); });
    else {
      $('#end-yes').addEventListener('click', function () { confirmEnd = false; setGame('ended'); renderHost(); });
      $('#end-no').addEventListener('click', function () { confirmEnd = false; renderHost(); });
    }
  }

  function renderStage(list, totalTxt) {
    $('#stage-total').textContent = totalTxt;
    var top = list.slice(0, 3);
    var sig = top.map(function (p) { return p.id + ':' + p.count + ':' + p.rank + ':' + p.photo.length + ':' + dn(p); }).join('|');
    if (sig !== stageSig) {
      stageSig = sig;
      var pod = $('#podium'); pod.replaceChildren();
      var order = [top[1], top[0], top[2]].filter(Boolean);
      var colors = { 1: 'var(--salmon)', 2: 'var(--tamago)', 3: 'var(--wasabi)' };
      var heights = { 1: 190, 2: 140, 3: 104 };
      var d1 = { 1: 2.4, 2: 1.2, 3: 0.2 };
      order.forEach(function (p) {
        var r = Math.min(p.rank, 3);
        var crown = null;
        if (p.rank === 1 && p.count > 0) {
          crown = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          crown.setAttribute('class', 'crown'); crown.setAttribute('viewBox', '0 0 34 24'); crown.setAttribute('aria-hidden', 'true');
          var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
          path.setAttribute('d', 'M3 20 L1 5 L10 12 L17 2 L24 12 L33 5 L31 20 Z'); path.setAttribute('fill', '#f2b134');
          crown.append(path);
        }
        pod.append(h('div', { class: 'slot' },
          h('div', { class: 'who', style: '--d2:' + (d1[r] + 0.7) + 's' }, crown, avatar(p, r === 1 ? 76 : 60), h('strong', null, dn(p))),
          h('div', { class: 'block', style: '--h:' + heights[r] + 'px;--bc:' + colors[r] + ';--d1:' + d1[r] + 's' },
            h('span', { class: 'pos-n' }, p.rank + 'º'),
            h('span', { class: 'score' }, p.count + (p.count === 1 ? ' peça' : ' peças')))
        ));
      });
      if (!top.length) pod.append(h('p', { class: 'mine' }, 'Ninguém entrou na contagem desta vez.'));
      var win = top[0], wl = $('#winner-line');
      wl.replaceChildren();
      if (win && win.count > 0) wl.append('Vitória de ', h('b', null, dn(win)), ' com ' + win.count + (win.count === 1 ? ' peça.' : ' peças.'));
      if (!confettiDone && win && win.count > 0) { confettiDone = true; setTimeout(confetti, 2400); }
    }
    var meR = list.find(function (p) { return p.id === myId(); });
    $('#stage-mine').textContent = meR ? ('Você ficou em ' + meR.rank + 'º com ' + meR.count + (meR.count === 1 ? ' peça.' : ' peças.')) : '';
    var rest = list.slice(3);
    $('#stage-rest').hidden = !rest.length;
    var rr = $('#rest-rows'); rr.replaceChildren();
    var max = list.length ? list[0].count : 0;
    rest.forEach(function (p) { rr.append(rowEl(p, max, p.id === myId())); });
    $('#stage-host').hidden = !isHost;
  }

  /* ---------- data ---------- */
  async function loadAll() {
    try {
      var res = await Promise.all([
        sb.from('players').select('id,name,nick,photo,pieces,joined_at').order('joined_at', { ascending: true }),
        sb.from('game').select('status').eq('id', 1).single()
      ]);
      if (res[0].error) throw res[0].error;
      if (res[1].error) throw res[1].error;
      players = res[0].data.map(norm);
      game = { status: res[1].data.status === 'ended' ? 'ended' : 'live' };
      loaded = true; failed = false; online = true;
      // perfil guardado neste aparelho que não existe mais no banco: entra de novo
      if (cred && !(cred.t && Date.now() - cred.t < 8000) && !mine()) { cred = null; lsDel('sushi.cred'); myCount = 0; }
      syncMine();
    } catch (e) {
      if (loaded) online = false; else failed = true;
    }
    render();
  }
  function syncMine() {
    var m = mine();
    if (m && !dirty && !inFlight) myCount = m.count;
  }
  function applyChange(payload) {
    if (payload.eventType === 'DELETE') {
      var oid = payload.old && payload.old.id;
      players = players.filter(function (p) { return p.id !== oid; });
    } else if (payload['new']) {
      var n = norm(payload['new']);
      var i = players.findIndex(function (p) { return p.id === n.id; });
      if (i >= 0) players[i] = n; else players.push(n);
    }
    syncMine(); render();
  }

  function bump(d) {
    if (game.status === 'ended' || !mine()) return;
    var n = Math.max(0, Math.min(999, myCount + d));
    if (n === myCount) return;
    myCount = n; dirty = true;
    try { if (navigator.vibrate) navigator.vibrate(8); } catch (e) {}
    render();
    clearTimeout(timer);
    timer = setTimeout(flush, 250);
  }
  async function flush() {
    if (inFlight || !cred) return;
    inFlight = true;
    var v = myCount;
    var res = await sb.rpc('set_pieces', { p_id: cred.id, p_secret: cred.secret, p_pieces: v });
    inFlight = false;
    if (res.error) {
      dirty = false;
      var msg = errText(res.error);
      if (msg.indexOf('game_ended') >= 0) toast('A contagem foi encerrada.');
      else if (msg.indexOf('forbidden') >= 0) { cred = null; lsDel('sushi.cred'); toast('Seu perfil não foi encontrado. Entre de novo.'); }
      else toast('Não consegui salvar. Confira sua internet.');
      loadAll();
      return;
    }
    online = true;
    if (myCount !== v) { flush(); return; }
    dirty = false;
    var m = mine(); if (m) m.count = v;
    render();
  }

  async function verifyPin(pin) {
    var res = await sb.rpc('check_host', { p_pin: pin });
    return !res.error && res.data === true;
  }
  async function setGame(status) {
    var res = await sb.rpc('set_game_status', { p_pin: hostPin, p_status: status });
    if (res.error) {
      if (errText(res.error).indexOf('forbidden') >= 0) { isHost = false; hostPin = ''; lsDel('sushi.pin'); hostSig = ''; toast('PIN do anfitrião não vale mais.'); }
      else toast('Não consegui mudar o estado da contagem.');
      render(); return;
    }
    game = { status: status };
    if (status === 'live') { stageSig = ''; confettiDone = false; }
    render();
  }

  async function removePlayer(id) {
    removingId = null;
    var res = await sb.rpc('remove_player', { p_pin: hostPin, p_id: id });
    if (res.error) {
      if (errText(res.error).indexOf('forbidden') >= 0) { isHost = false; hostPin = ''; lsDel('sushi.pin'); hostSig = ''; toast('PIN do anfitrião não vale mais.'); }
      else toast('Não consegui remover. Tente de novo.');
      render(); return;
    }
    players = players.filter(function (p) { return p.id !== id; });
    toast('Removido da mesa.');
    render();
  }

  /* ---------- photo + form ---------- */
  function readPhoto(file) {
    return new Promise(function (resolve, reject) {
      function draw(src, w, hgt) {
        var S = 128, c = document.createElement('canvas'); c.width = S; c.height = S;
        var x = c.getContext('2d'), m = Math.min(w, hgt);
        x.drawImage(src, (w - m) / 2, (hgt - m) / 2, m, m, 0, 0, S, S);
        resolve(c.toDataURL('image/jpeg', 0.8));
      }
      function viaImg() {
        var url = URL.createObjectURL(file), img = new Image();
        img.onload = function () { draw(img, img.naturalWidth, img.naturalHeight); URL.revokeObjectURL(url); };
        img.onerror = function () { reject(new Error('img')); };
        img.src = url;
      }
      if (window.createImageBitmap) {
        // 1) respeitando a rotação do EXIF, 2) sem opções (navegadores que não aceitam), 3) via <img>
        createImageBitmap(file, { imageOrientation: 'from-image' })
          .catch(function () { return createImageBitmap(file); })
          .then(function (b) { draw(b, b.width, b.height); })
          .catch(viaImg);
      } else viaImg();
    });
  }
  function setPickPreview(src) {
    var img = $('#pick-img');
    if (src) { img.src = src; img.hidden = false; $('#pick-ph').hidden = true; }
    else { img.hidden = true; $('#pick-ph').hidden = false; }
  }
  function openEdit() {
    var m = mine(); if (!m) return;
    editing = true;
    $('#f-name').value = m.name || ''; $('#f-nick').value = m.nick || '';
    photoData = okPhoto(m.photo) ? m.photo : ''; setPickPreview(photoData);
    $('#join-eyebrow').textContent = 'Perfil';
    $('#join-title').textContent = 'Editar perfil';
    $('#f-submit').textContent = 'Salvar';
    $('#f-cancel').textContent = 'Cancelar';
    render();
  }
  function resetJoinLabels() {
    $('#join-eyebrow').textContent = 'Sua vez';
    $('#join-title').textContent = 'Entre na mesa';
    $('#f-submit').textContent = 'Entrar na mesa';
    $('#f-cancel').textContent = 'Só acompanhar';
  }

  $('#f-photo').addEventListener('change', function (e) {
    var input = e.target;
    var f = input.files && input.files[0]; if (!f) return;
    readPhoto(f).then(function (d) { photoData = d; setPickPreview(d); }).catch(function () {
      var heic = /hei[cf]/i.test((f.type || '') + ' ' + (f.name || ''));
      toast(heic ? 'Esse formato de foto (HEIC) não abre aqui. Tire a foto pela câmera ou escolha um JPG ou PNG.' : 'Não consegui abrir essa foto. Tente outra ou tire pela câmera.');
    }).then(function () { try { input.value = ''; } catch (err) {} });
  });
  $('#f-cancel').addEventListener('click', function () {
    if (editing) { editing = false; resetJoinLabels(); } else spectating = true;
    render();
  });
  $('#form').addEventListener('submit', async function (e) {
    e.preventDefault();
    var name = $('#f-name').value.trim().slice(0, 18), nick = $('#f-nick').value.trim().slice(0, 14);
    if (!name) { $('#f-name').focus(); return; }
    var btn = $('#f-submit'); btn.disabled = true;
    var m = mine();
    if (m) {
      var up = await sb.rpc('update_profile', { p_id: cred.id, p_secret: cred.secret, p_name: name, p_nick: nick, p_photo: photoData || '' });
      if (up.error) { btn.disabled = false; toast(errText(up.error).indexOf('game_ended') >= 0 ? 'A contagem foi encerrada.' : 'Não consegui salvar o perfil.'); return; }
      m.name = name; m.nick = nick; m.photo = photoData || '';
      editing = false; resetJoinLabels();
    } else {
      var jr = await sb.rpc('join_player', { p_name: name, p_nick: nick, p_photo: photoData || '' });
      if (jr.error || !jr.data) {
        btn.disabled = false;
        var t = errText(jr.error);
        toast(t.indexOf('game_ended') >= 0 ? 'A contagem já foi encerrada.' : t.indexOf('table_full') >= 0 ? 'A mesa está cheia.' : 'Não consegui entrar. Confira sua internet.');
        return;
      }
      cred = { id: jr.data.id, secret: jr.data.secret, t: Date.now() };
      lsSet('sushi.cred', JSON.stringify(cred));
      players.push({ id: cred.id, name: name, nick: nick, photo: photoData || '', count: 0, joinedAt: Date.now() });
      myCount = 0; dirty = false;
    }
    btn.disabled = false;
    render();
  });
  $('#plus').addEventListener('click', function () { bump(1); });
  $('#minus').addEventListener('click', function () { bump(-1); });
  $('#edit-btn').addEventListener('click', openEdit);
  $('#reopen').addEventListener('click', function () { setGame('live'); });

  /* ---------- confetti ---------- */
  function confetti() {
    if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var c = $('#confetti'), ctx = c.getContext('2d'), dpr = window.devicePixelRatio || 1;
    var W = window.innerWidth, H = window.innerHeight;
    c.width = W * dpr; c.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var cols = ['#ff6b57', '#f2b134', '#8fc13d', '#f5f6f0', '#6fc3df'];
    var ps = [];
    for (var i = 0; i < 150; i++) ps.push({ x: Math.random() * W, y: -20 - Math.random() * H * 0.6, vx: (Math.random() - 0.5) * 2, vy: 2 + Math.random() * 3, s: 6 + Math.random() * 6, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3, c: cols[(Math.random() * cols.length) | 0] });
    var t0 = performance.now();
    (function frame(t) {
      ctx.clearRect(0, 0, W, H);
      ps.forEach(function (p) {
        p.x += p.vx; p.y += p.vy; p.r += p.vr;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r);
        ctx.fillStyle = p.c; ctx.fillRect(-p.s / 2, -p.s / 3, p.s, p.s * 0.6); ctx.restore();
      });
      if (t - t0 < 5200) requestAnimationFrame(frame); else ctx.clearRect(0, 0, W, H);
    })(t0);
  }

  /* ---------- boot ---------- */
  async function init() {
    if (!window.supabase || !window.supabase.createClient) { failed = true; note('Não consegui carregar o app. Recarregue a página.'); render(); return; }
    sb = window.supabase.createClient(SB_URL, SB_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    if (hostPin) verifyPin(hostPin).then(function (ok) { if (ok) { isHost = true; hostSig = ''; render(); } else { hostPin = ''; lsDel('sushi.pin'); } });

    sb.channel('sushi-rank')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'players' }, applyChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game' }, function (p) {
        if (p['new'] && p['new'].status) { game = { status: p['new'].status === 'ended' ? 'ended' : 'live' }; if (game.status === 'live') { stageSig = ''; confettiDone = false; } render(); }
      })
      .subscribe(function (status) { if (status === 'SUBSCRIBED') loadAll(); });

    await loadAll();
    // rede de segurança: ressincroniza a cada 8 s e ao voltar para a aba
    setInterval(function () { if (!document.hidden && !dirty && !inFlight) loadAll(); }, 8000);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) loadAll(); });
  }
  init();
})();
