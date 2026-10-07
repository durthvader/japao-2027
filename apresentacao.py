"""Textos da viagem atual para o site; os registros de origem ficam preservados."""
import copy


TROCAS = [
    ('Austrália e Chile saíram deste itinerário. ', ''),
    ('A pendência de visto australiano deixa de se aplicar a esse itinerário. ', ''),
    ('K-style anterior cancelado conforme confirmação de 06/10/2026. ', ''),
    ('K-style anterior cancelado. ', ''),
    ('O programa restaurado coloca Umeda Sky em 16/03 e castelo/Shitennoji em 17/03.', 'Umeda Sky fica em 16/03, e castelo/Shitennoji em 17/03.'),
    ('A economia calculada anteriormente para 17–18/03 não é uma cotação válida; confirmar', 'Confirmar'),
    ('O programa anterior foi restaurado, com a visita depois de Nijō. ', 'A visita ocorre depois de Nijō. '),
    ('O antigo ônibus de retorno à Estação de Kyoto foi retirado; ', ''),
    ('O antigo ônibus noturno para a Estação de Kyoto foi retirado; ', ''),
    ('O antigo ônibus noturno para Kyoto foi retirado. ', ''),
    ('O antigo total precisa dessas tarifas para a comparação.', 'A comparação depende das tarifas dos acessos ao hotel.'),
    ('A hospedagem agora fica em Gion; ', 'A hospedagem fica em Gion; '),
    ('A partida agora ocorre em Gion, ', 'A partida ocorre em Gion, '),
    ('O acesso inicial usa ', 'O acesso usa '),
    ('O acesso a pé passa a ', 'O acesso a pé segue por '),
]


def limpar_textos(valor):
    if isinstance(valor, str):
        for antes, depois in TROCAS:
            valor = valor.replace(antes, depois)
        return valor
    if isinstance(valor, list):
        return [limpar_textos(v) for v in valor]
    if isinstance(valor, dict):
        return {k: limpar_textos(v) for k, v in valor.items()}
    return valor


NOTAS = {
    1: ('20–22/03: fim de semana prolongado', 'O equinócio é domingo 21/03 e o feriado compensatório é segunda 22/03. Os passeios de Kyoto ocorrem em 19–21/03, e o transfer para Kawaguchiko em 22/03. Escolher o ônibus de Mishima antes do trem; venda padrão JR em 22/02 às 10h do Japão = 21/02 às 22h de Fortaleza, sujeita às regras do produto.'),
    2: ('KYOTO: passeios e dia livre', '18/03 fica livre após o transfer e o check-in. Em 19/03: templos, Nishiki e Gion. Em 20/03: Arashiyama, Tenryū-ji, Monkey Park, Ryōan-ji, Kinkaku-ji, Nijō e Biovortex. Em 21/03: Fushimi Inari e circuito leste.'),
    3: ('OSAKA: passeios e saída para o aeroporto', 'Os passeios de Kuromon, Namba Yasaka, Kaiyukan, Tempozan, Nakazakicho e Umeda ocorrem em 16/03. Sumô em 17/03. Compras em 31/03. O dia 01/04 fica livre até o checkout e o transfer para o aeroporto.'),
    4: ('OSAKA AMAZING PASS: conferir 16–17/03', 'Umeda fica em 16/03, e castelo/Shitennoji em 17/03. Comparar o passe com as atrações e os deslocamentos dessas duas datas consecutivas. Conferir preços, cobertura e regras de 2027 antes da compra.'),
    7: ('COM BEBÊ: acessibilidade e carrinhos', 'Conferir acessibilidade e regras de carrinhos em cada local; manter canguru para as visitas que o exigem. O Kaiyukan não empresta carrinhos. Os dias 18/03 e 01/04 ficam livres após os procedimentos da hospedagem e até a saída ao aeroporto, respectivamente.'),
    8: ('KYOTO: transporte com três carrinhos', 'A base é o Laon em Gion. Conferir elevadores, horários e tarifas nos acessos por Keihan, Hankyu e JR. Lotação e trânsito podem ampliar o tempo estimado, especialmente em 20–22/03. Ao cotar táxis ou van, informar 13 pessoas, idades das crianças, três carrinhos e volume das malas. Preços por carro ou volume ficam separados do custo por adulto.'),
    10: ('HOSPEDAGENS: reservas e serviços', 'As datas, valores e endereços estão na Logística. Conferir a política da tarifa do Laon e o comprovante da estadia em Tóquio. Organizar malas, carrinhos, códigos de acesso e guarda-volumes. Os acessos de Gion e Bentencho têm tarifas e horários a conferir.'),
    12: ('ATRAÇÕES: datas e ingressos', 'Sumô em 17/03, Biovortex em 20/03, DisneySea em 24/03, Planets em 27/03 e Shibuya Sky em 29/03. Transfer a Kyoto em 18/03; Shinkansen Tóquio → Osaka em 30/03; compras em 31/03. Os dias 18/03 e 01/04 têm períodos livres. Conferir reservas e comprovantes: estar no roteiro não confirma a compra do ingresso.'),
    13: ('SAKURA: acompanhar a previsão', 'A viagem atravessa o fim de março e o início de abril. Datas de floração e condições do tempo de 2027 ainda precisam de previsão. Usar as atualizações próximas da viagem para escolher visitas a parques; manter flexibilidade para o clima.'),
    14: ('ORÇAMENTO: referências e valores a cotar', 'Alimentação no cenário médio: ¥6.000 × 18 dias = ¥108.000, cerca de R$3.564 por adulto ao câmbio de planejamento de R$0,033/iene. A alimentação dos bebês depende das necessidades de cada família. Os valores de hospedagem estão na Logística; o Laon tem conversão aproximada em reais, e Tóquio usa uma referência a reconferir. Faltam tarifas de alguns acessos, guarda-volumes, seguro, internet, compras e extras. Confirmar preços de 2027 antes de fechar o orçamento.'),
}


def preparar(dados):
    dados = limpar_textos(copy.deepcopy(dados))
    for nota in dados.get('notas', []):
        atual = NOTAS.get(int(nota['n']))
        if atual:
            nota['titulo'], nota['texto'] = atual
        if int(nota['n']) == 11:
            nota['titulo'] = 'DOHA E GRU: conexões e documentos'
    for nota in dados.get('voosNotas', []):
        if nota.get('titulo') == 'REMARCAÇÃO CONFIRMADA PARA AS 13 PESSOAS':
            nota['titulo'] = 'VOOS CONFIRMADOS PARA AS 13 PESSOAS'
            nota['texto'] = 'Seis trechos via Guarulhos e Doha. Os quatro trechos internacionais são operados pela Qatar. Conferir os horários locais abaixo e as notificações da companhia até o embarque.'
        if nota.get('titulo', '').startswith('IDA —'):
            nota['texto'] = '41h10 entre a saída de Fortaleza e a chegada a Kansai: 26h15 voando e 14h55 nas conexões. A espera em GRU é de 11h25 em 13/03, com embarque internacional de madrugada. Avaliar descanso/day use e apresentação até 23h10 de 13/03.'
        if nota.get('titulo', '').startswith('VOLTA —'):
            nota['texto'] = '34h entre aeroportos, com 29h45 voando e 4h15 em conexões. Chegada a Guarulhos às 10h35 de 02/04 e saída do doméstico às 13h30. Chegada a Fortaleza às 16h55.'
        if nota.get('titulo') == 'DOCUMENTAÇÃO DA NOVA ROTA':
            nota['titulo'] = 'DOCUMENTOS DA VIAGEM'
        if 'HOSPEDAGENS:' in nota.get('titulo', ''):
            nota['titulo'] = 'HOSPEDAGENS E SERVIÇOS'
            nota['texto'] = 'As datas e os valores das estadias estão abaixo. Conferir a política da tarifa do Laon, os serviços para os bebês e o guarda-volumes do GRAND PIA 2. Seguro e internet devem cobrir as datas da viagem.'
    h = dados.get('hospedagem', {}).get('a', [])
    if h:
        h[0]['status'] = 'Reserva confirmada. %s noites.' % h[0]['noites']
        h[0]['valorPeriodo'] = 'grupo'
    if len(h) > 4:
        h[4]['valorPeriodo'] = 'grupo · pago integral'
    if len(h) > 3:
        h[3]['status'] = 'Reconferir valor e ocupação no comprovante da estadia.'
    if len(h) > 2:
        h[2]['status'] = 'Confirmada, quatro quartos. Cancelamento gratuito; conferir o prazo na reserva.'
    return dados
