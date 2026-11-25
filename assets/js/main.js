(function () {
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- Reveal on scroll ----------
  // Elements that enter the view together appear one after another, top to bottom.
  // On project pages the first batch continues the intro sequence (eyebrow, title,
  // intro paragraph at 0 / .14 / .28s), so the text below follows at .42s, .56s, ...
  var isProject = document.body.classList.contains('project');
  function observe(selector, threshold, step, firstDelay) {
    var els = document.querySelectorAll(selector);
    if (!('IntersectionObserver' in window)) {
      els.forEach(function (el) { el.classList.add('in'); });
      return;
    }
    var first = true;
    var io = new IntersectionObserver(function (entries) {
      var shown = entries.filter(function (e) { return e.isIntersecting; }).map(function (e) { return e.target; });
      shown.sort(function (a, b) { return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1; });
      var base = first ? firstDelay : 0;
      first = false;
      shown.forEach(function (el, n) {
        io.unobserve(el);
        if (step) el.style.setProperty('--d', (base + n * step).toFixed(2) + 's');
        // let the hidden state paint first, otherwise there is nothing to transition from
        setTimeout(function () { el.classList.add('in'); }, 30);
      });
    }, { threshold: threshold });
    els.forEach(function (el) { io.observe(el); });
  }
  observe('.card.reveal', 0.15, 0, 0);
  observe('.reveal:not(.card)', 0.12, isProject ? 0.14 : 0, isProject ? 0.42 : 0);
  observe('.g-reveal', 0.12, 0.1, 0);

  // ---------- Navigation: hide on scroll down, show on scroll up ----------
  // Only active once the bar is actually pinned to the top of the viewport,
  // so the pills never jump over the hero on the homepage.
  var nav = document.querySelector('.site-nav');
  if (nav) {
    var lastY = window.scrollY;
    window.addEventListener('scroll', function () {
      var y = window.scrollY;
      if (Math.abs(y - lastY) < 4) return;
      var pinned = nav.getBoundingClientRect().top <= 0.5 && y > 0;
      if (!pinned) nav.classList.remove('hidden');
      else nav.classList.toggle('hidden', y > lastY);
      lastY = y;
    }, { passive: true });
  }

  // ---------- Page transition: fade the old page out before leaving ----------
  document.addEventListener('click', function (e) {
    if (reduceMotion || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target.closest && e.target.closest('a[href]');
    if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
    var url = new URL(a.href, location.href);
    if (url.origin !== location.origin) return;
    // same page with only a hash change: let the browser scroll
    if (url.pathname === location.pathname && url.search === location.search) return;
    e.preventDefault();
    document.body.classList.add('leaving');
    setTimeout(function () { location.href = url.href; }, 300);
  });
  // coming back via the back button restores the page from cache: make it visible again
  window.addEventListener('pageshow', function (e) {
    if (e.persisted) document.body.classList.remove('leaving');
  });

  // ---------- Video fragments: loop only [data-start, data-end] ----------
  // Videos sharing a data-sync name start together and jump back together,
  // so equally long fragments stay in step with each other.
  var groups = {};
  document.querySelectorAll('video[data-start]').forEach(function (v, n) {
    var key = v.getAttribute('data-sync') || ('solo' + n);
    (groups[key] = groups[key] || []).push(v);
  });
  Object.keys(groups).forEach(function (key) {
    var vids = groups[key].map(function (v) {
      return { el: v, start: parseFloat(v.getAttribute('data-start')) || 0, end: parseFloat(v.getAttribute('data-end')) || Infinity };
    });
    var seeking = false;
    // pause all, jump all to their start, and only play once every video has arrived
    function restart() {
      if (seeking) return;
      seeking = true;
      var pending = vids.length;
      vids.forEach(function (x) {
        x.el.pause();
        x.el.addEventListener('seeked', function () {
          if (--pending > 0) return;
          seeking = false;
          vids.forEach(function (y) {
            var p = y.el.play();
            if (p && p.catch) p.catch(function () {});
          });
        }, { once: true });
        x.el.currentTime = x.start;
      });
    }
    // the longest fragment sets the rhythm; shorter ones loop on their own in between
    var longest = vids.reduce(function (a, b) { return (b.end - b.start) > (a.end - a.start) ? b : a; });
    function atEnd(x) { return x.el.currentTime >= x.end - 0.05 || x.el.ended; }
    function check() {
      if (!seeking) {
        if (atEnd(longest)) restart();
        else vids.forEach(function (x) {
          if (x !== longest && atEnd(x)) {
            x.el.currentTime = x.start;
            var p = x.el.play();
            if (p && p.catch) p.catch(function () {});
          }
        });
      }
      requestAnimationFrame(check);
    }
    var ready = 0;
    vids.forEach(function (x) {
      function onMeta() { if (++ready === vids.length) { restart(); requestAnimationFrame(check); } }
      if (x.el.readyState >= 1) onMeta(); else x.el.addEventListener('loadedmetadata', onMeta, { once: true });
      // the #t=start,end fragment pauses playback at the end; restart the whole group then
      x.el.addEventListener('pause', function () { if (!seeking && x === longest && x.el.currentTime >= x.end - 0.3) restart(); });
    });
  });

  // ---------- Image carousel (Waterwise Connections) ----------
  // Autoplay: starts once the carousel is mostly in view, shows each image for DWELL ms,
  // pauses only while off-screen or in a hidden tab, wraps from the last image to the first,
  // and stops for good as soon as the visitor browses by hand.
  var DWELL = 6000;
  document.querySelectorAll('[data-carousel]').forEach(function (c) {
    var track = c.querySelector('.track');
    var slides = track.children.length;
    var prev = c.querySelector('.prev'), next = c.querySelector('.next');
    var i = 0;

    // wrap the track and arrows in a viewport so the dots can sit below the image
    var viewport = document.createElement('div');
    viewport.className = 'viewport';
    c.insertBefore(viewport, track);
    viewport.appendChild(track); viewport.appendChild(prev); viewport.appendChild(next);

    var counter = document.createElement('span');
    counter.className = 'counter';
    viewport.appendChild(counter);

    var dotsWrap = document.createElement('div');
    dotsWrap.className = 'dots';
    var dots = [];
    for (var n = 0; n < slides; n++) {
      var d = document.createElement('button');
      d.type = 'button';
      d.className = 'dot';
      d.setAttribute('aria-label', 'Image ' + (n + 1) + ' of ' + slides);
      d.innerHTML = '<span class="fill"></span>';
      (function (k) { d.addEventListener('click', function () { manual(); go(k); }); })(n);
      dotsWrap.appendChild(d);
      dots.push(d);
    }
    c.appendChild(dotsWrap);

    function go(n) {
      i = (n + slides) % slides;
      var w = track.children[0].getBoundingClientRect().width + 10;
      track.style.transform = 'translateX(' + (-i * w) + 'px)';
      counter.textContent = (i + 1) + ' / ' + slides;
      dots.forEach(function (d, k) { d.setAttribute('aria-current', k === i ? 'true' : 'false'); });
      // restart the dot timer animation for the new slide
      if (auto) { var f = dots[i].firstChild; f.style.animation = 'none'; void f.offsetWidth; f.style.animation = ''; }
      remaining = DWELL;
    }

    // ----- autoplay -----
    var auto = !reduceMotion, timer = null, started = 0, remaining = DWELL;
    var inView = false;
    c.style.setProperty('--dwell', DWELL / 1000 + 's');
    function canRun() { return auto && inView && !document.hidden; }
    function schedule() {
      clearTimeout(timer); timer = null;
      c.classList.toggle('paused', !canRun());
      if (!canRun()) return;
      started = Date.now();
      timer = setTimeout(function () { go(i + 1); schedule(); }, remaining);
    }
    function hold() {
      if (timer) { remaining = Math.max(0, remaining - (Date.now() - started)); clearTimeout(timer); timer = null; }
      c.classList.toggle('paused', true);
    }
    function update() { if (canRun()) schedule(); else hold(); }
    function manual() {
      if (!auto) return;
      auto = false;
      clearTimeout(timer); timer = null;
      c.classList.remove('auto', 'paused');
      counter.setAttribute('aria-live', 'polite');
    }
    if (auto) c.classList.add('auto');

    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        inView = entries[0].intersectionRatio >= 0.6;
        update();
      }, { threshold: [0, 0.6, 1] }).observe(viewport);
    } else { inView = true; }
    document.addEventListener('visibilitychange', update);

    // ----- manual browsing (always stops autoplay) -----
    prev.addEventListener('click', function () { manual(); go(i - 1); });
    next.addEventListener('click', function () { manual(); go(i + 1); });
    c.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft') { manual(); go(i - 1); e.preventDefault(); }
      if (e.key === 'ArrowRight') { manual(); go(i + 1); e.preventDefault(); }
    });
    window.addEventListener('resize', function () {
      track.style.transition = 'none'; go(i); void track.offsetWidth; track.style.transition = '';
    });
    var x0 = null;
    c.addEventListener('touchstart', function (e) { x0 = e.touches[0].clientX; }, { passive: true });
    c.addEventListener('touchend', function (e) {
      if (x0 === null) return;
      var dx = e.changedTouches[0].clientX - x0;
      if (Math.abs(dx) > 40) { manual(); go(i + (dx < 0 ? 1 : -1)); }
      x0 = null;
    });
    go(0);
    update();
  });

  // ---------- Signature: letters rise in a wave around the cursor ----------
  var sig = document.querySelector('.sig-text');
  if (sig) {
    var text = sig.textContent;
    sig.textContent = '';
    sig.setAttribute('aria-label', text);
    var letters = text.split('').map(function (ch) {
      var s = document.createElement('span');
      s.setAttribute('aria-hidden', 'true');
      s.textContent = ch === ' ' ? ' ' : ch;
      sig.appendChild(s);
      return { el: s, x: 0, v: 0, target: 0, pending: null, due: 0 };
    });

    var RADIUS = 64, LIFT = 12, STIFFNESS = 260, DAMPING = 16, DELAY_PER_PX = 1.5;
    var running = false, last = 0;

    function setTargets(clientX) {
      var now = performance.now();
      letters.forEach(function (l) {
        var r = l.el.getBoundingClientRect();
        var d = clientX === null ? RADIUS : Math.abs(clientX - (r.left + r.width / 2));
        var f = Math.max(0, 1 - Math.pow(d / RADIUS, 2));
        // letters further from the cursor follow a little later, which gives the wave
        l.pending = -LIFT * f;
        l.due = now + (clientX === null ? 0 : d * DELAY_PER_PX);
      });
      if (!running) { running = true; last = now; requestAnimationFrame(step); }
    }

    function step(now) {
      var dt = Math.min(0.032, (now - last) / 1000);
      last = now;
      var moving = false;
      letters.forEach(function (l) {
        if (l.pending !== null && now >= l.due) { l.target = l.pending; l.pending = null; }
        var a = -STIFFNESS * (l.x - l.target) - DAMPING * l.v;
        l.v += a * dt;
        l.x += l.v * dt;
        if (Math.abs(l.x - l.target) > 0.05 || Math.abs(l.v) > 0.05 || l.pending !== null) moving = true;
        else { l.x = l.target; l.v = 0; }
        l.el.style.transform = l.x ? 'translateY(' + l.x.toFixed(2) + 'px)' : '';
      });
      if (moving) requestAnimationFrame(step);
      else running = false;
    }

    if (!reduceMotion) {
      sig.addEventListener('mousemove', function (e) { setTargets(e.clientX); });
      sig.addEventListener('mouseleave', function () { setTargets(null); });
    }
  }
})();
