# -*- coding: utf-8 -*-
"""Gera index.html (a partir de template.html + dados.json) e um dia-NN.html
para cada dia que tiver camada geografica em mapa/pontos.json.

Uso:  python gerar_site.py
Reextrai a planilha sozinho se ela estiver mais nova que dados.json.
"""
import os, io, json, subprocess, sys
if sys.stdout and hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

BASE = os.path.dirname(os.path.abspath(__file__))
XLSX = os.path.join(os.path.dirname(BASE), 'Roteiro Japão.xlsx')
DADOS = os.path.join(BASE, 'dados.json')
TPL = os.path.join(BASE, 'template.html')
GEO_F = os.path.join(BASE, 'mapa', 'pontos.json')
DTPL = os.path.join(BASE, 'dia_template.html')
OUT = os.path.join(BASE, 'index.html')

if not os.path.exists(DADOS) or os.path.getmtime(XLSX) > os.path.getmtime(DADOS):
    print('planilha mudou — reextraindo...')
    subprocess.run([sys.executable, os.path.join(BASE, 'extrair.py')], check=True)

dados = io.open(DADOS, encoding='utf-8').read()
fotos = io.open(os.path.join(BASE, 'fotos', 'creditos.json'), encoding='utf-8').read()
tpl = io.open(TPL, encoding='utf-8').read()
# dados.json e o extrato cru da planilha; as decisoes tomadas depois vivem em
# ajustes.json e entram aqui, em memoria. dados.json nunca e reescrito.
import ajustes
djs = ajustes.aplicar(json.loads(dados))

# O payload vai inteiro para dentro do HTML, entao o que nao e para o grupo ler nao
# pode nem chegar la: 'motivo' e a justificativa de cada decisao e 'ajuste'/'ajustes'
# sao o historico de edicao. Ficam no ajustes.json, aqui no disco.
BASTIDOR = ('motivo', 'ajuste', 'ajustes')


def podar(o):
    if isinstance(o, dict):
        return dict((k, podar(v)) for k, v in o.items() if k not in BASTIDOR)
    if isinstance(o, list):
        return [podar(x) for x in o]
    return o
# mapa/lista.json e documento de trabalho, como o ajustes.json: a analise dos lugares
# salvos no Google Maps mora la e NAO entra no site. O que for aprovado vira parada de
# verdade por uma operacao em ajustes.json, escrita para quem le o roteiro.
dados = json.dumps(podar(djs), ensure_ascii=False, indent=1)

DESC = ('Roteiro completo da viagem ao Japao em marco de 2027: 16 dias entre Osaka, Kyoto, '
        'Kawaguchiko e Tokyo, com 82 paradas, distancias, custos, mapa, restaurantes, '
        'compras e plano B.')
ICON = ("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'"
        "%3E%3Ctext y='26' font-size='26'%3E%F0%9F%97%BB%3C/text%3E%3C/svg%3E")

def montar(pagina, head_extra):
    """Corta o template em <head> (title + style) e <body> e embrulha no documento."""
    corte = pagina.index('</style>') + len('</style>')
    cabeca, corpo = pagina[:corte].strip(), pagina[corte:].strip()
    return f'''<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
{head_extra}
<meta name="theme-color" content="#EDEEF1" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0A0D13" media="(prefers-color-scheme: dark)">
<meta name="color-scheme" content="light dark">
<meta name="robots" content="noindex, nofollow">
<link rel="icon" href="{ICON}">
<script>try{{var _th=localStorage.getItem("jp27_theme")||localStorage.getItem("jp27tema")||localStorage.getItem("tema-japao");if(_th)document.documentElement.setAttribute("data-theme",_th);}}catch(e){{}}</script>
{cabeca}
</head>
<body>
{corpo}
</body>
</html>
'''

# ------------------------------------------------- mapas do dia (dia-NN.html)
# Cada pagina sai autocontida, com os dados embutidos: funciona no GitHub Pages
# e tambem aberta direto do disco, sem servidor.
mapeados = []
if os.path.exists(GEO_F) and os.path.exists(DTPL):
    geo = json.loads(io.open(GEO_F, encoding='utf-8').read())
    tokens = tpl[tpl.index('/* ============ TOKENS'):
                 tpl.index('/* ============ PAPEL DE PAREDE')].strip()
    dtpl = io.open(DTPL, encoding='utf-8').read()
    fpar_f = os.path.join(BASE, 'fotos', 'paradas.json')
    fpar = json.loads(io.open(fpar_f, encoding='utf-8').read()) if os.path.exists(fpar_f) else {}
    dias_list = djs['dias']
    for n, dia in enumerate(dias_list, 1):
        g = geo.get(dia['data'])
        if not g:
            continue
        # 'ativ' e um pedaco do nome da atividade; vira indice aqui, para o mapa
        # nao depender da posicao dela na planilha.
        for par in g['paradas']:
            if 'ativ' not in par:
                continue
            achou = [k for k, a in enumerate(dia['atividades'])
                     if par['ativ'].lower() in a['nome'].lower()]
            if not achou:
                raise SystemExit('mapa %s: nao achei a atividade "%s"'
                                 % (dia['data'], par['ativ']))
            par['ai'] = achou[0]

        # Navegacao dia anterior / proximo dia
        prev_btn = ""
        prev_card = ""
        if n > 1:
            p_dia = dias_list[n - 2]
            p_data = p_dia['data']
            if p_data in geo:
                p_url = 'dia-%02d.html' % (n - 1)
                p_tit = geo[p_data]['titulo']
            else:
                p_url = 'index.html#dia%d' % (n - 1)
                p_tit = 'Dia %d · %s' % (n - 1, p_dia.get('cidade', '').title())
            prev_btn = (
                f'<a class="btn-dia prev" href="{p_url}" title="Dia anterior: {p_tit}">'
                f'<b>‹ D{n-1:02d}</b></a>'
            )
            prev_card = (
                f'<a class="nav-dia-card prev" href="{p_url}">'
                f'<div class="ndc-sub">‹ DIA ANTERIOR · DIA {n-1}</div>'
                f'<div class="ndc-tit"><span>{p_tit}</span></div>'
                f'</a>'
            )

        next_btn = ""
        next_card = ""
        if n < len(dias_list):
            nx_dia = dias_list[n]
            nx_data = nx_dia['data']
            if nx_data in geo:
                nx_url = 'dia-%02d.html' % (n + 1)
                nx_tit = geo[nx_data]['titulo']
            else:
                nx_url = 'index.html#dia%d' % (n + 1)
                nx_tit = 'Dia %d · %s' % (n + 1, nx_dia.get('cidade', '').title())
            next_btn = (
                f'<a class="btn-dia next" href="{nx_url}" title="Próximo dia: {nx_tit}">'
                f'<span>Próximo dia</span> <b>D{n+1:02d} ›</b></a>'
            )
            next_card = (
                f'<a class="nav-dia-card next" href="{nx_url}">'
                f'<div class="ndc-sub">PRÓXIMO DIA · DIA {n+1} DE {len(dias_list)}</div>'
                f'<div class="ndc-tit"><span>{nx_tit}</span> <span class="ndc-arr">→</span></div>'
                f'</a>'
            )

        topo_nav = f'{prev_btn}{next_btn}'
        tem_ambos = ' tem-ambos' if (prev_card and next_card) else ''
        fim_dia_nav = f'<div class="painel-dia-nav{tem_ambos}">{prev_card}{next_card}</div>' if (prev_card or next_card) else ''

        pag = (dtpl.replace('__TOKENS__', tokens)
                   .replace('__TITULO__', g['titulo'])
                   .replace('__CIDADE__', dia['cidade'])
                   .replace('__NDIA__', str(n))
                   .replace('__TOPO_NAV__', topo_nav)
                   .replace('__FIM_DIA_NAV__', fim_dia_nav)
                   .replace('__DIA__', json.dumps(podar(dia), ensure_ascii=False))
                   .replace('__GEO__', json.dumps(g, ensure_ascii=False))
                   .replace('__FOTOS__', json.dumps(
                       {k.split('-', 3)[3]: v for k, v in fpar.items()
                        if k.startswith(dia['data'] + '-')}, ensure_ascii=False)))
        head = ('<meta name="description" content="Mapa do dia %d da viagem ao Japao: %s.">'
                % (n, g['titulo']))
        alvo = os.path.join(BASE, 'dia-%02d.html' % n)
        io.open(alvo, 'w', encoding='utf-8', newline='\n').write(montar(pag, head))
        mapeados.append(n)
        print('OK  dia-%02d.html  %s bytes' % (n, os.path.getsize(alvo)))

# ------------------------------------------------------------------- index
for marca in ('__DADOS__', '__FOTOS__', '__MAPAS__'):
    assert marca in tpl, 'template.html perdeu o marcador ' + marca
tpl = (tpl.replace('__DADOS__', dados)
          .replace('__FOTOS__', fotos)
          .replace('__MAPAS__', json.dumps(mapeados)))

head = f'''<meta name="description" content="{DESC}">
<meta property="og:type" content="website">
<meta property="og:title" content="Japao 2027 — 16 dias de Osaka a Tokyo">
<meta property="og:description" content="{DESC}">
<meta property="og:locale" content="pt_BR">
<link rel="apple-touch-icon" href="{ICON}">'''

io.open(OUT, 'w', encoding='utf-8', newline='\n').write(montar(tpl, head))
print('OK  index.html  {:,} bytes'.format(os.path.getsize(OUT)).replace(',', '.'))
