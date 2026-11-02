import { useEffect, useRef } from 'react';

/* Animación de entrada: rayos de luz que forman una esfera, destello y aparece el logo */
export default function Intro({ onFin }) {
  const cv = useRef(null);
  useEffect(() => {
    const c = cv.current, ctx = c.getContext('2d'), dpr = Math.min(window.devicePixelRatio || 1, 2);
    let W, H, raf, fin = false; const t0 = performance.now();
    const size = () => { W = c.width = innerWidth * dpr; H = c.height = innerHeight * dpr; };
    size(); addEventListener('resize', size);
    const logo = new Image(); logo.src = 'img/tiburon.png';
    let semilla = 11; const R = () => (semilla = (semilla * 16807) % 2147483647) / 2147483647;
    const aros = Array.from({ length: 7 }, () => ({ ax: R() * Math.PI, ay: R() * Math.PI * 2, off: R() * 6.28 }));
    const cometas = Array.from({ length: 9 }, (_, i) => {
      const ang = R() * 6.28, d = Math.max(innerWidth, innerHeight);
      return { s: [Math.cos(ang) * d * 0.9, Math.sin(ang) * d * 0.9], k: [(R() - .5) * d, (R() - .5) * d], aro: i % 7, th: R() * 6.28, delay: R() * 0.5 };
    });
    const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x)), ease = x => 1 - Math.pow(1 - clamp(x), 3);
    const punto = (a, th, ry, rx) => {
      let x = Math.cos(th), y = Math.sin(th), z = 0;
      let y1 = y * Math.cos(a.ax) - z * Math.sin(a.ax), z1 = y * Math.sin(a.ax) + z * Math.cos(a.ax);
      let x2 = x * Math.cos(a.ay) + z1 * Math.sin(a.ay), z2 = -x * Math.sin(a.ay) + z1 * Math.cos(a.ay);
      let x3 = x2 * Math.cos(ry) + z2 * Math.sin(ry), z3 = -x2 * Math.sin(ry) + z2 * Math.cos(ry);
      let y4 = y1 * Math.cos(rx) - z3 * Math.sin(rx), z4 = y1 * Math.sin(rx) + z3 * Math.cos(rx);
      return [x3, y4, z4];
    };
    let reflejo = null;
    const frame = now => {
      if (fin) return;
      const T = (now - t0) / 1000, cx = W / 2, cy = H / 2 - H * 0.04, Rs = Math.min(W, H) * 0.26;
      ctx.clearRect(0, 0, W, H);
      const proy = p => { const s = 3.4 / (3.4 - p[2]); return [cx + Rs * p[0] * s, cy + Rs * p[1] * s, s]; };
      const ry = 0.3 + T * 0.9, rx = 0.35;
      const glow = (x, y, r, a) => { const g = ctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, `rgba(255,236,232,${a})`); g.addColorStop(0.4, `rgba(255,170,170,${a * 0.45})`); g.addColorStop(1, 'rgba(255,170,170,0)'); ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.3); ctx.fill(); };
      ctx.lineCap = 'round';
      // 1) cometas de luz que llegan a la esfera
      if (T < 2.8) cometas.forEach(m => {
        const u = ease((T - m.delay) / 1.7), obj = proy(punto(aros[m.aro], m.th, ry, rx));
        const P = v => { const w = clamp(v); return [(1 - w) * (1 - w) * (cx + m.s[0]) + 2 * (1 - w) * w * (cx + m.k[0]) + w * w * obj[0], (1 - w) * (1 - w) * (cy + m.s[1]) + 2 * (1 - w) * w * (cy + m.k[1]) + w * w * obj[1]]; };
        const a = clamp(1 - (T - 1.9) / 0.9) * clamp(T / 0.3);
        if (a <= 0 || u <= 0) return;
        ctx.shadowBlur = 12 * dpr; ctx.shadowColor = 'rgba(255,160,160,.9)'; ctx.lineWidth = 1.6 * dpr;
        for (let i = 0; i < 24; i++) {
          const p0 = P(u - 0.3 * (i + 1) / 24), p1 = P(u - 0.3 * i / 24);
          ctx.strokeStyle = `rgba(255,236,232,${a * (1 - i / 24)})`; ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.stroke();
        }
        const h = P(u); glow(h[0], h[1], 10 * dpr, a);
      });
      // 2) esfera de arcos con nodos brillantes
      const fr = ease((T - 0.9) / 1.8), aS = clamp(1 - (T - 3.9) / 0.4);
      if (fr > 0 && aS > 0) {
        aros.forEach(a => {
          ctx.shadowBlur = 8 * dpr; ctx.shadowColor = 'rgba(255,150,150,.8)'; ctx.lineWidth = 1.3 * dpr;
          const N = 80, hasta = Math.floor(N * fr);
          for (let i = 0; i < hasta; i++) {
            const p0 = punto(a, a.off + i / N * 6.283, ry, rx), p1 = punto(a, a.off + (i + 1) / N * 6.283, ry, rx), q0 = proy(p0), q1 = proy(p1);
            ctx.strokeStyle = `rgba(255,236,232,${aS * (0.28 + 0.4 * (p0[2] + 1) / 2)})`; ctx.beginPath(); ctx.moveTo(q0[0], q0[1]); ctx.lineTo(q1[0], q1[1]); ctx.stroke();
          }
          [0, 2.1, 4.2].forEach(d => { if (fr > 0.9) { const q = proy(punto(a, a.off + d, ry, rx)); glow(q[0], q[1], 7 * dpr * q[2], aS); } });
        });
        const nuc = clamp((T - 2.2) / 1.5); if (nuc > 0) glow(cx, cy, Rs * (0.15 + 1.1 * nuc * nuc), 0.85 * nuc * aS);
      }
      ctx.shadowBlur = 0;
      // 3) destello
      const fl = T < 4.0 ? clamp((T - 3.55) / 0.45) : clamp(1 - (T - 4.0) / 0.9);
      if (fl > 0) { const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(W, H) * 0.75); g.addColorStop(0, `rgba(255,244,240,${fl})`); g.addColorStop(0.5, `rgba(255,190,190,${fl * 0.6})`); g.addColorStop(1, `rgba(255,150,150,${fl * 0.1})`); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); }
      // 4) logo con reflejo en el piso
      const la = ease((T - 4.1) / 1.0);
      if (la > 0 && logo.complete && logo.naturalWidth) {
        const Lw = Math.min(innerWidth * 0.62, 320) * dpr * (0.9 + 0.1 * la), Lh = Lw * logo.naturalHeight / logo.naturalWidth, ly = cy - Lh / 2 - H * 0.02;
        glow(cx, cy, Lw * 0.9, 0.16 * la);
        ctx.globalAlpha = la; ctx.drawImage(logo, cx - Lw / 2, ly, Lw, Lh);
        if (!reflejo || reflejo.width !== Math.round(Lw)) {
          reflejo = document.createElement('canvas'); reflejo.width = Math.round(Lw); reflejo.height = Math.round(Lh * 0.7);
          const r = reflejo.getContext('2d'); r.save(); r.translate(0, Lh); r.scale(1, -1); r.drawImage(logo, 0, 0, Lw, Lh); r.restore();
          r.globalCompositeOperation = 'destination-in'; const g = r.createLinearGradient(0, 0, 0, reflejo.height); g.addColorStop(0, 'rgba(0,0,0,.35)'); g.addColorStop(1, 'rgba(0,0,0,0)'); r.fillStyle = g; r.fillRect(0, 0, reflejo.width, reflejo.height);
        }
        ctx.globalAlpha = la; ctx.drawImage(reflejo, cx - Lw / 2, ly + Lh + 4 * dpr);
        ctx.globalAlpha = 1; const gs = ctx.createRadialGradient(cx, ly + Lh + 2 * dpr, 0, cx, ly + Lh + 2 * dpr, Lw * 0.6); gs.addColorStop(0, `rgba(255,190,190,${0.35 * la})`); gs.addColorStop(1, 'rgba(255,190,190,0)');
        ctx.save(); ctx.translate(0, ly + Lh); ctx.scale(1, 0.12); ctx.translate(0, -(ly + Lh)); ctx.fillStyle = gs; ctx.beginPath(); ctx.arc(cx, ly + Lh, Lw * 0.6, 0, 6.3); ctx.fill(); ctx.restore();
      }
      if (T > 7.4) { fin = true; onFin(); return; }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => { fin = true; cancelAnimationFrame(raf); removeEventListener('resize', size); };
  }, [onFin]);
  return (
    <div className="intro" onClick={onFin}>
      <canvas ref={cv} />
      <div className="tx"><div className="t1">CBTIS 170</div><div className="t2">SHARK DARK · PORTAL ESCOLAR</div></div>
      <small>Toca para saltar</small>
    </div>
  );
}
