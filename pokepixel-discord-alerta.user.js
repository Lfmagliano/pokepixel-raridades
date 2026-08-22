// ==UserScript==
// @name         Pokepixel — Aviso no Discord (companheiro)
// @namespace    https://pokepixel.nietore.com/
// @version      1.2.0
// @description  Avisa num canal do Discord quando você captura um Pokémon de raridade igual ou acima do limite que você escolher. Complemento OPCIONAL da extensão Pokepixel — Raridades.
// @author       Lfmagliano
// @homepageURL  https://github.com/Lfmagliano/pokepixel-raridades
// @supportURL   https://github.com/Lfmagliano/pokepixel-raridades/issues
// @downloadURL  https://raw.githubusercontent.com/Lfmagliano/pokepixel-raridades/main/pokepixel-discord-alerta.user.js
// @updateURL    https://raw.githubusercontent.com/Lfmagliano/pokepixel-raridades/main/pokepixel-discord-alerta.user.js
// @license      MIT
// @match        https://pokepixel.nietore.com/play*
// @run-at       document-idle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      discord.com
// ==/UserScript==

/* =====================================================================
 * O QUE ESTE ARQUIVO É
 *
 * Complemento OPCIONAL. A extensão principal (Pokepixel — Raridades)
 * continua sem fazer requisição nenhuma; ela apenas anuncia cada captura
 * num evento da própria página. Este arquivo escuta esse evento e, se
 * você tiver configurado um webhook, faz UM POST para o Discord.
 *
 * Quem não quiser aviso nenhum simplesmente não instala este arquivo, e
 * nada muda.
 *
 * O QUE ELE FAZ E O QUE NÃO FAZ
 *
 * - Só fala com discord.com. O @connect acima é a trava: o Tampermonkey
 *   recusa qualquer outro destino, inclusive o servidor do jogo.
 * - Não lê nada do jogo por conta própria: zero fetch, zero WebSocket.
 *   O único insumo é o evento que a extensão principal emite.
 * - Não toca no jogo, não automatiza nada, não envia nada ao servidor
 *   do Pokepixel.
 * - Webhook do Discord NÃO é login: você cria a URL nas configurações de
 *   um canal seu (Editar canal → Integrações → Webhooks). Ela não dá
 *   acesso à sua conta, e este script nunca vê credencial nenhuma.
 *
 * SOBRE O SEGREDO
 *
 * A URL do webhook fica no armazenamento do Tampermonkey, em texto puro.
 * Quem tiver acesso ao perfil do seu navegador consegue lê-la, e quem
 * tiver a URL consegue postar naquele canal. Não é catástrofe (dá para
 * apagar o webhook no Discord a qualquer momento), mas trate como senha:
 * não publique prints do painel de configuração nem exporte a config.
 * ===================================================================== */

(function () {
    'use strict';

    const W = (typeof unsafeWindow !== 'undefined' && unsafeWindow) || window;

    const EVENTO = 'pokepixel-raridades:captura';
    const EVENTO_CONTA = 'pokepixel-raridades:conta';
    const EVENTO_QUEM = 'pokepixel-raridades:quem';
    const K_URL  = 'ppd_webhook_v1';    // legado: webhook único, migrado para PADRAO
    const K_MAPA = 'ppd_webhooks_v1';   // { "PADRAO": url, "NomeDaConta": url }
    const K_MIN  = 'ppd_minimo_v1';     // legado: mínimo único, migrado para PADRAO
    const K_MINS = 'ppd_minimos_v1';    // { "PADRAO": "epic", "NomeDaConta": "rare" }
    const K_ON   = 'ppd_ligado_v1';
    const PADRAO = '*';                 // vale para conta sem webhook próprio

    // Conta desta aba. O principal anuncia assim que identifica, e cada
    // captura reconfirma. Duas abas com contas diferentes têm cada uma a sua,
    // mesmo o armazenamento do Tampermonkey sendo compartilhado.
    let contaDaAba = null;

    // Mesma ordem de raridade da extensão principal.
    const TIERS = ['weak', 'common', 'uncommon', 'rare', 'epic', 'legendary', 'mythical'];
    const ROTULO = {
        weak: 'Fraca', common: 'Comum', uncommon: 'Incomum', rare: 'Rara',
        epic: 'Épica', legendary: 'Lendária', mythical: 'Mítica',
    };
    // Cor da barra lateral do embed, em decimal (o Discord não aceita "#rrggbb").
    const COR = {
        weak: 0x8b8b95, common: 0x54d97c, uncommon: 0x4fc6ea, rare: 0x9b7cf0,
        epic: 0xd9b665, legendary: 0xe8913c, mythical: 0xf05f9b,
    };

    const ler = (k, padrao) => {
        try { const v = GM_getValue(k, padrao); return v === undefined ? padrao : v; }
        catch (e) { return padrao; }
    };
    const gravar = (k, v) => { try { GM_setValue(k, v); } catch (e) { /* ignora */ } };

    // Mapa de webhooks, com migração da versão de webhook único. A migração
    // roda uma vez e apaga a chave antiga, para não restar segredo duplicado.
    function lerMapa() {
        let mapa = {};
        try { mapa = JSON.parse(ler(K_MAPA, '{}')) || {}; } catch (e) { mapa = {}; }
        if (typeof mapa !== 'object' || Array.isArray(mapa)) mapa = {};
        const antigo = ler(K_URL, '');
        if (antigo) {
            // Migra só o que passaria pela validação hoje: a chave legada é
            // um valor antigo, não uma porta de entrada para contornar a trava
            // de domínio. Inválido é descartado, não promovido a padrão.
            if (!mapa[PADRAO] && webhookValido(antigo)) mapa[PADRAO] = antigo;
            gravar(K_MAPA, JSON.stringify(mapa));
            gravar(K_URL, '');
        }
        return mapa;
    }

    // Webhook de uma conta: o próprio dela, ou o padrão. Conta nula cai no
    // padrão — é o caso de quem nunca separou nada.
    function webhookDe(conta) {
        const mapa = lerMapa();
        const url = (conta && mapa[conta]) || mapa[PADRAO] || '';
        return webhookValido(url) ? url : '';
    }

    // Raridade mínima também é por conta: caçar Tyranitar numa e Machamp na
    // outra pede limites diferentes. Mesma migração da chave única.
    function lerMinimos() {
        let mapa = {};
        try { mapa = JSON.parse(ler(K_MINS, '{}')) || {}; } catch (e) { mapa = {}; }
        if (typeof mapa !== 'object' || Array.isArray(mapa)) mapa = {};
        const antigo = ler(K_MIN, '');
        if (antigo) {
            if (!mapa[PADRAO]) mapa[PADRAO] = antigo;
            gravar(K_MINS, JSON.stringify(mapa));
            gravar(K_MIN, '');
        }
        if (!mapa[PADRAO]) mapa[PADRAO] = 'epic';
        return mapa;
    }

    function minimoDe(conta) {
        const mapa = lerMinimos();
        const v = (conta && mapa[conta]) || mapa[PADRAO] || 'epic';
        return TIERS.indexOf(v) >= 0 ? v : 'epic';
    }

    function definirMinimo(chave, tier) {
        const mapa = lerMinimos();
        mapa[chave] = tier;
        gravar(K_MINS, JSON.stringify(mapa));
    }

    function definirWebhook(chave, url) {
        const mapa = lerMapa();
        if (url) mapa[chave] = url; else delete mapa[chave];
        gravar(K_MAPA, JSON.stringify(mapa));
    }

    // Só aceita webhook do próprio Discord, e só por https. Uma URL de outro
    // domínio seria recusada pelo @connect de qualquer forma, mas recusar aqui
    // dá erro claro em vez de falha silenciosa.
    function webhookValido(url) {
        try {
            const u = new URL(String(url));
            return u.protocol === 'https:'
                && (u.hostname === 'discord.com' || u.hostname === 'discordapp.com')
                && /^\/api\/webhooks\//.test(u.pathname);
        } catch (e) { return false; }
    }

    const nivelDe = q => {
        const i = TIERS.indexOf(String(q || '').toLowerCase());
        return i < 0 ? 0 : i;
    };

    const NOMES_IV = ['HP', 'Ataque', 'Defesa', 'Atq. Esp.', 'Def. Esp.', 'Velocidade'];

    function montarMensagem(c, conta) {
        const rot = ROTULO[c.q] || c.q;
        const nome = (c.nome && c.nome !== c.sp ? c.nome : c.sp) || '?';
        const titulo = `${nome}${c.shiny ? ' ✦ shiny' : ''} — ${rot}`;

        const campos = [
            { name: 'Raridade', value: `${rot}${c.mult ? ` (×${c.mult.toFixed(2).replace('.', ',')})` : ''}`, inline: true },
            { name: 'IV total', value: `${c.iv}/186`, inline: true },
        ];
        if (c.nat) campos.push({ name: 'Natureza', value: String(c.nat), inline: true });
        if (c.gen) campos.push({ name: 'Gênero', value: c.gen === 'male' ? 'Macho ♂' : 'Fêmea ♀', inline: true });
        if (c.bola) campos.push({ name: 'Pokébola', value: String(c.bola), inline: true });
        if (c.sold) campos.push({ name: 'Destino', value: 'Vendido automaticamente', inline: true });
        if (Array.isArray(c.det) && c.det.length === 6) {
            campos.push({
                name: 'IV por atributo',
                value: c.det.map((v, i) => `${NOMES_IV[i]} ${v}/31`).join(' · '),
                inline: false,
            });
        }

        const sprite = c.sp
            ? `https://pokepixel.nietore.com/assets/imported/creatures/${encodeURIComponent(c.sp)}/${c.shiny ? 'shiny' : 'front'}.png`
            : null;

        return {
            username: 'Pokepixel — Raridades',
            embeds: [{
                title: titulo,
                color: COR[c.q] || 0x8b8b95,
                fields: campos,
                thumbnail: sprite ? { url: sprite } : undefined,
                footer: { text: conta ? `Conta ${conta}` : 'Pokepixel' },
                timestamp: new Date().toISOString(),
            }],
        };
    }

    // Fila simples: o Discord limita a frequência dos webhooks, e uma captura
    // rara logo depois da outra não pode perder o aviso.
    const fila = [];
    let enviando = false;

    function enfileirar(corpo, conta) {
        // O destino viaja junto: com duas contas na mesma fila, resolver o
        // webhook só na hora do envio mandaria a captura de uma para o canal
        // da outra sempre que as duas caíssem juntas.
        fila.push({ corpo, url: webhookDe(conta) });
        if (fila.length > 20) fila.shift();   // não acumula para sempre
        escoar();
    }

    function escoar() {
        if (enviando || !fila.length) return;
        const item = fila.shift();
        const url = item.url;
        if (!webhookValido(url)) { escoar(); return; }

        enviando = true;
        const corpo = item.corpo;
        const seguir = espera => {
            enviando = false;
            setTimeout(escoar, espera || 300);
        };

        try {
            GM_xmlhttpRequest({
                method: 'POST',
                url,
                headers: { 'Content-Type': 'application/json' },
                data: JSON.stringify(corpo),
                onload: res => {
                    // 429 = passou do limite; o Discord diz quanto esperar.
                    if (res.status === 429) {
                        let espera = 2000;
                        try { espera = Math.ceil((JSON.parse(res.responseText).retry_after || 2) * 1000); }
                        catch (e) { /* usa o padrão */ }
                        fila.unshift(item);
                        seguir(Math.min(espera, 30000));
                        return;
                    }
                    if (res.status < 200 || res.status >= 300) {
                        console.warn('[Aviso Discord] o Discord recusou:', res.status, res.responseText);
                    }
                    seguir();
                },
                onerror: () => { console.warn('[Aviso Discord] falha de rede'); seguir(); },
                ontimeout: () => { console.warn('[Aviso Discord] tempo esgotado'); seguir(); },
                timeout: 15000,
            });
        } catch (e) {
            console.warn('[Aviso Discord] não consegui enviar:', e);
            seguir();
        }
    }

    W.addEventListener(EVENTO, ev => {
        try {
            if (!ler(K_ON, true)) return;
            const d = ev && ev.detail;
            const c = d && d.captura;
            if (!c || !c.q) return;
            if (d.conta) contaDaAba = d.conta;
            if (nivelDe(c.q) < nivelDe(minimoDe(d.conta))) return;
            if (!webhookDe(d.conta)) return;
            enfileirar(montarMensagem(c, d.conta), d.conta);
        } catch (e) {
            // Nunca deixar um erro daqui atrapalhar a extensão principal.
            console.warn('[Aviso Discord] erro ao tratar captura:', e);
        }
    });

    // Quem é a conta desta aba, anunciado pelo principal antes de qualquer
    // captura — é o que permite configurar o webhook de cada conta na aba dela.
    W.addEventListener(EVENTO_CONTA, ev => {
        const c = ev && ev.detail && ev.detail.conta;
        if (c) contaDaAba = String(c).slice(0, 60);
    });

    // Pergunta em vez de esperar. O principal roda em document-start e
    // anuncia a conta quando o WebSocket conecta — quase sempre antes de este
    // arquivo (document-idle) existir. Esperando o anúncio, a aba ficava sem
    // dono de forma intermitente, e quem tivesse só webhook por conta não
    // recebia aviso nenhum ali. Perguntando, o tempo deixa de importar.
    function perguntarConta() {
        try { W.dispatchEvent(new W.CustomEvent(EVENTO_QUEM, { detail: { versao: 1 } })); }
        catch (e) { /* principal ausente ou antigo */ }
    }
    perguntarConta();
    // O nome da conta pode chegar depois do carregamento (o jogo às vezes só
    // identifica o treinador na primeira resposta). Algumas tentativas
    // espaçadas cobrem isso sem ficar perguntando para sempre.
    let tentativas = 0;
    const insistir = setInterval(() => {
        if (contaDaAba || ++tentativas > 10) { clearInterval(insistir); return; }
        perguntarConta();
    }, 1500);

    /* ---------------------------------------------------------------
     * Configuração pelo menu do Tampermonkey — sem console, sem colar
     * nada em lugar nenhum da página.
     * ------------------------------------------------------------- */
    function menu() {
        try {
            const pedirUrl = (chave, rotulo) => {
                const mapa = lerMapa();
                const v = W.prompt(
                    'Webhook para ' + rotulo + '.\n\n'
                    + 'Onde achar: no Discord (no computador), clique com o botão direito\n'
                    + 'no canal → Editar Canal → Integrações → Webhooks → Novo Webhook\n'
                    + '→ Copiar URL do Webhook.\n\n'
                    + 'Deixe em branco para remover.', mapa[chave] || '');
                if (v === null) return;
                const limpo = String(v).trim();
                if (!limpo) { definirWebhook(chave, ''); W.alert('Webhook removido de ' + rotulo + '.'); return; }
                if (!webhookValido(limpo)) {
                    W.alert('Isso não parece um webhook do Discord.\n\n'
                        + 'A URL tem que começar com https://discord.com/api/webhooks/');
                    return;
                }
                definirWebhook(chave, limpo);
                W.alert('Webhook salvo para ' + rotulo + '.\nUse "enviar teste" para conferir.');
            };

            GM_registerMenuCommand('Aviso Discord: webhook DESTA conta', () => {
                if (!contaDaAba) perguntarConta();
                if (!contaDaAba) {
                    W.alert('Ainda não sei qual conta está nesta aba.\n\n'
                        + 'Abra o painel Raridades uma vez (o nome da conta aparece no topo)\n'
                        + 'e tente de novo. Ou use "webhook padrão", que vale para todas.');
                    return;
                }
                pedirUrl(contaDaAba, 'a conta ' + contaDaAba);
            });

            GM_registerMenuCommand('Aviso Discord: webhook padrão (todas)', () => {
                pedirUrl(PADRAO, 'qualquer conta sem webhook próprio');
            });

            GM_registerMenuCommand('Aviso Discord: raridade mínima', () => {
                // Aplica à conta desta aba quando ela é conhecida; sem conta
                // identificada, mexe no padrão. O prompt diz qual dos dois,
                // para não trocar o limite da conta errada sem perceber.
                const chave = contaDaAba || PADRAO;
                const rotulo = contaDaAba ? 'a conta ' + contaDaAba : 'o padrão (todas as contas)';
                const atual = minimoDe(contaDaAba);
                const lista = TIERS.map((t, i) => `${i + 1} — ${ROTULO[t]}`).join('\n');
                const v = W.prompt('Avisar a partir de qual raridade, para ' + rotulo + '?\n\n' + lista,
                    String(TIERS.indexOf(atual) + 1));
                if (v === null) return;
                const n = Number(v);
                if (!Number.isInteger(n) || n < 1 || n > TIERS.length) {
                    W.alert(`Digite um número de 1 a ${TIERS.length}.`);
                    return;
                }
                definirMinimo(chave, TIERS[n - 1]);
                W.alert(`Avisando a partir de ${ROTULO[TIERS[n - 1]]} para ${rotulo}.`);
            });

            GM_registerMenuCommand('Aviso Discord: ligar/desligar', () => {
                const novo = !ler(K_ON, true);
                gravar(K_ON, novo);
                W.alert(novo ? 'Avisos LIGADOS.' : 'Avisos DESLIGADOS.');
            });

            GM_registerMenuCommand('Aviso Discord: enviar teste', () => {
                if (!webhookDe(contaDaAba)) {
                    W.alert('Configure o webhook primeiro.');
                    return;
                }
                enfileirar(montarMensagem({
                    sp: 'charizard', nome: 'Charizard', q: 'epic', iv: 134,
                    det: [27, 31, 11, 31, 29, 5], mult: 1.74, nat: 'serious',
                    gen: 'female', bola: 'Ultra Ball', shiny: true, sold: false,
                }, contaDaAba || 'teste'), contaDaAba);
                W.alert('Teste enviado' + (contaDaAba ? ' pelo webhook da conta ' + contaDaAba : '')
                    + '. Confira o canal.');
            });

            GM_registerMenuCommand('Aviso Discord: ver configuração', () => {
                const mapa = lerMapa();
                // Mostra só o suficiente para identificar, nunca o token inteiro.
                const curto = u => webhookValido(u)
                    ? u.replace(/(\/api\/webhooks\/\d+\/).*/, '$1…') : '(nenhum)';
                const linhas = Object.keys(mapa).sort().map(k =>
                    (k === PADRAO ? 'padrão' : k) + ': ' + curto(mapa[k]));
                const mins = lerMinimos();
                const linhasMin = Object.keys(mins).sort().map(k =>
                    (k === PADRAO ? 'padrão' : k) + ': ' + (ROTULO[mins[k]] || '?'));
                W.alert('Conta desta aba: ' + (contaDaAba || '(ainda não identificada)')
                    + '\n\nWebhooks:\n' + (linhas.length ? linhas.join('\n') : '(nenhum)')
                    + '\n\nRaridade mínima:\n' + linhasMin.join('\n')
                    + '\n\nAvisos: ' + (ler(K_ON, true) ? 'ligados' : 'desligados'));
            });
        } catch (e) { /* sem menu, o script ainda funciona com o que já foi salvo */ }
    }

    menu();
})();
