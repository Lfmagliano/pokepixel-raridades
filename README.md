# Pokepixel — Raridades

Userscript que conta tentativas e capturas por qualidade (Fraca a Mítica) no [Pokepixel](https://pokepixel.nietore.com/play/), mostrando a taxa de captura real de cada tier.

O jogo informa a qualidade de cada Pokémon, mas não acumula essas informações em lugar nenhum. Se você quer saber quantas pokébolas gastou por raridade — ou o quão brutal é de fato capturar um Mítico — não há como descobrir jogando. Esse script preenche essa lacuna.

## O que ele mostra

- **Por raridade** — tentativas, capturas e taxa de captura de cada qualidade, mais uma linha "Todos" com o total.
- **Por pokébola** — os mesmos números separados por tipo de bola, da Poké Ball à Pixel Ball.
- **Hunt atual** — o sprite e o nome da espécie do mapa em que você está caçando. Clique no sprite para alternar entre normal e shiny.
- **Shinies** — quantos apareceram e quantos você capturou.

Os contadores são separados por conta, então dá para jogar com duas contas em abas diferentes sem que uma sobrescreva a contagem da outra.

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
- Não revela nada oculto. A qualidade já aparece na badge de cada Pokémon, e o registro de capturas do jogo já lista cada captura com sua raridade.
- Não grava nada nos dados do jogo. Os contadores ficam no armazenamento privado do Tampermonkey.

Ele apenas escuta as mensagens que o navegador já recebe e soma o que elas dizem — o equivalente a anotar os resultados num caderno enquanto joga.

Vale saber o que ele **de fato substitui**: `window.WebSocket` e `window.fetch`. Toda chamada segue para a implementação original, e as interceptações ficam dentro de `try/catch` para que uma falha nunca derrube uma requisição do jogo. Mas é uma substituição real, e um jogo que verifique a integridade dessas funções poderia notar. Confirme as regras do seu servidor antes de usar.

## Como funciona

O jogo transmite os eventos de combate por WebSocket, cada um numerado sequencialmente. O script escuta três deles:

| Evento | Para quê |
| --- | --- |
| `combat.started` | Identifica a espécie da hunt e conta shinies vistos |
| `capture.failed` | Uma tentativa que não deu certo, com a qualidade e a bola usada |
| `capture.success` | Uma captura, com a qualidade e a bola usada |

Como cada Pokémon é um evento discreto com a própria qualidade, não há dedução nem estimativa envolvida — a atribuição é exata. A numeração sequencial também permite detectar mensagens perdidas na conexão, que são avisadas no rodapé do painel em vez de passarem despercebidas.

Uma única chamada HTTP é lida (`/species`, via `clone()`), apenas para obter os nomes e as URLs dos sprites.

## Segurança

O script foi revisado por terceiros e as correções sugeridas estão aplicadas a partir da versão 2.19.0:

- Rótulos vindos do servidor são escapados antes de ir para o DOM.
- O índice de pokébolas usa um objeto sem protótipo e rejeita chaves como `__proto__`.
- URLs de sprite aceitam apenas `http`/`https`.
- Dados lidos do armazenamento são sanitizados: contadores viram inteiros válidos e textos ganham limite de tamanho.
- Nenhum fragmento do token de sessão é gravado — quando o JWT não traz um identificador, é usado um valor derivado.

Se encontrar algo, abra uma [issue](https://github.com/Lfmagliano/pokepixel-raridades/issues).

## Licença

MIT
