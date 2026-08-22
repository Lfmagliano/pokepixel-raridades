// ==UserScript==
// @name         Pokepixel — Aviso no Discord (companheiro)
// @namespace    https://pokepixel.nietore.com/
// @version      1.3.0
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
     * Configuração numa tela própria, sem diálogo do navegador.
     *
     * A versão anterior usava prompt() e alert(). Quem desmarca os avisos
     * do Tampermonkey, ou marca "impedir que esta página crie mais
     * diálogos" no Chrome, passa a receber null em todo prompt — e a
     * configuração inteira para de funcionar sem erro nenhum. Nada de
     * diálogo nativo aqui: entrada por campo, resposta por linha de
     * status, tudo dentro da página.
     * ------------------------------------------------------------- */
    const CSS = `
    #ppd-fundo {
        position: fixed; inset: 0; z-index: 2147483000; display: none;
        background: rgba(0,0,0,.6); align-items: center; justify-content: center;
        font-family: ui-sans-serif, system-ui, sans-serif;
    }
    #ppd-fundo.ppd-on { display: flex; }
    #ppd-painel {
        width: min(520px, 92vw); max-height: 88vh; overflow: auto;
        background: #0e0e10; border: 1px solid #2a2a31; border-radius: 14px;
        color: #e6e6ea; box-shadow: 0 24px 60px rgba(0,0,0,.7); padding: 18px 20px 16px;
    }
    #ppd-painel h2 { margin: 0 0 2px; font-size: 15px; letter-spacing: .02em; }
    #ppd-conta { margin: 0 0 14px; color: #7a7a86; font-size: 11px; }
    .ppd-campo { margin-bottom: 13px; }
    .ppd-campo > label {
        display: block; margin-bottom: 5px; color: #7a7a86;
        font-size: 10px; letter-spacing: .1em; text-transform: uppercase;
    }
    .ppd-campo input[type=text], .ppd-campo input[type=password], .ppd-campo select {
        width: 100%; box-sizing: border-box; background: #16161a;
        border: 1px solid #26262e; border-radius: 8px; color: #e6e6ea;
        padding: 8px 10px; font-size: 12.5px; font-family: inherit;
    }
    .ppd-dica { margin: 5px 0 0; color: #6c6c78; font-size: 11px; line-height: 1.45; }
    .ppd-linha { display: flex; gap: 8px; align-items: center; }
    .ppd-chk { display: flex; gap: 7px; align-items: center; color: #b9b9c4; font-size: 12px; }
    #ppd-botoes { display: flex; gap: 8px; margin-top: 16px; flex-wrap: wrap; }
    .ppd-btn {
        background: #16161a; border: 1px solid #26262e; border-radius: 9px;
        color: #b9b9c4; padding: 8px 14px; cursor: pointer;
        font: 600 12px/1 inherit; letter-spacing: .04em;
    }
    .ppd-btn:hover { border-color: #3a3a45; color: #e6e6ea; }
    .ppd-btn--ok { border-color: #2f5d3a; color: #9fe0b3; }
    .ppd-btn--ok:hover { border-color: #54d97c; color: #cdf5da; }
    #ppd-status {
        margin: 12px 0 0; min-height: 16px; font-size: 12px; line-height: 1.4;
        color: #8b8b95;
    }
    #ppd-status.ppd-bom { color: #9fe0b3; }
    #ppd-status.ppd-ruim { color: #f0a5a5; }
    `;

    let ui = null;

    function montarUi() {
        if (ui) return ui;
        const est = document.createElement('style');
        est.textContent = CSS;
        document.head.appendChild(est);

        const fundo = document.createElement('div');
        fundo.id = 'ppd-fundo';
        fundo.innerHTML = `
            <div id="ppd-painel" role="dialog" aria-modal="true">
                <h2>Aviso no Discord</h2>
                <p id="ppd-conta"></p>

                <div class="ppd-campo">
                    <label for="ppd-hook">Webhook desta conta</label>
                    <input id="ppd-hook" type="password" spellcheck="false"
                           placeholder="https://discord.com/api/webhooks/..." />
                    <p class="ppd-dica">No Discord (no computador): botão direito no canal →
                       Editar Canal → Integrações → Webhooks → Novo Webhook → Copiar URL.
                       Deixe em branco para remover.</p>
                </div>

                <div class="ppd-campo">
                    <label for="ppd-hook-padrao">Webhook padrão (contas sem o próprio)</label>
                    <input id="ppd-hook-padrao" type="password" spellcheck="false"
                           placeholder="opcional" />
                </div>

                <div class="ppd-campo ppd-linha">
                    <label class="ppd-chk"><input id="ppd-ver" type="checkbox" /> Mostrar os webhooks</label>
                </div>

                <div class="ppd-campo">
                    <label for="ppd-min">Raridade mínima desta conta</label>
                    <select id="ppd-min"></select>
                </div>

                <div class="ppd-campo ppd-linha">
                    <label class="ppd-chk"><input id="ppd-on" type="checkbox" /> Avisos ligados</label>
                </div>

                <div id="ppd-botoes">
                    <button class="ppd-btn ppd-btn--ok" id="ppd-salvar" type="button">Salvar</button>
                    <button class="ppd-btn" id="ppd-teste" type="button">Enviar teste</button>
                    <button class="ppd-btn" id="ppd-fechar" type="button">Fechar</button>
                </div>
                <p id="ppd-status"></p>
            </div>`;
        document.body.appendChild(fundo);

        const $ = id => fundo.querySelector('#' + id);
        ui = {
            fundo, hook: $('ppd-hook'), padrao: $('ppd-hook-padrao'), ver: $('ppd-ver'),
            min: $('ppd-min'), on: $('ppd-on'), status: $('ppd-status'), conta: $('ppd-conta'),
        };

        TIERS.forEach((t, i) => {
            const o = document.createElement('option');
            o.value = t; o.textContent = `${i + 1} — ${ROTULO[t]}`;
            ui.min.appendChild(o);
        });

        ui.ver.addEventListener('change', () => {
            const tipo = ui.ver.checked ? 'text' : 'password';
            ui.hook.type = tipo; ui.padrao.type = tipo;
        });
        $('ppd-fechar').addEventListener('click', fecharUi);
        fundo.addEventListener('click', ev => { if (ev.target === fundo) fecharUi(); });
        $('ppd-salvar').addEventListener('click', salvarUi);
        $('ppd-teste').addEventListener('click', testarUi);
        return ui;
    }

    function aviso(texto, tipo) {
        if (!ui) return;
        ui.status.textContent = texto;
        ui.status.className = tipo === 'bom' ? 'ppd-bom' : tipo === 'ruim' ? 'ppd-ruim' : '';
    }

    function abrirUi() {
        montarUi();
        if (!contaDaAba) perguntarConta();
        const mapa = lerMapa();
        ui.conta.textContent = contaDaAba
            ? `Conta desta aba: ${contaDaAba}`
            : 'Conta desta aba ainda não identificada — abra o painel Raridades uma vez. '
              + 'Até lá, só o webhook padrão vale.';
        ui.hook.value = (contaDaAba && mapa[contaDaAba]) || '';
        ui.hook.disabled = !contaDaAba;
        ui.padrao.value = mapa[PADRAO] || '';
        ui.min.value = minimoDe(contaDaAba);
        ui.on.checked = !!ler(K_ON, true);
        aviso('');
        ui.fundo.classList.add('ppd-on');
    }

    function fecharUi() { if (ui) ui.fundo.classList.remove('ppd-on'); }

    function salvarUi() {
        const par = [[contaDaAba, ui.hook], [PADRAO, ui.padrao]];
        for (const [chave, campo] of par) {
            if (!chave) continue;
            const v = String(campo.value || '').trim();
            if (v && !webhookValido(v)) {
                aviso('Isso não parece um webhook do Discord. A URL começa com '
                    + 'https://discord.com/api/webhooks/', 'ruim');
                return;
            }
            definirWebhook(chave, v);
        }
        definirMinimo(contaDaAba || PADRAO, ui.min.value);
        gravar(K_ON, !!ui.on.checked);
        aviso('Salvo. Avisando a partir de ' + (ROTULO[ui.min.value] || '?')
            + (contaDaAba ? ` para a conta ${contaDaAba}.` : ' (padrão).'), 'bom');
    }

    function testarUi() {
        salvarUi();
        if (!webhookDe(contaDaAba)) {
            aviso('Configure e salve um webhook antes de testar.', 'ruim');
            return;
        }
        enfileirar(montarMensagem({
            sp: 'charizard', nome: 'Charizard', q: 'epic', iv: 134,
            det: [27, 31, 11, 31, 29, 5], mult: 1.74, nat: 'serious',
            gen: 'female', bola: 'Ultra Ball', shiny: true, sold: false,
        }, contaDaAba || 'teste'), contaDaAba);
        aviso('Teste enviado. Confira o canal.', 'bom');
    }

    function menu() {
        try {
            GM_registerMenuCommand('Aviso Discord: configurar', abrirUi);
        } catch (e) { /* sem menu, o que já foi salvo continua valendo */ }
    }

    menu();
})();
