/* ---------- count-up animation ---------- */
function animateCount(el) {
  const target = +el.dataset.target;
  const dur = 1200; const start = performance.now();
  function tick(now) {
    const p = Math.min((now - start) / dur, 1);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = Math.round(target * eased).toLocaleString('id-ID');
    if (p < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

/* ---------- reveal on scroll ---------- */
const io = new IntersectionObserver((entries) => {
  entries.forEach(e => {
    if (e.isIntersecting) {
      e.target.classList.add('in');
      e.target.querySelectorAll('.count').forEach(animateCount);
      io.unobserve(e.target);
    }
  });
}, { threshold: 0.15 });
document.querySelectorAll('.reveal').forEach(el => io.observe(el));
// stats pakai observer sendiri (ada .count di hero, bukan .reveal)
const statIO = new IntersectionObserver((entries) => {
  entries.forEach(e => { if (e.isIntersecting) { e.target.querySelectorAll('.count').forEach(animateCount); statIO.unobserve(e.target); } });
}, { threshold: 0.3 });
statIO.observe(document.querySelector('.hero-stats'));

/* ---------- parallax pixel grid ---------- */
const bg = document.getElementById('pixelbg');
let raf = null;
window.addEventListener('scroll', () => {
  if (raf) return;
  raf = requestAnimationFrame(() => {
    const y = window.scrollY;
    if (bg) bg.style.transform = `translateY(${y * 0.25}px)`;
    const mvb = document.getElementById('mapbox');
    if (mvb) mvb.style.transform = `translateY(${y * -0.03}px)`;
    raf = null;
  });
}, { passive: true });

/* ---------- live status ticker (simulated) ---------- */
setInterval(() => {
  const el = document.getElementById('mvlive');
  const states = ['TERHUBUNG', '514 KAB/KOTA', '38 PROVINSI', 'SINYAL KUAT'];
  if (el) el.textContent = states[Math.floor(Math.random() * states.length)];
}, 2600);
