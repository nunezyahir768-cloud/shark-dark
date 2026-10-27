/* Generador de Excel (.xlsx) sin librerías: funciona en el celular y sin internet */
(() => {
  const enc = new TextEncoder();
  const T = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc = b => { let c = ~0; for (const x of b) c = T[(c ^ x) & 255] ^ (c >>> 8); return ~c >>> 0; };
  const u16 = n => [n & 255, (n >> 8) & 255], u32 = n => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];

  function zip(files) {                                   // .zip sin comprimir (suficiente para un .xlsx)
    const partes = [], cen = []; let off = 0;
    for (const f of files) {
      const nm = enc.encode(f.name), d = enc.encode(f.data), c = crc(d);
      const h = new Uint8Array([...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(c), ...u32(d.length), ...u32(d.length), ...u16(nm.length), ...u16(0)]);
      partes.push(h, nm, d); cen.push({ nm, c, len: d.length, off }); off += h.length + nm.length + d.length;
    }
    const cd = []; let size = 0;
    for (const e of cen) {
      const h = new Uint8Array([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(e.c), ...u32(e.len), ...u32(e.len), ...u16(e.nm.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(e.off)]);
      cd.push(h, e.nm); size += h.length + e.nm.length;
    }
    const fin = new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(cen.length), ...u16(cen.length), ...u32(size), ...u32(off), ...u16(0)]);
    return new Blob([...partes, ...cd, fin], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  const x = s => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const col = n => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = (n - m - 1) / 26; } return s; };
  const txt = (r, c, v, s) => `<c r="${col(c)}${r}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${x(v)}</t></is></c>`;
  const num = (r, c, v, s) => `<c r="${col(c)}${r}" s="${s}"><v>${v}</v></c>`;
  const fx = (r, c, f, s) => `<c r="${col(c)}${r}" s="${s}"><f>${x(f)}</f></c>`;
  const fila = (r, celdas, h) => `<row r="${r}"${h ? ` ht="${h}" customHeight="1"` : ''}>${celdas.join('')}</row>`;
  const cols = ws => '<cols>' + ws.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('') + '</cols>';
  const hoja = (extra, cuerpo, tras) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>${extra}<sheetData>${cuerpo}</sheetData>${tras}<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/><pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>`;

  const ESTILOS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="8"><font><sz val="10"/><name val="Arial"/></font><font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Arial"/></font><font><b/><sz val="16"/><color rgb="FFF0DFC4"/><name val="Arial"/></font><font><sz val="10"/><color rgb="FFF0DFC4"/><name val="Arial"/></font><font><b/><sz val="10"/><color rgb="FF1E7B3A"/><name val="Arial"/></font><font><b/><sz val="10"/><color rgb="FFD3011D"/><name val="Arial"/></font><font><b/><sz val="10"/><color rgb="FF8A6D1F"/><name val="Arial"/></font><font><i/><sz val="9"/><color rgb="FF666666"/><name val="Arial"/></font></fonts>
<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF111111"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFD3011D"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FFD9CDB4"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="12"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="2" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="3" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="0" fontId="1" fillId="3" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>
<xf numFmtId="0" fontId="4" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>
<xf numFmtId="0" fontId="5" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>
<xf numFmtId="0" fontId="6" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>
<xf numFmtId="9" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>
<xf numFmtId="0" fontId="7" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="2" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf></cellXfs></styleSheet>`;
  const EST = { 'Asistió': 6, 'Falta': 7, 'Justificada': 8 }, MARCA = { '✓': 6, '✗': 7, 'J': 8 };
  const relleno = (r, T, estilo, texto) => [txt(r, 1, texto, estilo), ...Array.from({ length: T - 1 }, (_, i) => txt(r, i + 2, '', estilo))];

  /* Tabla tipo lista: No. | Nombre | una columna por fecha (o por asignatura) | totales con fórmulas */
  function hojaGrid(d) {
    const nv = d.valores.length, asist = d.tipo === 'asist', base = 2 + nv;
    const ex = asist ? ['Asistió', 'Faltas', 'Justificadas', '% asistencia'] : ['Promedio'], T = base + ex.length;
    let r = fila(1, relleno(1, T, 1, d.titulo), 28) + fila(2, relleno(2, T, 2, d.subtitulo));
    r += fila(4, ['No.', 'Nombre', ...d.valores, ...ex].map((h, i) => txt(4, i + 1, h, 3)), 24);
    d.filas.forEach((f, i) => {
      const n = 5 + i, a = col(3), b = col(base), cel = [num(n, 1, i + 1, 5), txt(n, 2, f[0], 4)];
      f[1].forEach((v, j) => cel.push(typeof v === 'number' ? num(n, 3 + j, v, 5) : txt(n, 3 + j, v, MARCA[v] || 5)));
      if (asist) {
        const A = col(base + 1), F = col(base + 2), J = col(base + 3), cnt = k => `COUNTIF(${a}${n}:${b}${n},"${k}")`;
        cel.push(fx(n, base + 1, cnt('✓'), 5), fx(n, base + 2, cnt('✗'), 5), fx(n, base + 3, cnt('J'), 5), fx(n, base + 4, `IFERROR((${A}${n}+${J}${n})/(${A}${n}+${F}${n}+${J}${n}),0)`, 9));
      } else cel.push(fx(n, base + 1, `IFERROR(AVERAGE(${a}${n}:${b}${n}),"")`, 11));
      r += fila(n, cel);
    });
    const ancho = [6, 32, ...Array(nv).fill(asist ? (nv > 12 ? 6.5 : 11) : 15), ...(asist ? [10, 9, 13, 14] : [12])];
    return hoja('<sheetViews><sheetView workbookViewId="0"><pane xSplit="2" ySplit="4" topLeftCell="C5" activePane="bottomRight" state="frozen"/></sheetView></sheetViews>' + cols(ancho), r,
      `<mergeCells count="2"><mergeCell ref="A1:${col(T)}1"/><mergeCell ref="A2:${col(T)}2"/></mergeCells>`);
  }
  /* Tabla simple con el detalle (hora, motivo...) */
  function hojaLista(titulo, cab, filas) {
    let r = fila(1, relleno(1, cab.length, 1, titulo), 28) + fila(3, cab.map((h, i) => txt(3, i + 1, h, 3)), 22);
    filas.forEach((f, i) => { const n = 4 + i; r += fila(n, f.map((v, j) => txt(n, j + 1, v === '' && j === 3 ? '—' : v, j === 5 ? (EST[f[5]] || 5) : (j === 2 || j === 3) ? 5 : 4))); });
    return hoja(cols([24, 24, 13, 9, 16, 14, 22]), r, `<autoFilter ref="A3:G${Math.max(3 + filas.length, 4)}"/><mergeCells count="1"><mergeCell ref="A1:G1"/></mergeCells>`);
  }
  function libro(hojas) {
    const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships', n = hojas.length;
    return zip([
      { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' + hojas.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>' },
      { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
      { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${R}"><sheets>${hojas.map((h, i) => `<sheet name="${x(h.nombre)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>` },
      { name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${hojas.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${R}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${n + 1}" Type="${R}/styles" Target="styles.xml"/></Relationships>` },
      { name: 'xl/styles.xml', data: ESTILOS },
      ...hojas.map((h, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: h.xml }))
    ]);
  }

  /* d: { titulo, subtitulo, fechas:['05/10',...], filas:[[nombre,[marcas]]], detalle:[[alumno,curp,fecha,hora,materia,estado,motivo]] } */
  const asistencias = d => libro([
    { nombre: 'Asistencias', xml: hojaGrid({ ...d, tipo: 'asist', valores: d.fechas }) },
    { nombre: 'Detalle', xml: hojaLista('Detalle · ' + d.titulo, ['Alumno', 'CURP', 'Fecha', 'Hora', 'Materia', 'Estado', 'Motivo'], d.detalle || []) }
  ]);
  /* d: { titulo, subtitulo, materias:[...], filas:[[nombre,[notas]]] } */
  const calificaciones = d => libro([{ nombre: 'Calificaciones', xml: hojaGrid({ ...d, tipo: 'prom', valores: d.materias }) }]);
  const api = { asistencias, calificaciones };
  if (typeof window !== 'undefined') window.SDExcel = api; else module.exports = api;
})();
