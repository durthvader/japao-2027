# -*- coding: utf-8 -*-
"""Aplica ajustes.json sobre os dados extraidos da planilha.

dados.json e o extrato cru do .xlsx e nunca e editado a mao. As decisoes tomadas
depois — mover uma parada de dia, cortar uma repeticao, inverter uma ordem — vivem
em ajustes.json e sao aplicadas aqui, em memoria, na hora de gerar o site. Assim a
planilha pode ser reextraida a vontade sem perder nada.

Operacoes:
  mover       nome, de, para (ou null para cortar), periodo, posicao, campos
  acrescentar dia, posicao, atividade — parada nova, que nao vem da planilha
  corrigir    dia, nome, campos — conserta a perna de uma parada que ficou orfa
  reatribuir  troca — permuta o programa inteiro entre dias, mantendo a data e a base
  reordenar   dia, ordem (lista de pedacos de nome), periodos, campos
  nota        dia, texto — so registra a analise, nao mexe no roteiro

Alem das operacoes, ajustes.json traz uma lista "limpeza": pares de troca aplicados a
todo texto que o site mostra. Serve para tirar as marcas de edicao que sobraram na
planilha ("RECUPERADO da sua lista original", "Sua planilha ja marca 17:00") — bastidor
de quem montou o roteiro, que nao interessa a quem le. Conselho em segunda pessoa para
quem viaja ("voces vao precisar de reserva") nao e disso e fica.

'campos' corrige os dados da perna. Distancia, tempo e custo de uma atividade sao
sempre "de onde eu vinha ate aqui": ao mudar a parada de lugar esses numeros passam
a descrever um trajeto que nao existe mais, e precisam ser reescritos junto.

Toda atividade tocada ganha um campo 'ajuste' com o motivo, que o site mostra.
"""
import io, json, os, re

BASE = os.path.dirname(os.path.abspath(__file__))
ARQ = os.path.join(BASE, 'ajustes.json')


def _acha(dia, pedaco):
    for i, a in enumerate(dia['atividades']):
        if pedaco.lower() in a['nome'].lower():
            return i
    return None


def _por_data(dados, data):
    for d in dados['dias']:
        if d['data'] == data:
            return d
    raise SystemExit('ajustes.json aponta para um dia que nao existe: ' + str(data))


# a planilha converte a Y1 = R$ 0,033; a nota em reais tem que usar a mesma taxa
TAXA_IENE = 0.033


def _recalcular(dia):
    """Refaz o total do dia somando as atividades.

    As distancias sao por perna ('de X ate Y'), entao ao mover uma parada de dia o
    numero que ela carrega e o da vizinhanca antiga. O total volta a fechar com a
    soma, e o dia fica marcado para o site avisar que as pernas mudaram de contexto.
    """
    t = dia.setdefault('total', {})
    for campo in ('km', 'min', 'pe', 'transp', 'ingresso'):
        t[campo] = round(sum(a.get(campo, 0) or 0 for a in dia['atividades']), 2)


def aplicar(dados, verboso=True):
    if not os.path.exists(ARQ):
        return dados
    bruto = json.loads(io.open(ARQ, encoding='utf-8').read())
    ops = bruto['operacoes']
    notas = []

    for op in ops:
        tipo = op['tipo']

        if tipo == 'nota':
            dia = _por_data(dados, op['dia'])
            dia.setdefault('ajustes', []).append({'texto': op['texto'], 'tipo': 'nota'})
            notas.append((op['dia'], 'nota'))
            continue

        if tipo == 'acrescentar':
            dia = _por_data(dados, op['dia'])
            ativ = dict(op['atividade'])
            ativ['ajuste'] = {'motivo': op['motivo'], 'de': None, 'para': op['dia']}
            pos = op.get('posicao')
            if pos is None:
                dia['atividades'].append(ativ)
            else:
                dia['atividades'].insert(pos, ativ)
            _recalcular(dia)
            dia.setdefault('ajustes', []).append(
                {'texto': op['motivo'], 'tipo': 'entrou', 'nome': ativ['nome']})
            notas.append((op['dia'], 'acrescentar ' + ativ['nome']))
            continue

        if tipo == 'reatribuir':
            # troca o programa de lugar entre dias. So a lista de atividades e o total
            # viajam; data, base e cidade ficam onde estao. Vale para dias na mesma
            # cidade — trocar um dia de Tokyo com um de Osaka nao faria sentido.
            troca = op['troca']
            guardado = {}
            for origem in troca:
                d0 = _por_data(dados, origem)
                guardado[origem] = (d0['atividades'], d0.get('total', {}), d0.get('ajustes', []))
            bases = {_por_data(dados, x)['base'] for x in list(troca) + list(troca.values())}
            if len(bases) > 1:
                raise SystemExit('reatribuir so entre dias da mesma base: ' + str(bases))
            for origem, destino in troca.items():
                d1 = _por_data(dados, destino)
                d1['atividades'], d1['total'], d1['ajustes'] = guardado[origem]
            for origem, destino in troca.items():
                notas.append((origem, 'programa vai para %s' % destino))
            continue

        if tipo == 'corrigir':
            dia = _por_data(dados, op['dia'])
            i = _acha(dia, op['nome'])
            if i is None:
                raise SystemExit('nao achei "%s" no dia %s' % (op['nome'], op['dia']))
            dia['atividades'][i].update(op['campos'])
            _recalcular(dia)
            notas.append((op['dia'], 'corrigir ' + op['nome']))
            continue

        if tipo == 'mover':
            origem = _por_data(dados, op['de'])
            i = _acha(origem, op['nome'])
            if i is None:
                raise SystemExit('nao achei "%s" no dia %s' % (op['nome'], op['de']))
            ativ = origem['atividades'].pop(i)
            ativ.update(op.get('campos') or {})
            ativ['ajuste'] = {'motivo': op['motivo'], 'de': op['de'], 'para': op.get('para')}
            origem.setdefault('ajustes', []).append(
                {'texto': op['motivo'], 'tipo': 'saiu', 'nome': ativ['nome']})
            _recalcular(origem)

            if op.get('para'):                      # null = cortado de vez
                destino = _por_data(dados, op['para'])
                if op.get('periodo'):
                    ativ['periodo'] = op['periodo']
                pos = op.get('posicao')
                if pos is None:
                    destino['atividades'].append(ativ)
                else:
                    destino['atividades'].insert(pos, ativ)
                destino.setdefault('ajustes', []).append(
                    {'texto': op['motivo'], 'tipo': 'entrou', 'nome': ativ['nome']})
                _recalcular(destino)
            notas.append((op['de'], 'mover %s -> %s' % (op['nome'], op.get('para') or 'CORTADO')))
            continue

        if tipo == 'reordenar':
            dia = _por_data(dados, op['dia'])
            idx = []
            for pedaco in op['ordem']:
                i = _acha(dia, pedaco)
                if i is None:
                    raise SystemExit('nao achei "%s" no dia %s' % (pedaco, op['dia']))
                idx.append(i)
            movidas = [dia['atividades'][i] for i in idx]
            resto = [a for j, a in enumerate(dia['atividades']) if j not in idx]
            for pedaco, a in zip(op['ordem'], movidas):
                novo = (op.get('periodos') or {}).get(pedaco)
                if novo:
                    a['periodo'] = novo
                a.update((op.get('campos') or {}).get(pedaco) or {})
                a['ajuste'] = {'motivo': op['motivo'], 'de': op['dia'], 'para': op['dia']}
            # as reordenadas entram no lugar da primeira delas, na ordem pedida
            corte = min(idx) if idx else 0
            dia['atividades'] = resto[:corte] + movidas + resto[corte:]
            _recalcular(dia)          # 'campos' reescreveu as pernas: o total tem que seguir
            dia.setdefault('ajustes', []).append({'texto': op['motivo'], 'tipo': 'ordem'})
            notas.append((op['dia'], 'reordenar'))
            continue

        raise SystemExit('ajustes.json: tipo desconhecido "%s"' % tipo)

    # A nota em reais da planilha e uma frase congelada: quando uma correcao muda a
    # tarifa de um trecho, o total e refeito mas o "R$ ..." continua o antigo. Aqui
    # o valor volta a seguir o total, na mesma taxa declarada na planilha
    # (Y1 = R$ 0,033), e de quebra some o zero a esquerda do "R$ 064".
    for d in dados['dias']:
        nota = d.get('total', {}).get('nota')
        if not nota or 'R$' not in nota:
            continue
        iene = (d['total'].get('transp') or 0) + (d['total'].get('ingresso') or 0)
        reais = int(round(iene * TAXA_IENE))
        texto = '{:,}'.format(reais).replace(',', '.')
        d['total']['nota'] = re.sub(r'R\$ ?[\d.]+', 'R$ ' + texto, nota, count=1)

    # limpeza de texto: vale para atividade, nota e observacao de voo
    trocas = bruto.get('limpeza') or []
    if trocas:
        nao_usadas = {de for de, _ in trocas}
        def limpar(txt):
            for de, para in trocas:
                if de in txt:
                    nao_usadas.discard(de)
                    txt = txt.replace(de, para)
            return txt
        for d in dados['dias']:
            for a in d['atividades']:
                for campo in ('nome', 'obs', 'terreno', 'como'):
                    if a.get(campo):
                        a[campo] = limpar(a[campo])
            if d.get('total', {}).get('nota'):
                d['total']['nota'] = limpar(d['total']['nota'])
        for x in dados.get('notas', []):
            x['titulo'], x['texto'] = limpar(x['titulo']), limpar(x['texto'])
        for x in dados.get('voosNotas', []):
            x['titulo'], x['texto'] = limpar(x['titulo']), limpar(x['texto'])
        for x in dados.get('voos', []):
            if x.get('obs'):
                x['obs'] = limpar(x['obs'])
        if nao_usadas and verboso:
            print('limpeza: %d trocas sem uso (a planilha mudou?)' % len(nao_usadas))
            for t in sorted(nao_usadas):
                print('   nao achei: %s' % t[:70])

    # O periodo manda na leitura do dia. 'Dia todo' precisa estar aqui: sem ele
    # caia no balde 9 e ia parar DEPOIS da noite — foi o que punha a volta do
    # DisneySea antes da propria visita ao parque. Periodo desconhecido agora
    # avisa em vez de sumir para o fim da lista em silencio.
    ORDEM = {'Manhã': 0, 'Dia todo': 1, 'Tarde': 2, 'Noite': 3}
    desconhecidos = {a.get('periodo') for d in dados['dias'] for a in d['atividades']
                     if a.get('periodo') not in ORDEM}
    if desconhecidos and verboso:
        print('ajustes: periodo fora da ordem conhecida, vai para o fim do dia: %s'
              % ', '.join(repr(x) for x in sorted(desconhecidos, key=str)))
    for d in dados['dias']:
        d['atividades'].sort(key=lambda a: ORDEM.get(a.get('periodo'), 9))

    if verboso:
        print('ajustes: %d operacoes' % len(ops))
        for data, o in notas:
            print('   %s  %s' % (data, o))
    return dados
