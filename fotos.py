# -*- coding: utf-8 -*-
"""Baixa as fotos do Wikimedia Commons e grava dois tamanhos WebP + placeholder.

Uso:  pip install Pillow
      python fotos.py

Produz, dentro de fotos/:
  <chave>-lg.webp        1800px, usada no papel de parede, no hero e no timelapse
  <chave>-sm.webp         720px, usada nas miniaturas dos dias e nos cards
  creditos.json           legenda, autor, licenca e o placeholder borrado em base64
  paradas/<data>-<id>.webp  620px, a foto de cada parada dos mapas do dia
  paradas.json            os mesmos creditos, por parada

As fotos das paradas saem de mapa/pontos.json: toda parada com "foto" e baixada.
O valor pode ser um termo de busca ("Dotonbori night Osaka") ou um arquivo exato
("File:Osaka Dotonbori Ebisu Bridge.jpg"). Com termo o script escolhe o primeiro
resultado paisagem grande o bastante e IMPRIME o que escolheu — confira e, quando
alguma vier ruim, troque o termo pelo File: certo e rode de novo.

Para trocar por fotos proprias depois da viagem, nao precisa deste script: basta
gravar os arquivos com os mesmos nomes e atualizar creditos.json na mao.
"""
import base64, io, json, os, re, urllib.parse, urllib.request
from PIL import Image, ImageFilter

BASE = os.path.dirname(os.path.abspath(__file__))
DEST = os.path.join(BASE, 'fotos')
# A Wikimedia pede um contato no User-Agent e aceita uma URL. Usamos a do repositorio
# para nao deixar e-mail pessoal em codigo publico; para responder por e-mail, basta
# exportar CONTATO_COMMONS antes de rodar.
CONTATO = os.environ.get('CONTATO_COMMONS',
                         'https://github.com/durthvader/japao-2027')
UA = {'User-Agent': 'japao2027-site/1.0 (%s)' % CONTATO}

# chave -> (arquivo no Commons, legenda usada no credito)
ESCOLHA = {
    'hero':  ('Fuji Kawaguchi 457.JPG',
              'Monte Fuji refletido no lago Kawaguchi'),
    'fuji':  ('Chuurei-tou Fujiyoshida 33415029934 8bdb607294 o.jpg',
              'Pagode Chureito, o Fuji e a sakura'),
    'osaka': ('Osaka Dotonbori Ebisu Bridge.jpg',
              'Dotonbori visto da ponte Ebisu'),
    'kyoto': ('Fushimi-Inari-Shrine-Senbon-Torii-2016-Luka-Peternel.jpg',
              'O tunel de torii de Fushimi Inari'),
    'tokyo': ('Tokyo Shibuya Scramble Crossing 2018-10-09.jpg',
              'O cruzamento de Shibuya na hora azul'),
}


PARADAS_JSON = os.path.join(BASE, 'mapa', 'pontos.json')
DEST_PAR = os.path.join(DEST, 'paradas')


def limpa(html):
    return re.sub(r'<[^>]+>', '', html or '').strip()


def consultar(titulos, largura):
    """Metadados e URL de thumbnail para varios arquivos do Commons de uma vez."""
    q = urllib.parse.urlencode({
        'action': 'query', 'format': 'json',
        'titles': '|'.join('File:' + t for t in titulos),
        'prop': 'imageinfo', 'iiprop': 'url|size|extmetadata',
        'iiurlwidth': str(largura)})
    req = urllib.request.Request('https://commons.wikimedia.org/w/api.php?' + q, headers=UA)
    dados = json.load(urllib.request.urlopen(req, timeout=60))
    saida = {}
    for pag in dados['query']['pages'].values():
        if 'imageinfo' not in pag:
            raise SystemExit('nao encontrado no Commons: ' + pag.get('title', '?'))
        ii = pag['imageinfo'][0]
        em = ii.get('extmetadata', {})
        saida[pag['title'].replace('File:', '')] = {
            'thumb': ii['thumburl'],
            'lic': limpa(em.get('LicenseShortName', {}).get('value', '')),
            'licurl': limpa(em.get('LicenseUrl', {}).get('value', '')),
            'autor': limpa(em.get('Artist', {}).get('value', '')),
            'pagina': 'https://commons.wikimedia.org/wiki/'
                      + urllib.parse.quote(pag['title'].replace(' ', '_'))}
    return saida


def buscar(termo, largura):
    """Primeiro resultado utilizavel do Commons para um termo de busca."""
    q = urllib.parse.urlencode({
        'action': 'query', 'format': 'json',
        'generator': 'search', 'gsrsearch': 'filetype:bitmap ' + termo,
        'gsrnamespace': '6', 'gsrlimit': '12',
        'prop': 'imageinfo', 'iiprop': 'url|size|extmetadata',
        'iiurlwidth': str(largura)})
    req = urllib.request.Request('https://commons.wikimedia.org/w/api.php?' + q, headers=UA)
    dados = json.load(urllib.request.urlopen(req, timeout=60))
    pags = (dados.get('query') or {}).get('pages') or {}
    # a busca devolve fora de ordem; 'index' e a posicao real do resultado
    for pag in sorted(pags.values(), key=lambda x: x.get('index', 99)):
        ii = (pag.get('imageinfo') or [None])[0]
        if not ii:
            continue
        # descarta retrato e imagem pequena: o encaixe do card e 16:9
        if ii['width'] < 900 or ii['width'] < ii['height']:
            continue
        em = ii.get('extmetadata', {})
        return {'titulo': pag['title'].replace('File:', ''), 'thumb': ii['thumburl'],
                'lic': limpa(em.get('LicenseShortName', {}).get('value', '')),
                'licurl': limpa(em.get('LicenseUrl', {}).get('value', '')),
                'autor': limpa(em.get('Artist', {}).get('value', '')),
                'pagina': 'https://commons.wikimedia.org/wiki/'
                          + urllib.parse.quote(pag['title'].replace(' ', '_'))}
    return None


def lqip_de(im):
    """Miniatura borrada de 22px embutida em base64: pinta antes de a foto chegar."""
    t = im.copy()
    t.thumbnail((22, 66), Image.LANCZOS)
    t = t.filter(ImageFilter.GaussianBlur(1.2))
    buf = io.BytesIO()
    t.save(buf, 'WEBP', quality=42)
    return 'data:image/webp;base64,' + base64.b64encode(buf.getvalue()).decode()


def paradas():
    """Uma foto para cada parada marcada com "foto" em mapa/pontos.json."""
    if not os.path.exists(PARADAS_JSON):
        return
    geo = json.load(io.open(PARADAS_JSON, encoding='utf-8'))
    alvo = os.path.join(DEST, 'paradas.json')
    saida = json.load(io.open(alvo, encoding='utf-8')) if os.path.exists(alvo) else {}
    os.makedirs(DEST_PAR, exist_ok=True)
    total = 0
    for data, dia in geo.items():
        if not isinstance(dia, dict) or 'paradas' not in dia:
            continue
        # As alternativas entram na mesma rodada. A que aponta para um lugar novo ('ponto')
        # ganha foto propria, com chave '<data>-alt<n>'; o termo pode vir de um 'foto' na
        # mao ou, na falta dele, do proprio 'gmaps', que ja e um nome de lugar. A que so
        # mexe em paradas existentes ('refs') nao baixa nada: a pagina reaproveita a foto
        # da parada referida.
        alts = []
        for n, a in enumerate(dia.get('alternativas', [])):
            pt = a.get('ponto') or {}
            t = pt.get('foto') or pt.get('gmaps')
            if t:
                alts.append({'id': 'alt%d' % n, 'foto': t})
        for par in list(dia['paradas']) + alts:
            termo = par.get('foto')
            if not termo:
                continue
            chave = '%s-%s' % (data, par['id'])
            nome = 'paradas/%s.webp' % chave
            if saida.get(chave, {}).get('termo') == termo and                os.path.exists(os.path.join(DEST, nome)):
                continue                       # ja baixada, e o termo nao mudou
            if termo.startswith('File:'):
                m = consultar([termo[5:]], 1400)[termo[5:]]
                m['titulo'] = termo[5:]
            else:
                m = buscar(termo, 1400)
            if not m:
                print('  ! sem foto para %s (%s)' % (chave, termo))
                continue
            req = urllib.request.Request(m['thumb'], headers=UA)
            im = Image.open(io.BytesIO(urllib.request.urlopen(req, timeout=120).read()))
            im = im.convert('RGB')
            c = im.copy()
            c.thumbnail((620, 620), Image.LANCZOS)
            c.save(os.path.join(DEST, nome), 'WEBP', quality=64, method=6)
            kb = os.path.getsize(os.path.join(DEST, nome)) // 1024
            total += kb
            saida[chave] = {'termo': termo, 'arq': nome, 'titulo': m['titulo'],
                            'autor': m['autor'], 'lic': m['lic'], 'licurl': m['licurl'],
                            'pagina': m['pagina'], 'lqip': lqip_de(im)}
            print('  %-22s %3dKB  %s' % (par['id'], kb, m['titulo']))
    with io.open(alvo, 'w', encoding='utf-8') as f:
        json.dump(saida, f, ensure_ascii=False, indent=1)
    print('paradas: %d fotos, +%d KB nesta rodada' % (len(saida), total))


def main():
    os.makedirs(DEST, exist_ok=True)
    meta = consultar([t for t, _ in ESCOLHA.values()], 2400)
    creditos = {}

    for chave, (titulo, legenda) in ESCOLHA.items():
        m = meta[titulo]
        req = urllib.request.Request(m['thumb'], headers=UA)
        im = Image.open(io.BytesIO(urllib.request.urlopen(req, timeout=120).read())).convert('RGB')

        def grava(nome, larg, q):
            c = im.copy()
            c.thumbnail((larg, larg * 3), Image.LANCZOS)
            caminho = os.path.join(DEST, nome)
            c.save(caminho, 'WEBP', quality=q, method=6)
            return os.path.getsize(caminho) // 1024

        kb_lg = grava('%s-lg.webp' % chave, 1800, 70)
        kb_sm = grava('%s-sm.webp' % chave, 720, 68)

        lqip = lqip_de(im)

        creditos[chave] = {'legenda': legenda, 'autor': m['autor'], 'lic': m['lic'],
                           'licurl': m['licurl'], 'pagina': m['pagina'], 'lqip': lqip}
        print('%-6s lg=%3dKB  sm=%3dKB  %s' % (chave, kb_lg, kb_sm, m['lic']))

    with io.open(os.path.join(DEST, 'creditos.json'), 'w', encoding='utf-8') as f:
        json.dump(creditos, f, ensure_ascii=False, indent=1)
    # as fotos das paradas dos mapas do dia saem na mesma rodada
    paradas()

    total = sum(os.path.getsize(os.path.join(DEST, f))
                for f in os.listdir(DEST) if f.endswith('.webp'))
    print('\ntotal em fotos/: %d KB — rode gerar_site.py em seguida' % (total // 1024))


if __name__ == '__main__':
    main()
