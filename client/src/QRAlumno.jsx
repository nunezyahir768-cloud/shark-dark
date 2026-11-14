import { useState } from 'react';
import SD from './sd.js';
import { QR } from './ui.jsx';

const sinAcentos = valor => String(valor || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const escPdf = valor => sinAcentos(valor).replace(/[^\x20-\x7E]/g, '').replace(/[\\()]/g, m => `\\${m}`);

function imagenJpeg(src, ancho, alto) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas'); canvas.width = ancho; canvas.height = alto;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, ancho, alto);
      const escala = Math.min(ancho / img.width, alto / img.height), w = img.width * escala, h = img.height * escala;
      ctx.drawImage(img, (ancho - w) / 2, (alto - h) / 2, w, h);
      const raw = atob(canvas.toDataURL('image/jpeg', .92).split(',')[1]);
      resolve({ bytes: Uint8Array.from(raw, c => c.charCodeAt(0)), width: ancho, height: alto });
    };
    img.onerror = () => reject(new Error('No se pudo preparar una imagen para el PDF.'));
    img.src = src;
  });
}

function pdfQR(alumno, logo, qr) {
  const enc = new TextEncoder(), objetos = [];
  objetos[1] = ['<< /Type /Catalog /Pages 2 0 R >>'];
  objetos[2] = ['<< /Type /Pages /Kids [3 0 R] /Count 1 >>'];
  objetos[3] = ['<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Logo 4 0 R /Codigo 5 0 R >> /Font << /F1 6 0 R >> >> /Contents 7 0 R >>'];
  objetos[4] = [`<< /Type /XObject /Subtype /Image /Width ${logo.width} /Height ${logo.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${logo.bytes.length} >>\nstream\n`, logo.bytes, '\nendstream'];
  objetos[5] = [`<< /Type /XObject /Subtype /Image /Width ${qr.width} /Height ${qr.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${qr.bytes.length} >>\nstream\n`, qr.bytes, '\nendstream'];
  objetos[6] = ['<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const contenido = [
    'q 150 0 0 105 222 690 cm /Logo Do Q',
    `BT /F1 22 Tf 90 646 Td (CBTIS 170 - SHARK DARK) Tj ET`,
    `BT /F1 15 Tf 70 608 Td (${escPdf(alumno.nombre)}) Tj ET`,
    `BT /F1 12 Tf 70 584 Td (CURP: ${escPdf(alumno.curp)}) Tj ET`,
    `BT /F1 11 Tf 70 563 Td (${escPdf([alumno.semestre, alumno.area, alumno.grupo && 'Grupo ' + alumno.grupo].filter(Boolean).join(' - '))}) Tj ET`,
    'q 220 0 0 220 187.5 305 cm /Codigo Do Q',
    'BT /F1 11 Tf 104 278 Td (Muestra este codigo QR a tu docente para registrar asistencia.) Tj ET'
  ].join('\n');
  objetos[7] = [`<< /Length ${enc.encode(contenido).length} >>\nstream\n`, contenido, '\nendstream'];
  const partes = ['%PDF-1.4\n'], offsets = [0]; let total = enc.encode(partes[0]).length;
  for (let id = 1; id <= 7; id++) {
    offsets[id] = total;
    const cab = `${id} 0 obj\n`, pie = '\nendobj\n';
    partes.push(cab, ...objetos[id], pie);
    total += enc.encode(cab).length + objetos[id].reduce((n, parte) => n + (typeof parte === 'string' ? enc.encode(parte).length : parte.length), 0) + enc.encode(pie).length;
  }
  const xref = total;
  let tabla = `xref\n0 8\n0000000000 65535 f \n`;
  for (let id = 1; id <= 7; id++) tabla += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  tabla += `trailer\n<< /Size 8 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  partes.push(tabla);
  return new Blob(partes, { type: 'application/pdf' });
}

export default function QRAlumno({ alumno, onSalir }) {
  const [descargando, setDescargando] = useState(false), [error, setError] = useState('');
  async function descargarPdf() {
    setDescargando(true); setError('');
    try {
      const svg = new Blob([SD.qr(alumno.curp)], { type: 'image/svg+xml' });
      const qrUrl = URL.createObjectURL(svg);
      try {
        const [logo, qr] = await Promise.all([imagenJpeg('/img/tiburon.png', 600, 420), imagenJpeg(qrUrl, 640, 640)]);
        const blob = pdfQR(alumno, logo, qr), url = URL.createObjectURL(blob), a = document.createElement('a');
        a.href = url; a.download = `QR-${alumno.curp}.pdf`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 3000);
      } finally { URL.revokeObjectURL(qrUrl); }
    } catch (e) { setError(e.message || 'No se pudo generar el PDF.'); }
    finally { setDescargando(false); }
  }
  return <div className="qr-alumno-fondo" onClick={onSalir}>
    <section className="qr-alumno-modal" role="dialog" aria-modal="true" aria-labelledby="qr-alumno-titulo" onClick={e => e.stopPropagation()}>
      <h2 id="qr-alumno-titulo">Mi código QR</h2>
      <p className="sub">{alumno.nombre}<br />{alumno.curp}</p>
      <QR texto={alumno.curp} />
      <p className="sub qr-alumno-ayuda">Muéstralo a tu docente para registrar tu asistencia.</p>
      {error && <p className="msg" role="alert">{error}</p>}
      <div className="qr-alumno-acciones">
        <button className="btn" type="button" onClick={descargarPdf} disabled={descargando}>{descargando ? 'PREPARANDO PDF…' : 'Descargar PDF'}</button>
        <button className="btn sec" type="button" onClick={onSalir}>Salir</button>
      </div>
    </section>
  </div>;
}
