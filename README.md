# Pokepixel — Raridades

Userscript que acumula o que o [Pokepixel](https://pokepixel.nietore.com/play/) mostra de relance mas nunca soma: quantas pokébolas você gastou em cada raridade, qual a sua taxa real de captura por tier, e o histórico completo das suas capturas — por conta e por mapa de caçada.

E, desde a versão 5, um **analisador** que responde a pergunta que o jogo não responde: esse Pokémon é bom? Ele aparece ao passar o mouse em qualquer Pokémon do jogo — inventário, mercado, chat, Poké Centro, cassino e equipe — e diz, com dois números, o quanto ele aproveitou do que poderia ter sido.

## O analisador

Dois gráficos, porque são duas perguntas diferentes e confundi-las é o erro mais fácil de cometer aqui.

**O primeiro é um percentil.** Ele diz a posição do Pokémon entre todos os da mesma raridade daquela espécie. "87%" significa melhor que 87% das Lendárias Machamp possíveis. Shiny é comparado só com shiny, porque a tabela de multiplicador é outra.

**O segundo é uma razão.** Quanto dos atributos do melhor possível da espécie esse Pokémon alcança. Uma Comum perfeita fica perto de 48%; uma Mítica perfeita, em 100%.

A distinção importa mais do que parece. Uma Butterfree Mítica com IV 153 mostra **93% do teto** — o que soa excelente — e ao mesmo tempo está entre as **7% piores Míticas** da espécie. Os dois números estão certos; só respondem coisas diferentes. Uma legenda dentro do cartão explica cada um, para não restar dúvida.

Abaixo dos gráficos vem a explicação em texto: qual atributo ofensivo a espécie usa e quanto do IV caiu no que ela não usa, onde o IV total caiu dentro da faixa do tier, e se a natureza e o gênero ajudaram, atrapalharam ou foram neutros.

### Como a nota é calculada

Os dois gráficos partem do mesmo número. Para cada um dos seis atributos:

```
atributo = floor((2 × base + IV) × nível/100 + 5)
         × natureza          ×1,1 no que ela sobe, ×0,9 no que ela desce
         × gênero            macho ×1,1 em Ataque e Atq. Esp. · fêmea ×1,1 em HP
         × multiplicador^1,15
         × shiny             ×1,1744, quando for

nota = Σ (peso do atributo × atributo)
```

O nível usado é sempre **100**, nunca o real. Sem isso, um Pokémon recém-capturado (que nasce no nível 1, com atributos entre 7 e 13) seria incomparável com um de nível 150 — e no nível 1 o IV move menos de meio ponto, sumindo no arredondamento.

### De onde vêm os pesos

Quatro atributos pesam o próprio base stat da espécie: HP, Defesa, Def. Especial e Velocidade. Os dois ofensivos são divididos pela participação de cada um no dano:

```
DPS de um golpe   = poder ÷ (recarga em ms ÷ 1000)
peso[Ataque]      = base_atk × (DPS físico   ÷ DPS total)
peso[Atq. Esp.]   = base_spa × (DPS especial ÷ DPS total)
```

O catálogo de golpes do jogo declara a categoria, o poder e a recarga de cada golpe, então essa divisão é dado, não estimativa. Num Machamp, 100% do dano é físico e o peso do Atq. Especial fica em **zero**.

Golpes de status (poder 1) são ignorados. Quando os golpes de uma espécie ainda não passaram pela sessão, o fallback compara `base_atk` com `base_spa`, e o cartão avisa qual fonte usou.

### O teto — o "Pokémon perfeito"

Busca exaustiva, sem heurística: para cada uma das combinações de natureza × gênero, distribui o IV máximo do tier de forma ótima e calcula a nota. O maior valor encontrado é o teto.

A distribuição ótima é direta porque o problema é linear: o ganho de um ponto de IV num atributo é `peso × multiplicador da natureza × multiplicador do gênero`, então basta ordenar por esse valor e encher do maior para o menor, respeitando o teto de 31 por atributo.

Uma versão anterior escolhia a natureza pela intuição — a que subia o atributo de maior peso — e produzia um teto **abaixo** do máximo real. O sintoma era rolagens comuns aparecerem acima de 100%.

### Primeiro gráfico — percentil

Simula **1.200 Pokémon** daquele tier, daquela espécie e daquele estado de shiny, e conta quantos ficaram abaixo da sua nota:

- **IV total** sorteado uniforme dentro da faixa do tier, repartido aleatoriamente entre os seis atributos com teto de 31 em cada
- **Natureza** sorteada entre as 25, com a frequência real — as cinco neutras somam 20%
- **Gênero** meio a meio
- **Multiplicador** uniforme dentro da faixa do tier

As notas são ordenadas e guardadas como 101 quantis; a sua posição sai por busca binária. O resultado fica em cache por espécie + tier + shiny, então cada combinação é simulada uma vez por sessão.

### Segundo gráfico — razão contra o teto

```
% = nota ÷ nota do melhor Mítico possível × 100
```

Shiny é comparado com o teto shiny, que usa a outra tabela de multiplicador.

### Premissas e limites

Vale saber onde a conta é dado do jogo e onde é modelo meu.

**A distribuição sorteada é assumida uniforme.** Eu não confirmei como o jogo sorteia IV total e multiplicador dentro das faixas. Se ele concentrar no meio em vez de espalhar, o percentil fica torto nas pontas — um Pokémon extremo pareceria menos extremo do que é.

**Os pesos defensivos são escolha minha.** Que HP, Defesa, Def. Especial e Velocidade valham proporcionalmente ao base stat é uma suposição razoável, não uma medição. A divisão entre físico e especial vem do jogo; a importância relativa de defesa contra velocidade, não.

**O DPS ignora tipo, crítico e variância.** É poder dividido por recarga. Efetividade elemental, os 6,25% de crítico e a variância de 0,85 a 1,00 do dano não entram.

**Multiplicadores comuns se cancelam.** Maestria elemental e o bônus por nível de treinador não aparecem na conta porque se aplicam igualmente ao seu Pokémon e ao teto. A razão entre os dois não muda.

**1.200 amostras dão resolução de cerca de 1%.** Diferenças menores que isso no percentil são ruído da simulação.

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
