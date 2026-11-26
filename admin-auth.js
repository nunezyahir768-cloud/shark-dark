const crypto = require('node:crypto');

const huella = valor => crypto.createHash('sha256').update(valor, 'utf8').digest();

function areasCoincidentes(password, passwordsPorArea) {
    const candidata = huella(typeof password === 'string' ? password : '');
    return Object.entries(passwordsPorArea).map(([area, configurada]) => {
        const passwordConfigurada = typeof configurada === 'string' ? configurada : '';
        const coincide = crypto.timingSafeEqual(huella(passwordConfigurada), candidata);
        return { area, coincide: passwordConfigurada.length >= 4 && coincide };
    }).filter(resultado => resultado.coincide).map(resultado => resultado.area);
}

function areasDuplicadas(passwordsPorArea) {
    const porPassword = new Map();
    for (const [area, password] of Object.entries(passwordsPorArea)) {
        if (typeof password !== 'string' || password.length < 4) continue;
        const areas = porPassword.get(password) || [];
        areas.push(area);
        porPassword.set(password, areas);
    }
    return [...porPassword.values()].filter(areas => areas.length > 1);
}

module.exports = { areasCoincidentes, areasDuplicadas };
