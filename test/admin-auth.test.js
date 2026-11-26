const test = require('node:test');
const assert = require('node:assert/strict');
const { areasCoincidentes, areasDuplicadas } = require('../admin-auth');

const passwords = {
    control: 'control-secreto-123',
    sara: 'sara-secreto-456',
    gabriela: 'gabriela-secreto-789',
    portero: 'portero-secreto-012'
};

test('una contraseña administrativa identifica su única área sin recibirla del cliente', () => {
    for (const [area, password] of Object.entries(passwords)) {
        assert.deepEqual(areasCoincidentes(password, passwords), [area]);
    }
});

test('contraseñas no configuradas o menores al mínimo no autentican áreas', () => {
    assert.deepEqual(areasCoincidentes('incorrecta', passwords), []);
    assert.deepEqual(areasCoincidentes('abc', { control: 'abc', sara: '', gabriela: null }), []);
});

test('una contraseña compartida coincide con todas las áreas y no se elige una al azar', () => {
    const configuracion = { ...passwords, sara: passwords.control };
    assert.deepEqual(areasCoincidentes(passwords.control, configuracion), ['control', 'sara']);
    assert.deepEqual(areasDuplicadas(configuracion), [['control', 'sara']]);
});

test('valores vacíos o demasiado cortos no se reportan como duplicados configurados', () => {
    assert.deepEqual(areasDuplicadas({ control: '', sara: 'abc', portero: 'abc' }), []);
});
