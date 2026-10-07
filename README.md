# Japão 2027

Site do roteiro da viagem ao Japão de 15/03 a 01/04/2027 — 18 dias e 17 noites
entre Osaka, Kyoto, Kawaguchiko e Tokyo, para 13 pessoas.

O site tem 12 páginas temáticas e 18 páginas diárias, geradas pelo mesmo template
e dados consolidados. `index.html` é o portal. O conteúdo principal é embutido no
HTML; fotos são arquivos locais. Mapas Leaflet/tiles precisam de internet.

## Remarcação de 26/09/2026

Decisão de 27/09/2026: roteiro turístico anterior restaurado, com os novos voos
confirmados para os 13. Programa completo de Osaka de 18/03 antecipado para 16/03;
sumô mantido em 17/03. Kyoto em 18/03 livre após a mudança de base, passeios
originais em 19–21/03. Compras originais mantidas em 31/03; Osaka em 01/04 livre
até o aeroporto. Nenhuma atração nova foi acrescentada aos períodos livres.
A redistribuição anterior de passeios foi revogada. Seul não foi incluída.

Bases: Osaka 15–18/03, Kyoto 18–22/03, Kawaguchiko 22–23/03, Tóquio 23–30/03,
Osaka 30/03–01/04. Atualização de 06/10/2026: o anfitrião aceitou Osaka inicial 15–18/03. GRAND PIA 2 em Bentencho também confirmado para 30/03–01/04. Laon Inn Gion Nawate confirmado em 18–22/03, quatro quartos, pago ¥282.616 (≈R$10.295). K-style anterior cancelado conforme confirmação de 06/10/2026. La Vista confirmado em 22–23/03 por R$8.727. GRAND PIA 2 pago integralmente: R$2.043,22, conforme HOSPE.pdf e confirmação do viajante em 07/10/2026. Osaka 15–18/03 com preço mantido em R$4.054,89, confirmado pelo viajante em 07/10/2026.
A lista B registra Brighton, Hakonenomori e Petit Grande como cancelados, conforme os prints. Seus valores ficam fora do orçamento ativo.

A planilha original foi atualizada em 06/10/2026 com a programação decidida em
27/09. `Roteiro!A25` registra `Roteiro consolidado: 06/10/2026`, incluindo a
confirmação de Osaka inicial. O extrator grava a data desse marcador em `_roteiroConsolidado`.
`ajustes.py` preserva os passeios da planilha e recalcula seus totais. Nesse caso,
as operações históricas de `ajustes.json` e os dias de `remarcacao.json` já estão
incorporados. Voos, notas de logística e situação das hospedagens continuam
complementados por `remarcacao.json`. Não incluir localizadores ou compras pessoais.

Em `Hospedagem`, a coluna A mostra os períodos planejados. E/F e os valores
preservam os registros de reserva anteriores. O extrato mantém esses registros
em `reservaCheckin`, `reservaCheckout`, `reservaNoites` e `referenciaAnterior`.
Kyoto está reservado no Laon Inn Gion Nawate em 18–22/03, quatro quartos. O total pago é ¥282.616; R$10.295 é a referência aproximada exibida pelo Booking. A política de cancelamento da tarifa contratada não aparece no print final. K-style 19–22/03, R$7.313, foi cancelado conforme confirmação de 06/10/2026; eventual cobrança/reembolso a conferir.

Custos sem cotação ficam explícitos. O subtotal de hotéis reúne referências
antigas e não representa 17 noites cotadas. A alimentação usa 18 dias. O histórico
do radar de agosto foi identificado separadamente e não orienta os voos atuais.

As páginas `dia-NN.html` (o mapa de cada dia) são a única exceção: elas puxam o Leaflet e
os tiles do mapa da internet. Sem conexão o mapa some e o resto da página — hora a hora,
custos, alternativas — continua funcionando.

## O que tem dentro

| Seção | O que mostra |
|---|---|
| Números | Distância, tempo, custo total por adulto |
| Mapa | Rota Osaka → Kyoto → Kawaguchiko → Tokyo → Osaka, com as pernas detalhadas |
| Timelapse | Os 18 dias num scrubber: arraste ou dê play |
| Roteiro | Atividades com distância, tempo, ingresso, horário e acesso com carrinho |
| Remarcação | Voos confirmados, opções de 17 noites e pendências após a mudança |
| Comer / Compras | Curadoria por bairro, com os horários que importam |
| Plano B | Alternativas cobertas, trocas mapeadas e as 14 decisões da planilha |
| Logística | Voos e os dois conjuntos de hospedagem |
| Mapa do dia | Uma página por dia: rota no mapa, hora a hora, transporte, custos, must-see, comidas, compras, alternativas e uma foto por parada |

## Regerar depois de mexer na planilha

O site é gerado a partir de `Roteiro Japão.xlsx`, que fica **fora deste repositório**
(na pasta acima, junto do `site/`). A planilha tem uma aba de acerto financeiro pessoal
e por isso não é versionada aqui.

```bash
pip install openpyxl
python gerar_site.py
```

`gerar_site.py` percebe sozinho se a planilha mudou, chama `extrair.py` para regravar
`dados.json`, reescreve `index.html` e regera um `dia-NN.html` para cada dia que tiver
camada geográfica em `mapa/pontos.json`. Depois é só commitar e dar push — o GitHub Pages
publica em seguida.

### Mudar o roteiro sem mexer na planilha

`dados.json` é o extrato do `.xlsx` e **não se edita à mão**. A planilha consolidada
contém os passeios atuais; novas mudanças nas atividades devem ser feitas nela.
O extrator identifica datas, `TOTAL DO DIA` e rótulos do resumo, acompanhando o
crescimento da aba. `ajustes.json` preserva as decisões históricas para leitura e
para extratos antigos que ainda não tenham o marcador de consolidação.

Operações: `mover` (com `para: null` para cortar), `reordenar` e `nota` (só registra a
análise). Cada uma leva um `motivo`, que o site mostra no card do dia, e um `campos`
opcional. **`campos` importa:** distância, tempo e custo de uma parada são sempre "de onde
eu vinha até aqui" — ao mudar a parada de dia esses números passam a descrever um trajeto
que não existe mais, e precisam ser reescritos junto. Os totais do dia são recalculados
somando as atividades.

### O painel é do grupo inteiro

Regra de escrita: **nada no site fala com quem montou o roteiro.** Marca de edição
("RECUPERADO da sua lista original", "MOVIDO do dia 31/03", "DECIDIDO —", "Conferi os 16
dias"), referência a aba de planilha e rateio individual entre as famílias não vão para o
painel. Conselho em segunda pessoa para quem viaja — "vocês vão precisar de reserva",
"considerem takkyubin" — é outra coisa e fica.

Parte desse texto veio da própria planilha. `ajustes.json` preserva uma lista `limpeza`
de pares de troca usada nos extratos antigos. A planilha consolidada já contém os
textos revisados, e o gerador preserva esses textos ao extrair novamente.

A análise em si não se perde: ela mora em `ajustes.json` e `mapa/lista.json`, que são
documentos de trabalho e nunca chegam ao HTML.

Sumir com um bloco da tela não basta: o `index.html` embute o roteiro inteiro como
constante JS, e por um tempo os campos `motivo` e `ajustes` foram junto — invisíveis na
página, visíveis em ver-código-fonte. Hoje `gerar_site.py` poda essas chaves antes de
serializar, e a poda é por nome de chave, então operação nova já nasce podada.

### O que não entra no repositório

O repositório é público. Estes arquivos ficam só no disco, no `.gitignore`:

| Arquivo | Por que fica de fora |
|---|---|
| `Roteiro Japão.xlsx` | A aba `Detalhado` é o acerto financeiro pessoal entre as famílias |
| `dados.json` | Extrato cru da planilha — carrega o mesmo rateio, com nomes |
| `ajustes.json` | As decisões **com** o `motivo` de cada uma: bastidor de edição |
| `mapa/lista.json` | Os 30 lugares salvos no Google Maps, com veredito por lugar |

Consequência: quem clonar o repositório recebe o site pronto e o código que o gera, mas
não consegue regerá-lo — falta o `dados.json`. Isso é de propósito. As duas fontes moram
no OneDrive, que é onde elas têm backup.

### Fotos das paradas

`python fotos.py` baixa, além das cinco fotos das cidades, uma foto para cada parada que
tiver `"foto"` em `mapa/pontos.json` — vão para `fotos/paradas/` em WebP de 620 px
(~30 KB cada) com o crédito em `fotos/paradas.json`. Ele só rebaixa o que mudou.

O valor de `"foto"` pode ser um termo de busca (`"Dotonbori night Osaka"`) ou um arquivo
exato (`"File:Tempozan Market Place.jpg"`). Com termo o script escolhe o primeiro
resultado paisagem grande o bastante e **imprime o que escolheu** — vale conferir: na
primeira rodada a busca por "Kuromon Ichiba Market" trouxe uma réplica do mercado num
shopping, e "Nakazakicho" trouxe a plataforma do metrô. Quando vier ruim, troque o termo
pelo `File:` certo e rode de novo.

As fotos só são baixadas pelo navegador quando o card da parada é aberto; até lá aparece
o placeholder borrado que já vem embutido no HTML.

### Mapear um dia novo

Abra `mapa/pontos.json` e acrescente uma chave com a data (`"2027-03-20": { ... }`).
Cada parada com `"ai": N` aponta para a atividade N daquele dia em `dados.json` — nome,
horário, ingresso e observações vêm de lá e não se repetem aqui. O que se escreve à mão é
a geografia (`lat`/`lng`), o ritmo (`hora`/`fim`), as `pernas` entre as paradas e a
curadoria (`must`, `comidas`, `compras`, `alerta`, `alternativas`, `passe`). Regere e o
botão "Ver o mapa deste dia" aparece sozinho no card daquele dia.

## Arquivos

- `index.html` — o site pronto, é o que o Pages serve. **Gerado, não edite à mão.**
- `template.html` — o HTML, CSS e JS de verdade. É aqui que se mexe no layout.
- `dia_template.html` — o layout das páginas de mapa do dia. Também é fonte, não gerado.
- `mapa/pontos.json` — coordenadas, horários, trechos e curadoria de cada dia mapeado.
- `dia-NN.html` — os mapas do dia prontos. **Gerados, não edite à mão.**
- `extrair.py` — lê a planilha e grava `dados.json`.
- `gerar_site.py` — junta `template.html` + `dados.json` e escreve `index.html`.
- `dados.json` — o roteiro extraído da planilha. **Fora do repositório.**
- `ajustes.py` / `ajustes.json` — a camada de decisões por cima do extrato; o
  `.json` fica **fora do repositório** porque guarda o motivo de cada uma.
- `exportar_xlsx.py` — grava o roteiro já ajustado em `Roteiro Japao - FINAL.xlsx`,
  na pasta acima. A planilha original consolidada fornece os passeios; o arquivo
  FINAL é uma exportação. O marcador de revisão evita repetir os ajustes históricos.
- `fotos.py` — baixa as fotos do Commons e grava `fotos/` + `creditos.json`.
- `fotos/` — as imagens em dois tamanhos, mais os créditos.

## Sobre as fotos

O fundo é uma camada fixa de papel de parede que faz cross-fade entre cinco fotos
conforme você percorre a página — cada cidade tem a sua, e o roteiro troca a foto
a cada dia. As mesmas fotos aparecem nas miniaturas dos dias, nos cards e no timelapse.

Todas vêm do **Wikimedia Commons**, com licença que permite redistribuição, e estão
reduzidas e recomprimidas em WebP dentro de `fotos/`:

| Uso | Foto | Autor | Licença |
|---|---|---|---|
| Hero | Fuji refletido no lago Kawaguchi | Marion & Christoph Aistleitner | CC0 |
| Fuji | Pagode Chureito com sakura | bruchez (Flickr) | CC BY-SA 2.0 |
| Osaka | Dotonbori da ponte Ebisu | Type specimen | CC BY-SA 3.0 |
| Kyoto | Túnel de torii de Fushimi Inari | Luka Peternel | CC BY-SA 4.0 |
| Tokyo | Cruzamento de Shibuya | Benh Lieu Song | CC BY-SA 2.0 |

Os créditos completos, com link para a página de origem e para a licença, ficam no
rodapé do site — CC BY-SA exige atribuição, então não removam.

Para trocar por fotos de vocês depois da viagem: ponha os arquivos em `fotos/` seguindo
o padrão `<cidade>-lg.webp` (1800px, para o fundo) e `<cidade>-sm.webp` (720px, para as
miniaturas), com as chaves `hero`, `osaka`, `kyoto`, `fuji` e `tokyo`. O script
`fotos.py` mostra a compressão usada (`pip install Pillow`, depois `python fotos.py`). Depois é só atualizar
`fotos/creditos.json`, que é o que alimenta a legenda e o placeholder borrado.

Como a luminância das fotos varia muito (Fuji ao amanhecer contra Dotonbori à noite),
a camada de fundo passa por um filtro de brilho por tema — sem ele, o véu teria de ser
forte o bastante para o pior caso e toda foto viraria cinza.

## GRAND PIA 2 confirmado

30/03/2027 às 15h a 01/04/2027 às 10h. Malas após 12h na chegada; código previsto em 28/03. O guia informa guarda-volumes pós-checkout por $5 por volume, mediante solicitação; confirmar moeda e carrinhos. Os acessos de Bentencho ainda sem tarifa ficam vazios na planilha e aparecem como “A cotar” no site. O subtotal de transporte é parcial.

Booking, prints de 06/10/2026: K-style (4 quartos, 19–22/03) R$7.313; La Vista (4 quartos, 22–23/03) R$8.727. Ambos exibem cancelamento grátis, sem prazo no print. Cancelados: Brighton R$5.595, Hakonenomori R$5.723, Petit Grande R$21.645 e K-style R$7.313 (19–22/03). Os totais são valores inteiros dos prints. Rateios individuais da planilha original foram mantidos como referências anteriores porque faltam preços por quarto. A coluna K contém os novos totais; a projeção automática de uma quarta noite em L7 foi retirada.

Laon confirmado em 06/10/2026. Acessos de Gion revisados sem acrescentar atrações; novas tarifas ficam a cotar. Endereço oficial: 16-1 Yamatocho, Higashiyama-ku, Kyoto 605-0802. O marcador geográfico é aproximado. Os arquivos publicados omitem localizadores, PIN, e-mail e endereços de confirmação privados. A lista de cálculo do XLSX é conferida para remover referências a células que deixaram de conter fórmulas.
