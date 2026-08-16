# Pokepixel — Raridades

Userscript que acumula o que o [Pokepixel](https://pokepixel.nietore.com/play/) mostra de relance mas nunca soma: quantas pokébolas você gastou em cada raridade, qual a sua taxa real de captura por tier, e o histórico completo das suas capturas — por conta e por mapa de caçada.

O jogo informa a qualidade de cada Pokémon e a raridade de cada captura, mas não guarda nada disso. Se você quer saber o quão brutal é de fato capturar um Mítico, ou se a Ultra Bola compensa em relação à Super, não há como descobrir jogando.

## O que ele mostra

**Por raridade** — tentativas, capturas e taxa de captura de cada qualidade, da Fraca à Mítica, com uma linha "Todos" somando tudo.

**Por pokébola** — os mesmos números separados por tipo de bola, da Poké Ball à Pixel Ball, cada uma com seu ícone nas cores reais.

**Capturas** — o registro das últimas 100 capturas, uma por linha, com raridade, IV total, natureza, gênero, bola usada e se a venda automática levou o Pokémon. Filtros por raridade, faixa de IV e destino.

**Detalhes no hover** — passando o mouse sobre qualquer captura, aparece um cartão no mesmo formato do card do jogo: poder total, IV total, a faixa de raridade, cada atributo de batalha com o IV que o gerou, e a genética completa com natureza, gênero e os bônus de cada um.

**Estatísticas por hunt** — além do total geral, cada mapa que você caçou tem seus próprios números. Dá para comparar como está indo no Tyranitar contra como foi no Machamp, e zerar uma hunt sem perder as outras.

**Hunt atual** — o sprite e o nome da espécie do mapa em que você está caçando. Clique no sprite para alternar entre normal e shiny. Ao voltar à cidade, o cartão avisa que não há caçada em andamento.

Os contadores são separados por conta, então dá para jogar com duas contas em abas diferentes sem que uma sobrescreva a outra.

## O cartão de detalhes

Passando o mouse sobre uma captura, o cartão mostra tudo que o jogo exibe na tela do Pokémon, reunido num lugar só:

- **Poder total** e **IV total**, com barra de progresso
- **Raridade** — o multiplicador do Pokémon dentro da faixa do tier dele, por exemplo `×1,95 / ×1,99 · Shiny · Lendária · faixa 1,80 – 1,99`
- **Atributos de batalha** — cada um com o valor efetivo e o IV que o gerou (`ATK 1.384 · 24/31`), com seta indicando o que a natureza favorece ou prejudica
- **Genética** — natureza, gênero e os ganhos de cada um

A faixa de raridade é a informação mais útil ali: o multiplicador sozinho não diz nada, mas saber que um Lendário ×1,56 está no piso do tier enquanto um ×1,68 está quase virando Mítico muda como você avalia a captura.

Essas faixas são lidas do endpoint `/formulas` do próprio jogo, não fixadas no código — se o desenvolvedor rebalancear os tiers, a extensão acompanha sozinha. São duas tabelas distintas: shiny tem apenas três faixas, e a mais baixa delas fica acima da lendária normal.

Já o efeito da natureza sobre os atributos não vem da API: é deduzido de uma tabela fixa das 25 naturezas, a mesma dos jogos da série.

## Estatísticas por hunt

O seletor **Mostrando estatísticas** fica no cartão da hunt atual e troca o que as três abas exibem. Escolhendo "Todas as hunts", os números são o acumulado da conta; escolhendo um mapa, tudo passa a ser daquele mapa — raridades, pokébolas e o registro de capturas.

Cada tentativa é creditada ao total e à hunt corrente na mesma passagem, então **a soma das hunts é sempre igual ao total**. Isso é possível porque o evento que identifica a hunt sempre chega antes das bolas daquele combate.

Sair de uma hunt e voltar depois **retoma de onde parou** — os contadores de cada mapa são preservados até você decidir zerá-los.

O botão de zerar acompanha a seleção: com uma hunt escolhida ele vira "Zerar Machamp" e afeta só ela, enquanto em "Todas as hunts" ele vira "Zerar tudo". Ao zerar uma hunt, os números dela também saem do total — do contrário o total guardaria valores que não aparecem em nenhum perfil.

São guardadas **40 hunts**. Passando disso, sai a que ficou mais tempo sem uso, e não a mais antiga: assim o mapa que você caça todo dia nunca é descartado por ter sido o primeiro.

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
- Não revela nada oculto. A qualidade já aparece na badge de cada Pokémon, e os atributos vêm no próprio evento de captura.
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

Duas chamadas HTTP são lidas, ambas via `clone()` para não consumir a resposta do jogo: `/species`, para nomes e sprites, e `/stop`, que o jogo dispara ao voltar à cidade e serve para o cartão parar de apontar um mapa. Nenhuma delas é modificada, e o script não faz requisições próprias.

Duas tabelas de referência completam o cartão: as faixas de raridade, lidas de `/formulas`, e o efeito das naturezas, que é fixo no código por não vir da API.

### Limites conhecidos

O registro guarda as **últimas 100 capturas**. O armazenamento do Tampermonkey não é infinito e uma sessão de farm gera milhares de eventos; um log sem limite acabaria estourando.

São guardadas as **40 hunts** menos ociosas, e capturas feitas fora de uma caçada entram no total sem serem creditadas a nenhum mapa.

Não existe evento de "entrei na cidade" além do `/stop`. Se você recarregar a página já estando lá, o cartão leva até um minuto de inatividade para reconhecer que não há caçada.

Capturas registradas antes da versão 2.23 não guardaram os atributos de batalha, e o cartão avisa isso em vez de mostrar campos vazios. A faixa de raridade só aparece se o `/formulas` tiver passado pelo script naquela sessão — na ausência dele, a caixa é omitida em vez de exibir uma faixa inventada.

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
