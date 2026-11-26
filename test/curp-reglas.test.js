const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// Extrae la regla real de server.js y la prueba con una base simulada.
const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8').replace(/\r\n/g, '\n');
const trozo = src.slice(src.indexOf('const conflictoCurp'), src.indexOf('const textoConflicto'));
const db = [{ _id: 'docente:AAA', rol: 'docente', curp: 'AAA' }, { _id: 'alumno:BBB', rol: 'alumno', curp: 'BBB' }, { _id: 'tutor:CCC', rol: 'tutor', curp: 'CCC' }];
const usuarios = { findOne: async q => db.find(d => d._id === q._id) || null, find: q => ({ toArray: async () => db.filter(d => d.curp === q.curp) }) };
const conflictoCurp = eval('(' + trozo.replace('const conflictoCurp = ', '').trim().replace(/;$/, '') + ')');

const casos = [
  ['un docente puede tener además su cuenta de tutor', 'tutor', 'AAA', false],
  ['un tutor puede tener además su cuenta de docente', 'docente', 'CCC', false],
  ['no se repite un docente', 'docente', 'AAA', true],
  ['no se repite un tutor', 'tutor', 'CCC', true],
  ['no se repite un alumno', 'alumno', 'BBB', true],
  ['un alumno no comparte CURP con un docente', 'alumno', 'AAA', true],
  ['un docente no comparte CURP con un alumno', 'docente', 'BBB', true],
  ['un tutor no comparte CURP con un alumno', 'tutor', 'BBB', true],
  ['una CURP nueva se acepta', 'alumno', 'ZZZ', false]
];
for (const [nombre, rol, curp, hayChoque] of casos) {
  test(nombre, async () => assert.strictEqual(!!(await conflictoCurp(rol, curp)), hayChoque));
}
