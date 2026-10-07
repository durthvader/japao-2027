"""Aplica a remarcação confirmada após os ajustes históricos do roteiro.

A planilha consolidada e remarcacao.json registram os dados atuais da
viagem que podem ser compartilhados, sem localizadores ou rateios pessoais.
"""
import copy
import json
from pathlib import Path


def aplicar(dados):
    fonte = Path(__file__).with_name('remarcacao.json')
    if not fonte.exists():
        return dados
    novo = json.loads(fonte.read_text(encoding='utf-8'))
    for campo in ('viagem', 'voos', 'voosNotas', 'hospedagem'):
        dados[campo] = copy.deepcopy(novo[campo])
    por_data = {d['data']: d for d in dados['dias']}
    for dia in novo['dias']:
        por_data[dia['data']] = copy.deepcopy(dia)
    dados['dias'] = [por_data[d] for d in sorted(por_data)]
    for n in dados.get('notas', []):
        if str(n['n']) in novo['notas']:
            n.update(novo['notas'][str(n['n'])])
    for d in dados['dias']:
        for campo in ('km', 'min', 'pe', 'transp', 'ingresso'):
            d.setdefault('total', {})[campo] = round(sum(a.get(campo, 0) or 0 for a in d['atividades']), 2)
        if d['data'] == '2027-03-30':
            for a in d['atividades']:
                a['nome'] = a['nome'].replace('a última noite', 'noite em Osaka')
                a['terreno'] = a.get('terreno', '').replace('Última noite', 'Penúltima noite').replace('última noite', 'penúltima noite')
                if a['nome'].startswith('Shinsaibashi'):
                    a['obs'] = 'Compras em 30/03, após chegada do Shinkansen e check-in. O programa original de compras de 31/03 foi preservado. O dia adicional livre é 01/04, até o horário de ir ao aeroporto.'
                if a['nome'].startswith('Shin-Osaka → hotel'):
                    a['obs'] = 'GRAND PIA 2, Bentencho, confirmado de 30/03 a 01/04. Check-in 15h, malas após 12h; checkout até 10h. Solicitar guarda-volumes pós-checkout e conferir as tarifas dos novos acessos.'
                if a['nome'].startswith('Dotonbori'):
                    a['obs'] = 'Programa da noite de chegada a Osaka em 30/03, conforme disposição. O Shinkansen permanece nesta data na opção A; o voo internacional parte em 01/04 às 18:55.'
    for linha in dados.get('resumo', []):
        if linha.get('label', '').startswith('TOTAL EM REAIS'):
            linha['nota'] = 'Transporte e ingressos estimados. Alimentação separada: ¥6.000 × 18 dias = ¥108.000 ≈ R$ 3.564 por adulto. Hospedagem, passagens e extras não incluídos.'
    return dados
