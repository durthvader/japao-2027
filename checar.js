/* Confere as paginas geradas antes de publicar.
 *
 *     node checar.js
 *
 * Olha o que o gerar_site.py nao tem como ver: se o JavaScript embutido realmente
 * roda, se alguma perna do mapa aponta para uma parada que nao existe, se duas
 * paradas do mesmo dia acabaram com a mesma foto, se algum card de alternativa
 * ficou sem destino, e se sobrou bastidor ou nome pessoal dentro do HTML.
 *
 * Sai com codigo 1 se achar qualquer coisa — da para pendurar num hook.
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BASE = __dirname;
let problemas = 0;

function aviso(arq, msg) {
  console.log('  ! ' + arq + ': ' + msg);
  problemas++;
}

/* A constante termina em "};" que pode ter um comentario na mesma linha. */
function constante(html, nome) {
  const re = new RegExp('const ' + nome + '\\s*=\\s*(\\{[\\s\\S]*?\\});[ \\t]*(?:\\/\\/[^\\n]*)?\\n');
  const m = html.match(re);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch (e) {
    return { __erro: e.message };
  }
}

const PAGINAS_SITE = ['index.html', 'numeros.html', 'mapa.html', 'timelapse.html', 'roteiro.html', 'comer.html', 'compras.html', 'planob.html', 'logistica.html'];
const paginas = fs.readdirSync(BASE)
  .filter(f => /^dia-\d\d\.html$/.test(f) || PAGINAS_SITE.includes(f))
  .sort();

for (const arq of paginas) {
  const html = fs.readFileSync(path.join(BASE, arq), 'utf8');

  // 1) o JavaScript embutido compila?
  const scripts = [...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/g)];
  scripts.forEach((m, i) => {
    try {
      new vm.Script(m[1]);
    } catch (e) {
      aviso(arq, 'script ' + i + ' nao compila — ' + e.message);
    }
  });

  // 2) nada de bastidor nem de nome pessoal
  for (const termo of ['"motivo"', '"ajustes"', '"ajuste"', 'Rogerio', 'Rogério',
                       'Gilson', 'Thiago', 'rogeriof86', 'você anotou', 'sua lista']) {
    if (html.includes(termo)) aviso(arq, 'texto que nao devia estar publicado: ' + termo);
  }

  if (PAGINAS_SITE.includes(arq)) {
    console.log(arq.padEnd(16) + ' ' + scripts.length + ' script(s), '
      + (html.length / 1024).toFixed(0) + ' KB');
    continue;
  }

  // 3) o mapa fecha?
  const geo = constante(html, 'GEO');
  const fotos = constante(html, 'FOTOS') || {};
  if (!geo || geo.__erro) {
    aviso(arq, 'GEO ilegivel — ' + (geo ? geo.__erro : 'nao encontrado'));
    continue;
  }

  const ids = new Set(geo.paradas.map(p => p.id));
  for (const g of geo.pernas) {
    for (const lado of ['de', 'para']) {
      if (!ids.has(g[lado])) aviso(arq, 'perna aponta para parada inexistente: ' + g[lado]);
    }
  }

  for (const a of geo.alternativas || []) {
    if (!a.refs && !a.ponto) aviso(arq, 'alternativa sem destino: ' + a.titulo);
    for (const r of a.refs || []) {
      if (!ids.has(r)) aviso(arq, 'alternativa aponta para parada inexistente: ' + r);
    }
  }

  // duas paradas do mesmo dia com a mesma foto ficam esquisitas na pagina
  const arqs = Object.values(fotos).map(x => x.arq);
  const dup = arqs.filter((a, i) => arqs.indexOf(a) !== i);
  if (dup.length) aviso(arq, 'foto repetida no mesmo dia: ' + [...new Set(dup)].join(', '));

  // a saida e o "0"; as paradas de verdade tem que numerar sem buraco
  const reais = geo.paradas.filter(p => p.ai != null && p.tipo !== 'base').length;

  console.log(arq.padEnd(13) + ' paradas=' + String(geo.paradas.length).padEnd(3)
    + ' pinos=0..' + String(reais).padEnd(2)
    + ' pernas=' + String(geo.pernas.length).padEnd(3)
    + ' alternativas=' + String((geo.alternativas || []).length).padEnd(2)
    + ' fotos=' + arqs.length);
}

console.log(problemas ? '\n' + problemas + ' problema(s)' : '\nnada a apontar');
process.exit(problemas ? 1 : 0);
