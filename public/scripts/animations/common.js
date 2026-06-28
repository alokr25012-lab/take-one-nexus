/**
 * COMMON ANIMATIONS
 * Cursor, scroll reveal, and scroll progress tracking.
 */

(() => {
    const cursorSelector = 'a[href], button, input, textarea, select, summary, label, [role="button"], [tabindex]:not([tabindex="-1"]), .role-card, .movie-card, .ctab, .project-card, .feat, .benefit-card, .stage-card, .director-chip, .nav-cta, .btn-primary, .btn-secondary, .btn-upload, .feat-action, .monitor-actions button, .tab-btn, .wizard-btn-next, .wizard-btn-prev, .form-submit, .modal-close, .pw-toggle, .pathway-card, .director-control-card button';

    /* -- CUSTOM CURSOR -- */
    function initCustomCursor() {
        if (window.__takeOneCursorInitialized) return;
        window.__takeOneCursorInitialized = true;

        const dot = document.getElementById('dot');
        const cross = document.getElementById('cross');
        const canUseCustomCursor = window.matchMedia('(pointer: fine)').matches;

        if (!canUseCustomCursor || (!dot && !cross)) return;

        let pointerX = window.innerWidth / 2;
        let pointerY = window.innerHeight / 2;
        let crossX = pointerX;
        let crossY = pointerY;
        let scale = 1;
        let isVisible = false;
        let hasPointerPosition = false;

        const setOpacity = (opacity) => {
            if (dot) dot.style.opacity = opacity;
            if (cross) cross.style.opacity = opacity;
        };

        const showCursor = () => {
            if (isVisible) return;
            isVisible = true;
            setOpacity('1');
        };

        const hideCursor = () => {
            isVisible = false;
            setOpacity('0');
        };

        const moveDot = () => {
            if (!dot) return;
            dot.style.transform = `translate3d(${pointerX}px, ${pointerY}px, 0) translate(-50%, -50%)`;
        };

        const moveCross = () => {
            if (!cross) return;
            cross.style.transform = `translate3d(${crossX}px, ${crossY}px, 0) translate(-50%, -50%) scale(${scale})`;
        };

        const updatePointer = (event) => {
            pointerX = event.clientX;
            pointerY = event.clientY;

            if (!hasPointerPosition) {
                crossX = pointerX;
                crossY = pointerY;
                hasPointerPosition = true;
                moveCross();
            }

            moveDot();
            showCursor();
        };

        const setHoverState = (event, nextScale) => {
            if (!(event.target instanceof Element)) return;
            const interactive = event.target.closest(cursorSelector);
            if (!interactive) return;

            if (event.relatedTarget instanceof Node && interactive.contains(event.relatedTarget)) {
                return;
            }

            scale = nextScale;
            moveCross();
        };

        const animateCursor = () => {
            const stiffness = scale > 1 ? 0.5 : 0.38;
            crossX += (pointerX - crossX) * stiffness;
            crossY += (pointerY - crossY) * stiffness;
            moveCross();
            window.requestAnimationFrame(animateCursor);
        };

        setOpacity('0');
        document.addEventListener('pointermove', updatePointer, { passive: true });
        document.addEventListener('pointerover', (event) => setHoverState(event, 1.6), true);
        document.addEventListener('pointerout', (event) => setHoverState(event, 1), true);
        document.addEventListener('pointerdown', () => {
            scale = 0.9;
            moveCross();
        }, { passive: true });
        document.addEventListener('pointerup', (event) => {
            scale = event.target instanceof Element && event.target.closest(cursorSelector) ? 1.6 : 1;
            moveCross();
        }, { passive: true });
        document.addEventListener('pointerleave', hideCursor);
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) hideCursor();
        });

        animateCursor();
    }

    /* -- SCROLL REVEAL -- */
    const revealObserver = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
        entries.forEach(e => {
            if (e.isIntersecting) e.target.classList.add('visible');
        });
    }, { threshold: 0.1 }) : null;

    function initScrollReveal() {
        document.querySelectorAll('.reveal').forEach(el => {
            if (revealObserver) {
                revealObserver.observe(el);
            } else {
                el.classList.add('visible');
            }
        });
    }

    /* -- SCROLL PROGRESS -- */
    function updateScrollProgress() {
        const progress = document.getElementById('scrollProgress');
        if (!progress) return;

        const max = document.documentElement.scrollHeight - window.innerHeight;
        const percent = max > 0 ? (window.scrollY / max) * 100 : 0;
        progress.style.width = `${percent}%`;
    }

    function initCommonAnimations() {
        initCustomCursor();
        initScrollReveal();
        window.addEventListener('scroll', updateScrollProgress, { passive: true });
        updateScrollProgress();
    }

    // Initialization
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initCommonAnimations, { once: true });
    } else {
        initCommonAnimations();
    }
})();
