const mobile = matchMedia('(max-width: 899px)');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const gestures = new WeakSet();
const slides = new WeakMap();
const activeSlides = new Set();
const touchPointers = new Set();
let multitouchSequence = 0;
document.addEventListener('pointerdown', event => {
  if (event.pointerType !== 'touch') return;
  touchPointers.add(event.pointerId);
  if (touchPointers.size > 1) multitouchSequence++;
}, { capture: true, passive: true });
for (const type of ['pointerup', 'pointercancel']) {
  document.addEventListener(type, event => { touchPointers.delete(event.pointerId); }, { capture: true, passive: true });
}
window.addEventListener('blur', () => { touchPointers.clear(); multitouchSequence++; });

export const canSlideService = () => mobile.matches && !reducedMotion.matches;

export function cancelServiceSlide(viewport) {
  const slide = slides.get(viewport);
  if (!slide) return;
  slide.animations.forEach(animation => animation.cancel());
}

mobile.addEventListener('change', () => {
  if (!mobile.matches) activeSlides.forEach(cancelServiceSlide);
});
reducedMotion.addEventListener('change', () => {
  if (reducedMotion.matches) activeSlides.forEach(cancelServiceSlide);
});

export async function slideService(viewport, incoming, direction) {
  const outgoing = viewport.firstElementChild;
  if (!outgoing || !canSlideService() || !outgoing.animate) {
    viewport.replaceChildren(incoming);
    return;
  }
  const slide = { animations: [] };
  slides.set(viewport, slide);
  activeSlides.add(viewport);
  const outgoingHeight = outgoing.getBoundingClientRect().height;
  incoming.classList.add('service-slide-layer');
  outgoing.inert = incoming.inert = true;
  outgoing.setAttribute('aria-hidden', 'true');
  viewport.append(incoming);
  viewport.style.height = `${Math.max(outgoingHeight, incoming.getBoundingClientRect().height)}px`;
  outgoing.classList.add('service-slide-layer');
  viewport.classList.add('service-is-sliding');
  viewport.setAttribute('aria-busy', 'true');
  const options = { duration: 300, easing: 'ease-in-out', fill: 'both' };
  slide.animations = [
    outgoing.animate([{ transform: 'translateX(0%)' }, { transform: `translateX(${-direction * 100}%)` }], options),
    incoming.animate([{ transform: `translateX(${direction * 100}%)` }, { transform: 'translateX(0%)' }], options)
  ];
  let timeout;
  try {
    await Promise.race([
      Promise.allSettled(slide.animations.map(animation => animation.finished)),
      new Promise(resolve => { timeout = setTimeout(resolve, 400); })
    ]);
  } finally {
    clearTimeout(timeout);
    slide.animations.forEach(animation => animation.cancel());
    if (viewport.isConnected) {
      incoming.classList.remove('service-slide-layer');
      incoming.inert = false;
      viewport.replaceChildren(incoming);
      viewport.style.height = '';
      viewport.classList.remove('service-is-sliding');
      viewport.removeAttribute('aria-busy');
    }
    slides.delete(viewport);
    activeSlides.delete(viewport);
  }
}

export function bindServiceSwipe(viewport, onSwipe, isReady) {
  if (!viewport || gestures.has(viewport)) return;
  gestures.add(viewport);
  let gesture = null;
  let suppressedTarget = null;
  let suppressUntil = 0;
  const reset = () => { gesture = null; };
  viewport.addEventListener('pointerdown', event => {
    if (event.pointerType !== 'touch') return;
    if (!event.isPrimary) { reset(); return; }
    const control = event.target.closest('button,a,input,select,textarea,[contenteditable],.table-scroll,.date-control,.camera-count-label');
    if (!mobile.matches || !isReady() || event.clientX < 24 || event.clientX > innerWidth - 24 ||
        (control && !control.matches('.duty,.published-duty-card'))) { reset(); return; }
    gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, started: performance.now(), axis: null,
      target: control || event.target, sequence: multitouchSequence };
  }, { passive: true });
  viewport.addEventListener('pointermove', event => {
    if (!gesture || event.pointerId !== gesture.id) return;
    if (gesture.sequence !== multitouchSequence) { reset(); return; }
    const x = Math.abs(event.clientX - gesture.x), y = Math.abs(event.clientY - gesture.y);
    if (!gesture.axis && Math.max(x, y) >= 12) {
      if (y >= x / 1.5) { reset(); return; }
      gesture.axis = 'horizontal';
      try { viewport.setPointerCapture(event.pointerId); } catch {}
    }
  }, { passive: true });
  viewport.addEventListener('pointerup', event => {
    if (!gesture || event.pointerId !== gesture.id) return;
    const current = gesture;
    reset();
    const x = event.clientX - current.x, y = Math.abs(event.clientY - current.y);
    const threshold = current.target.matches('.duty') ? 48 : Math.max(48, Math.min(80, viewport.clientWidth * .18));
    if (!mobile.matches || !isReady() || current.sequence !== multitouchSequence || current.axis !== 'horizontal' || Math.abs(x) < threshold ||
        Math.abs(x) < y * 1.5 || performance.now() - current.started > 800) return;
    suppressedTarget = current.target;
    suppressUntil = performance.now() + 500;
    onSwipe(x < 0 ? 1 : -1);
  }, { passive: true });
  viewport.addEventListener('pointercancel', reset, { passive: true });
  viewport.addEventListener('lostpointercapture', event => { if (event.target === viewport) reset(); }, { passive: true });
  viewport.addEventListener('click', event => {
    if (suppressedTarget && performance.now() < suppressUntil &&
        (suppressedTarget === event.target || suppressedTarget.contains(event.target))) {
      event.preventDefault();
      event.stopImmediatePropagation();
      suppressedTarget = null;
    }
  }, true);
}
