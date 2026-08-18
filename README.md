# Pokepixel — Raridades

Userscript que acumula o que o [Pokepixel](https://pokepixel.nietore.com/play/) mostra de relance mas nunca soma: quantas pokébolas você gastou em cada raridade, qual a sua taxa real de captura por tier, e o histórico completo das suas capturas — por conta e por mapa de caçada.

E, desde a versão 5, um **analisador** que responde a pergunta que o jogo não responde: esse Pokémon é bom? Ele aparece ao passar o mouse em qualquer Pokémon do jogo — inventário, mercado, chat, Poké Centro, cassino e equipe — e diz, com dois números, o quanto ele aproveitou do que poderia ter sido.

## O analisador

Dois gráficos, ambos na mesma escala de 0 a 100, mudando só a régua.

**O primeiro compara com iguais.** Entre todas as Míticas Butterfree que o jogo pode gerar, onde essa cai? 0% é a pior Mítica possível, 100% é a perfeita.

**O segundo compara com a espécie inteira.** Da pior Fraca à melhor Mítica. É aqui que a raridade aparece: uma Mítica qualquer já marca alto, porque está acima de tudo que veio antes.

Os dois juntos separam duas coisas que a raridade sozinha confunde. Uma Butterfree Mítica com IV 153 e qualidade ×1,72 marca **20% entre as Míticas** e **87% na espécie** — ou seja, é um Pokémon forte que teve uma rolagem ruim dentro do tier dele. Uma legenda dentro do cartão explica cada gráfico, para não restar dúvida.

Abaixo dos gráficos vem a explicação em texto: onde o IV e a qualidade caíram dentro das faixas da raridade, se a espécie ataca de físico ou especial, e o que a natureza e o gênero desse exemplar fazem.

### Como a nota é calculada

Só **qualidade e IV total** entram na nota. Natureza, gênero e a distribuição dos IVs ficam de fora — foi decisão da equipe de balanceamento do jogo, e ela tem uma consequência elegante: a fórmula fica fechada.

No nível de referência usado (100), cada atributo vale `2 × base + IV + 5`. Somando os seis, o resultado não depende de **como** o IV foi repartido, porque um ponto vale o mesmo em qualquer atributo:

```
nota = (2 × soma dos base stats + IV total + 30) × qualidade^1,15
```

O `+30` são os "+5" de cada um dos seis atributos. Shiny multiplica por 1,1744 a mais.

O nível usado é sempre 100, nunca o real. Sem isso, um Pokémon recém-capturado — que nasce no nível 1, com atributos entre 7 e 13 — seria incomparável com um de nível 150.

### Por que a nota é normalizada pela faixa

Comparar direto contra o teto engana. O dobro dos base stats é a maior parte do material: numa Butterfree, 770 de 986 pontos, ou 78% do total, são fixos e idênticos em toda Mítica.

O resultado é que **toda Mítica Butterfree cai entre 89,6% e 100%** do teto. Uma escala de dez pontos, encostada no topo, onde tudo parece quase perfeito.

Por isso a nota mede a posição dentro da amplitude possível, não a razão contra o máximo:

```
% = (nota − pior rolagem possível) ÷ (melhor rolagem possível − pior) × 100
```

**Primeiro gráfico:** os extremos são os da própria raridade. 0% é a pior Mítica que o jogo permite (IV 144 e ×1,70), 100% é a melhor (IV 186 e ×1,80).

**Segundo gráfico:** os extremos são os da espécie inteira, da pior Fraca à melhor Mítica. Para shiny, a tabela começa na Épica, então o piso é a pior Épica shiny.

A mesma Butterfree que marcava 92% na razão crua marca **20% entre as Míticas** — ela está a dois pontos do piso e a oito do teto, no quinto inferior da faixa. E marca 87% na espécie inteira, porque uma Mítica qualquer já é muito superior a qualquer coisa abaixo dela.

### De onde vem o perfil de dano

O catálogo de golpes do jogo declara a categoria, o poder e a recarga de cada golpe, então a divisão entre físico e especial é dado, não estimativa:

```
DPS de um golpe = poder ÷ (recarga em ms ÷ 1000)
```

Golpes de status são ignorados. Num Machamp, 100% do dano é físico e o cartão avisa que IV em Atq. Especial rende pouco. Numa espécie que ataca 60/40, ele diz que os dois contam — porque contam.

Quando os golpes de uma espécie ainda não passaram pela sessão, o fallback compara os base stats ofensivos, e o cartão diz qual fonte usou.

### O que o cartão NÃO afirma

Algumas informações foram removidas por não serem confiáveis, e vale explicar o critério.

O cartão já ofereceu um ranking de "onde o IV rende mais" e um "gênero ideal". Os dois saíam de ponderar cada atributo pelo base stat da espécie — uma suposição, não uma regra do jogo. E ela dava resultados errados: numa Butterfree, que ataca 73% de físico, o peso empurrava o Ataque para o fim da lista porque o base dele é baixo.

O que ficou é o que se apoia em dado do jogo: a divisão do dano, a posição do IV e da qualidade dentro das faixas, e o efeito literal do gênero — macho dá +10% em Ataque e Atq. Especial, fêmea dá +10% em HP. Qual dos dois é melhor depende do que você quer do Pokémon, e o cartão não finge saber.

### Premissas e limites

**Multiplicadores comuns se cancelam.** Maestria elemental e o bônus por nível de treinador não entram na conta porque se aplicam igualmente ao Pokémon e aos extremos da faixa. A posição relativa não muda.

**O DPS ignora tipo, crítico e variância.** É poder dividido por recarga. Efetividade elemental, os 6,25% de crítico e a variância de 0,85 a 1,00 do dano não entram no perfil.

**A nota não mede utilidade em combate.** Ela mede o quanto o Pokémon aproveitou do que a raridade dele permitia. Um Pokémon com nota alta e natureza ruim pode render menos que um de nota mais baixa e genética favorável.

### Onde ele aparece

| Tela | Como o Pokémon é identificado |
| --- | --- |
| Registro da extensão | direto do evento de captura |
| Inventário | `data-creature-id` do slot |
| Mercado Global | `data-listing-id` do anúncio |
| Chat | posição do botão dentro da mensagem |
| Poké Centro, Cassino, HUD da equipe | pelo cartão que o próprio jogo abre |

Nas três últimas telas os slots não carregam identificador nenhum no HTML. A saída foi ler o cartão de detalhes que o jogo já exibe — nível, multiplicador, IV total e espécie identificam a criatura sem ambiguidade. Havendo empate, o cartão não aparece: mostrar o Pokémon errado seria pior que não mostrar nada.

### Ele nunca cobre o cartão do jogo

O cartão do analisador é posicionado **sempre ao lado** — nunca acima, nunca abaixo, nunca por cima. Se não couber de um lado, vai para o oposto; se não couber em nenhum com a largura confortável, estreita e o conteúdo reflui.

A largura é constante durante a sessão: a maior que sempre cabe ao lado do cartão do jogo, esteja ele onde estiver na tela. E o topo é alinhado com o dele, para os dois parecerem um par.

Painéis de fundo — a mochila, a lista do mercado — podem ser encostados quando a geometria não deixa alternativa. O cartão de detalhes do jogo, nunca: é literalmente o que você foi olhar.

## O que a extensão mostra

**Por raridade** — tentativas, capturas e taxa de captura de cada qualidade, da Fraca à Mítica, com uma linha "Todos" somando tudo.

**Por pokébola** — os mesmos números separados por tipo de bola, cada uma com seu ícone nas cores reais. A **Cassino Eevee** tem linha própria: o jogo a conta como captura, mas nenhuma bola foi jogada, e misturá-la distorceria a taxa das bolas de verdade.

**Capturas** — o registro das últimas 100 capturas, uma por linha, com raridade, IV total, natureza, gênero, bola usada e destino. Filtros por **Pokémon**, raridade, faixa de IV e destino. O filtro de espécie lista só o que existe no perfil selecionado, então acompanha a hunt escolhida.

**Detalhes no hover** — o cartão completo do Pokémon, com os atributos de batalha, a genética e a análise.

**Estatísticas por hunt** — cada mapa caçado tem seus próprios números, e dá para comparar como está indo no Tyranitar contra como foi no Machamp.

**Hunt atual** — o sprite e o nome da espécie do mapa em que você está caçando. Clique no sprite para alternar entre normal e shiny.

Os contadores são separados por conta, então dá para jogar com duas contas em abas diferentes sem que uma sobrescreva a outra.

## Estatísticas por hunt

O seletor **Mostrando estatísticas** troca o que as três abas exibem. Em "Todas as hunts", os números são o acumulado da conta; escolhendo um mapa, tudo passa a ser daquele mapa.

Cada tentativa é creditada ao total e à hunt corrente na mesma passagem, então **a soma das hunts é sempre igual ao total**.

Sair de uma hunt e voltar depois **retoma de onde parou**. São guardadas 40 hunts; passando disso, sai a que ficou mais tempo sem uso, e não a mais antiga.

Dois botões atuam sobre o perfil selecionado:

- **Zerar** — os contadores daquela hunt voltam a zero
- **Excluir perfil** — a hunt some da lista

Nos dois casos os números dela **saem do total**, do contrário o total guardaria valores que não aparecem em perfil nenhum.

## Quando o servidor engasga

O jogo transmite os eventos por WebSocket. Se a conexão perde uma mensagem, a tentativa correspondente não existe em lugar nenhum do cliente — a extensão só escuta, não tem como recuperar o que não chegou.

O que ela faz é **detectar e informar**. A cada leitura do analisador nativo do jogo, ela compara os incrementos: se o jogo somou mais tentativas que a extensão no mesmo intervalo, a diferença aparece no rodapé do painel. A comparação é por incremento, não por total, então funciona mesmo que os dois tenham sido zerados em momentos diferentes.

O rodapé também avisa quando a numeração sequencial dos eventos tem buracos.

## Como o jogo funciona

Boa parte disso não está documentada em lugar nenhum e foi descoberta lendo o que o jogo envia.

**A raridade não deriva dos IVs.** Versões anteriores deste README afirmavam isso e estava errado. O jogo faz três sorteios independentes: primeiro o tier, por chance pura; depois o IV total, dentro da faixa daquele tier; e o multiplicador de qualidade, dentro de outra faixa, também do tier.

| Tier | Chance | Multiplicador | IV total |
| --- | --- | --- | --- |
| Fraca | 18% | 0,90 – 0,99 | 6 – 42 |
| Comum | 50% | 1,00 – 1,09 | 18 – 60 |
| Incomum | 22% | 1,10 – 1,24 | 48 – 90 |
| Rara | 8% | 1,25 – 1,39 | 78 – 120 |
| Épica | 1,7% | 1,40 – 1,54 | 102 – 144 |
| Lendária | 0,28% | 1,55 – 1,69 | 126 – 168 |
| Mítica | 0,02% | 1,70 – 1,80 | 144 – 186 |

Shiny tem tabela própria de multiplicador: Épica 1,70–1,79, Lendária 1,80–1,99, Mítica 2,00–2,60.

Como IV e multiplicador são sorteios separados, **duas Lendárias da mesma espécie podem ter IV parecido e força bem diferente** — e é o multiplicador que pesa mais.

**A fórmula de atributo**, ajustada em 200 valores medidos e conferida em 184 deles com erro máximo de 2 pontos:

```
atributo = round(
    floor((2 × base + IV) × nível/100 + 5)
    × natureza     (×1,1 no que sobe, ×0,9 no que desce)
    × gênero       (macho ×1,1 em Ataque e Atq. Esp. · fêmea ×1,1 em HP)
    × multiplicador^1,15
    × shiny        (×1,1744)
)
```

Natureza e gênero entram **antes** do multiplicador de qualidade — o jogo arredonda no meio, e a ordem muda o resultado.

Outros detalhes que importam:

- **Capturas nascem no nível 1**, qualquer que seja o nível do mapa. Por isso a análise projeta para um nível de referência: no nível 1 o IV move menos de meio ponto e some no arredondamento.
- **Seu nível de treinador soma +2% de atributo a cada 10 níveis.**
- Cada mapa de caçada tem uma espécie só, e a hunt é identificada por mapa + espécie.
- IV máximo é 186, 31 por atributo.

## Instalação

1. Instale a extensão [Tampermonkey](https://www.tampermonkey.net/) no seu navegador.
2. Clique em **[pokepixel-rarity-tracker.user.js](pokepixel-rarity-tracker.user.js)** e depois no botão **Raw**.
3. O Tampermonkey abre a tela de instalação. Confirme.
4. Recarregue o jogo. Um botão **Raridades** aparece no canto inferior direito — arraste para onde preferir.

Atualizações são verificadas automaticamente pelo Tampermonkey.

### Se você prefere fixar a versão

A atualização automática é conveniente, mas significa que o código pode mudar sem você revisar. Se você auditou uma versão e quer manter exatamente ela, edite as duas linhas abaixo no cabeçalho da sua cópia local, trocando a URL por `none`:

```
// @downloadURL  none
// @updateURL    none
```

## Isso conta como trapaça?

Não. O script é **somente leitura** e não interfere no jogo:

- Não envia nada ao servidor. Não existe nenhuma chamada de `send` no código.
- Não faz requisições próprias. Tudo que ele lê são respostas que o jogo já pediu, clonadas para não consumir o corpo original.
- Não automatiza nenhuma ação. A auto-captura e a auto-venda são recursos do próprio jogo.
- Não revela nada oculto. A qualidade aparece na badge de cada Pokémon, e os atributos vêm no próprio evento de captura.
- Não grava nada nos dados do jogo. Os contadores ficam no armazenamento privado do Tampermonkey.

O analisador não é exceção: ele é aritmética sobre dados que já estão na tela. O que ele acrescenta é a conta que você faria no papel.

Vale saber o que ele **de fato substitui**: `window.WebSocket` e `window.fetch`. Toda chamada segue para a implementação original, e as interceptações ficam dentro de `try/catch` para que uma falha nunca derrube uma requisição do jogo. Mas é uma substituição real, e um jogo que verifique a integridade dessas funções poderia notar. O analisador também insere um cartão ao lado dos painéis do jogo — não altera nada do que já está lá, mas é um elemento a mais no DOM da página. Confirme as regras do seu servidor antes de usar.

## Como funciona

O jogo transmite os eventos de combate por WebSocket, cada um numerado sequencialmente. O script escuta quatro deles:

| Evento | Para quê |
| --- | --- |
| `combat.started` | Identifica a espécie da hunt e conta shinies vistos |
| `capture.failed` | Uma tentativa que não deu certo, com a qualidade e a bola usada |
| `capture.success` | Uma captura, com a criatura completa |
| `chat.message` | Os Pokémon marcados no chat, para o analisador |

Como cada Pokémon é um evento discreto com a própria qualidade, não há dedução nem estimativa — a atribuição é exata. A numeração sequencial também permite detectar mensagens perdidas na conexão.

As respostas HTTP são lidas via `clone()`, nunca modificadas:

| Endpoint | Para quê |
| --- | --- |
| `/species` | nomes, sprites, base stats e catálogo de golpes |
| `/game-config/formulas` | faixas de raridade, de IV e as constantes de atributo |
| `/creatures`, `/team` | sua coleção e sua equipe |
| `/market/listings` | os anúncios do mercado |
| `/chat/history` | as mensagens já na tela ao carregar |
| `/hunts/analyzer` | reconciliação com o analisador nativo |
| `/stop` | fim da caçada |

Espécies e golpes são guardados entre sessões, então a cobertura do analisador cresce conforme você joga.

### Limites conhecidos

O registro guarda as **últimas 100 capturas**, e são guardadas as **40 hunts** menos ociosas. Capturas feitas fora de uma caçada entram no total sem serem creditadas a nenhum mapa.

Não existe evento de "entrei na cidade" além do `/stop`. Se você recarregar a página já estando lá, o cartão leva até um minuto de inatividade para reconhecer que não há caçada.

O analisador precisa dos base stats da espécie. Eles vêm do catálogo no carregamento, mas uma espécie que nunca passou pela sessão não recebe análise — e o cartão diz isso em vez de mostrar número inventado.

O teto das Míticas shiny (multiplicador até 2,60) vem da configuração declarada pelo jogo e nunca foi observado na prática.

## Segurança

O script foi revisado por terceiros e as correções sugeridas estão aplicadas desde a versão 2.19.0:

- Rótulos vindos do servidor são escapados antes de ir para o DOM.
- O índice de pokébolas usa um objeto sem protótipo e rejeita chaves como `__proto__`.
- URLs de sprite aceitam apenas `http`/`https`.
- Dados lidos do armazenamento são sanitizados: contadores viram inteiros válidos e textos ganham limite de tamanho.
- Nenhum fragmento do token de sessão é gravado — quando o JWT não traz um identificador, é usado um valor derivado.
- O conteúdo do chat de outros jogadores nunca é armazenado.

Se encontrar algo, abra uma [issue](https://github.com/Lfmagliano/pokepixel-raridades/issues).

## Licença

MIT
