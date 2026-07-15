(function () {
  const SHOW_THRESHOLD = 400;
  const RADIUS = 20;
  const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

  function init() {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'takeone-scroll-top';
    btn.setAttribute('aria-label', 'Scroll to top');
    btn.innerHTML =
      '<svg width="46" height="46" viewBox="0 0 46 46">' +
        '<circle class="ring-track" cx="23" cy="23" r="' + RADIUS + '" stroke-width="2.5" fill="none"></circle>' +
        '<circle class="ring-progress" cx="23" cy="23" r="' + RADIUS + '" stroke-width="2.5" fill="none" ' +
          'stroke-dasharray="' + CIRCUMFERENCE + '" stroke-dashoffset="' + CIRCUMFERENCE + '"></circle>' +
      '</svg>' +
      '<span class="scroll-arrow">↑</span>';

    document.body.appendChild(btn);

    const ringProgress = btn.querySelector('.ring-progress');
    let ticking = false;

    function updateButton() {
      const scrollTop = window.scrollY;
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      const pct = docHeight > 0 ? Math.min(1, Math.max(0, scrollTop / docHeight)) : 0;

      ringProgress.style.strokeDashoffset = CIRCUMFERENCE * (1 - pct);
      btn.classList.toggle('is-visible', scrollTop > SHOW_THRESHOLD);
      ticking = false;
    }

    window.addEventListener('scroll', function () {
      if (!ticking) {
        requestAnimationFrame(updateButton);
        ticking = true;
      }
    }, { passive: true });

    window.addEventListener('resize', updateButton);

    btn.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    updateButton();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();