# Pokepixel — Raridades

Userscript que revela e acumula informações que o [Pokepixel](https://pokepixel.nietore.com/play/) mostra de relance mas nunca soma: quantas pokébolas você gastou em cada raridade, qual a sua taxa real de captura por tier, e a distribuição de IVs de cada Pokémon — inclusive dos anúncios do mercado.

O jogo informa a qualidade de cada Pokémon e a raridade de cada captura, mas não acumula nada disso. Se você quer saber o quão brutal é de fato capturar um Mítico, ou se aquele Rhyhorn de "113/186" no mercado tem os pontos onde interessa, não há como descobrir jogando.

## O que ele mostra

**Por raridade** — tentativas, capturas e taxa de captura de cada qualidade, da Fraca à Mítica, com uma linha "Todos" somando tudo.

**Por pokébola** — os mesmos números separados por tipo de bola, da Poké Ball à Pixel Ball, cada uma com seu ícone nas cores reais.

**Capturas** — o registro das últimas 100 capturas, uma por linha, com raridade, IV total, natureza, gênero, bola usada e se a venda automática levou o Pokémon. Filtros por raridade, faixa de IV e destino.

**Detalhes no hover** — passando o mouse sobre qualquer captura, aparece um cartão com os atributos de batalha e a genética completa: natureza, gênero e quanto de IV foi para cada atributo.

**Hunt atual** — o sprite e o nome da espécie do mapa em que você está caçando. Clique no sprite para alternar entre normal e shiny.

Os contadores são separados por conta, então dá para jogar com duas contas em abas diferentes sem que uma sobrescreva a outra.

## Mercado Global

O mercado mostra o IV total de cada anúncio, mas não como esses pontos foram distribuídos — e é essa distribuição que decide se vale a compra.

Um exemplo real: um Rhyhorn anunciado como **113/186** tinha 30 de IV em Defesa e apenas 8 em Velocidade. Outro Rhyhorn com exatamente o mesmo 113/186 pode ter o oposto. Pelo card do mercado os dois são indistinguíveis; na prática são Pokémon completamente diferentes.

Passe o mouse sobre qualquer anúncio de Pokémon e o cartão aparece ao lado, com:

- **Atributos de batalha** — HP máximo, Ataque, Defesa, Atq. Especial, Def. Especial e Velocidade
- **Genética** — natureza, gênero e o IV de cada um dos seis atributos
- Nível, raridade, multiplicador de qualidade e poder total no topo

O cartão fica colado no anúncio. Quando o mouse passa sobre o sprite, o jogo abre o próprio balão de detalhes — nesse caso o cartão se desloca para o lado oposto, ou passa depois do balão quando não há espaço, para que os dois nunca se sobreponham.

Nada disso é informação oculta: o jogo já envia esses dados ao seu navegador em cada página do mercado, apenas não os desenha na tela. A correspondência entre o card e os dados é feita pelo `data-listing-id` do anúncio, então não há risco de exibir os atributos de um Pokémon no lugar de outro.

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

O script continua funcionando igual — só deixa de se atualizar sozinho.

## Isso conta como trapaça?

Não. O script é **somente leitura** e não interfere no jogo de forma alguma:

- Não envia nada ao servidor. Não existe nenhuma chamada de `send` no código.
- Não faz requisições próprias.
- Não automatiza nenhuma ação. A auto-captura e a auto-venda são recursos do próprio jogo.
- Não revela nada oculto. A qualidade já aparece na badge de cada Pokémon, e o mercado já entrega os IVs ao seu navegador — apenas não os desenha na tela.
- Não grava nada nos dados do jogo. Os contadores ficam no armazenamento privado do Tampermonkey.

Ele apenas escuta as mensagens que o navegador já recebe e soma o que elas dizem — o equivalente a anotar os resultados num caderno enquanto joga.

Vale saber o que ele **de fato substitui**: `window.WebSocket` e `window.fetch`. Toda chamada segue para a implementação original, e as interceptações ficam dentro de `try/catch` para que uma falha nunca derrube uma requisição do jogo. Mas é uma substituição real, e um jogo que verifique a integridade dessas funções poderia notar. Confirme as regras do seu servidor antes de usar.

## Como funciona

O jogo transmite os eventos de combate por WebSocket, cada um numerado sequencialmente. O script escuta três deles:

| Evento | Para quê |
| --- | --- |
| `combat.started` | Identifica a espécie da hunt e conta shinies vistos |
| `capture.failed` | Uma tentativa que não deu certo, com a qualidade e a bola usada |
| `capture.success` | Uma captura, com a criatura completa: IVs, natureza, gênero e atributos |

Como cada Pokémon é um evento discreto com a própria qualidade, não há dedução nem estimativa — a atribuição é exata. A numeração sequencial também permite detectar mensagens perdidas na conexão, que são avisadas no rodapé do painel em vez de passarem despercebidas.

Duas chamadas HTTP são lidas, ambas via `clone()` para não consumir a resposta do jogo: `/species`, para nomes e sprites, e `/listings`, para os dados dos anúncios do mercado.

### Limites conhecidos

O registro guarda as **últimas 100 capturas**. O armazenamento do Tampermonkey não é infinito e uma sessão de farm gera milhares de eventos; um log sem limite acabaria estourando.

O hover do mercado é a única parte que depende da estrutura interna do jogo — ele encontra os anúncios pelo atributo `data-listing-id` dos cards. Se o desenvolvedor renomear essas classes, esse recurso para de funcionar sem afetar o resto.

## Segurança

O script foi revisado por terceiros e as correções sugeridas estão aplicadas desde a versão 2.19.0:

- Rótulos vindos do servidor são escapados antes de ir para o DOM.
- O índice de pokébolas usa um objeto sem protótipo e rejeita chaves como `__proto__`.
- URLs de sprite aceitam apenas `http`/`https`.
- Dados lidos do armazenamento são sanitizados: contadores viram inteiros válidos e textos ganham limite de tamanho.
- Nenhum fragmento do token de sessão é gravado — quando o JWT não traz um identificador, é usado um valor derivado.

Se encontrar algo, abra uma [issue](https://github.com/Lfmagliano/pokepixel-raridades/issues).

## Licença

MIT
