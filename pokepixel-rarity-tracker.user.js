// ==UserScript==
// @name         Pokepixel — Raridades
// @namespace    https://pokepixel.nietore.com/
// @version      2.18.0
// @description  Conta tentativas e capturas por qualidade (Fraca a Mítica) lendo os eventos de captura do jogo.
// @author       Lfmagliano
// @homepageURL  https://github.com/Lfmagliano/pokepixel-raridades
// @supportURL   https://github.com/Lfmagliano/pokepixel-raridades/issues
// @downloadURL  https://raw.githubusercontent.com/Lfmagliano/pokepixel-raridades/main/pokepixel-rarity-tracker.user.js
// @updateURL    https://raw.githubusercontent.com/Lfmagliano/pokepixel-raridades/main/pokepixel-rarity-tracker.user.js
// @license      MIT
// @match        https://pokepixel.nietore.com/play*
// @run-at       document-start
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        unsafeWindow
// ==/UserScript==

(function () {
    'use strict';

    // Com qualquer @grant ativo o Tampermonkey roda num sandbox: patchear
    // `window` ali não afeta o que a página realmente usa.
    const W = (typeof unsafeWindow !== 'undefined' && unsafeWindow) || window;

    /* ---------------------------------------------------------------
     * Raridades: ordem, rótulo em pt-BR e cor da badge do jogo
     * ------------------------------------------------------------- */
    const RARITIES = [
        { key: 'weak',      label: 'Fraca',    color: '#c9ced4' },
        { key: 'common',    label: 'Comum',    color: '#54d97c' },
        { key: 'uncommon',  label: 'Incomum',  color: '#4fc6ea' },
        { key: 'rare',      label: 'Rara',     color: '#a173f5' },
        { key: 'epic',      label: 'Épica',    color: '#f2d14b' },
        { key: 'legendary', label: 'Lendária', color: '#ff9a3c' },
        { key: 'mythical',  label: 'Mítica',   color: '#ff62aa' },
    ];
    const RARITY_KEYS = RARITIES.map(r => r.key);
    const ALL_ROW = { label: 'Todos', color: '#f5f7fa' };
    // Pokébolas na ordem de eficiência do jogo (×1 a ×5), com a cor de cada
    // uma. O jogo alterna nomes em inglês e português entre a loja, o
    // registro e os eventos, então o casamento é feito por item_id ou nome.
    // top/band/bottom reproduzem a pokébola real; `color` é o tom que o
    // rótulo usa (na Ultra o preto sumiria no painel escuro, então vale o
    // amarelo dos detalhes).
    const BALLS = [
        { key: 'poke',  label: 'Poké Ball',  match: /poke|poké/i,
          color: '#f0554a', top: '#ee4b3c', band: '#141418', bottom: '#f2f3f5' },
        { key: 'great', label: 'Great Ball', match: /great|grande/i,
          color: '#4a8ce8', top: '#2f6fd0', band: '#d8433a', bottom: '#f2f3f5' },
        { key: 'super', label: 'Super Ball', match: /super/i,
          color: '#f2913d', top: '#ef8a2c', band: '#f2c744', bottom: '#f2f3f5' },
        { key: 'ultra', label: 'Ultra Ball', match: /ultra/i,
          color: '#f2c744', top: '#26262c', band: '#f2c744', bottom: '#f2f3f5' },
        { key: 'pixel', label: 'Pixel Ball', match: /pixel/i,
          color: '#4aa8f0', top: '#2f7fe0', band: '#f2c744', bottom: '#2f7fe0' },
    ];
    const BALL_BY_KEY = BALLS.reduce((m, b) => (m[b.key] = b, m), {});
    const OTHER_BALL_COLOR = '#9aa0a6';

    function ballKey(itemId, name) {
        const alvo = `${itemId || ''} ${name || ''}`;
        const achou = BALLS.find(b => b.match.test(alvo));
        return achou ? achou.key : (name || itemId || 'Desconhecida');
    }

    const ALIASES = { mythic: 'mythical', legend: 'legendary', normal: 'common' };
    const normalize = q => {
        if (typeof q !== 'string') return null;
        const k = q.toLowerCase().trim();
        const mapped = ALIASES[k] || k;
        return RARITY_KEYS.includes(mapped) ? mapped : null;
    };

    /* ---------------------------------------------------------------
     * Estado persistido
     * ------------------------------------------------------------- */
    const STORE_PREFIX = 'pokepixel_rarity_tracker_v2:';
    const POS_KEY = 'pokepixel_rarity_tracker_fab';   // posição do botão é global
    const emptyTally = () => RARITY_KEYS.reduce((acc, k) => (acc[k] = 0, acc), {});

    const defaultState = () => ({
        attempts: emptyTally(),     // capture.failed + capture.success
        captures: emptyTally(),     // capture.success
        balls: {},                  // { "Ultra Bola": { attempts, captures } }
        shinyEncounters: 0,
        shinyCaptures: 0,
        accountName: null,
        startedAt: new Date().toISOString(),
    });

    // O jogo permite duas contas abertas em abas diferentes. Sem separar o
    // armazenamento, uma aba sobrescreve a contagem da outra — por isso a
    // chave carrega o id do treinador, tirado do JWT do WebSocket.
    let accountId = null;
    let state = null;

    function loadState(id) {
        try {
            const raw = GM_getValue(STORE_PREFIX + id, null);
            if (raw) {
                const st = Object.assign(defaultState(), JSON.parse(raw));
                st.balls = migrateBalls(st.balls);
                return st;
            }
        } catch (e) { /* dado corrompido: começa limpo */ }
        return defaultState();
    }

    // Versões anteriores indexavam por capsule_name; reagrupa pela chave
    // canônica para não duplicar a mesma bola sob dois rótulos.
    function migrateBalls(balls) {
        const out = {};
        for (const [k, v] of Object.entries(balls || {})) {
            const key = ballKey(k, k);
            const alvo = out[key] || (out[key] = { attempts: 0, captures: 0 });
            alvo.attempts += v.attempts || 0;
            alvo.captures += v.captures || 0;
        }
        return out;
    }

    function useAccount(id, name) {
        if (!id || accountId === id) {
            if (state && name && state.accountName !== name) {
                state.accountName = name;
                save();
            }
            return;
        }
        accountId = id;
        state = loadState(id);
        if (name) state.accountName = name;
        lastSeq = 0;
        seenCombat.clear();
        render();
    }

    let fabPos = null;
    try {
        const raw = GM_getValue(POS_KEY, null);
        if (raw) fabPos = JSON.parse(raw);
    } catch (e) { /* ignora */ }

    const diag = { connected: false, gaps: 0, lastError: null, unknownQuality: new Set() };

    let saveTimer = null;
    const save = () => {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            if (!accountId || !state) return;
            try {
                GM_setValue(STORE_PREFIX + accountId, JSON.stringify(state));
            } catch (e) {
                console.warn('[Raridades] não consegui salvar:', e);
            }
        }, 800);
    };

    const savePos = () => {
        try { GM_setValue(POS_KEY, JSON.stringify(fabPos)); } catch (e) { /* ignora */ }
    };

    /* ---------------------------------------------------------------
     * Eventos de combate
     *
     * Cada Pokémon é um evento discreto e numerado (seq), então não há
     * dedução nem atribuição por proximidade: a raridade vem dentro do
     * próprio evento. O seq também permite detectar evento perdido em vez
     * de contabilizar errado em silêncio.
     * ------------------------------------------------------------- */
    let lastSeq = 0;

    // combat.started pode repetir para o mesmo inimigo se o combate
    // reiniciar; a chave de spawn (id + created_at) evita contar duas vezes.
    const seenCombat = new Set();
    const COMBAT_CAP = 3000;

    // id da espécie -> { nome, sprite normal, sprite shiny }. Vem do endpoint
    // `species`, que traz a URL exata de cada sprite.
    const speciesIndex = new Map();

    // A hunt é o mapa onde se está caçando: cada mapa tem uma espécie só,
    // então isso muda quando se troca de mapa, não a cada combate.
    let hunt = null;
    let huntKey = null;
    let showShiny = false;

    function indexSpecies(list) {
        for (const sp of list) {
            if (!sp || !sp.id) continue;
            speciesIndex.set(sp.id, {
                name: sp.name || null,
                sprite: sp.normal_sprite_url || null,
                shiny: sp.shiny_sprite_url || null,
            });
        }
    }

    // Sem o índice, o id vira rótulo legível e a URL segue o padrão observado.
    const prettify = id => String(id).split(/[-_]/)
        .map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

    function markQuality(q) {
        const r = normalize(q);
        if (!r && typeof q === 'string') diag.unknownQuality.add(q);
        return r;
    }

    function onCombatStarted(data) {
        const enemy = data && data.enemy;
        if (!enemy || !state) return;

        // Só interessa marcar shiny visto; o que alimenta a taxa é a bola.
        const key = `${enemy.id}|${enemy.created_at}`;
        if (seenCombat.has(key)) return;
        seenCombat.add(key);
        if (seenCombat.size > COMBAT_CAP) {
            seenCombat.delete(seenCombat.keys().next().value);
        }

        // Só refaz o cartão quando a hunt muda de fato; sem isso o sprite
        // seria reatribuído a cada combate e a imagem recarregaria à toa.
        const chave = `${enemy.map_id != null ? enemy.map_id : ''}|${enemy.species_id || ''}`;
        if (chave !== huntKey) {
            huntKey = chave;
            showShiny = false;

            const sp = enemy.species_id ? speciesIndex.get(enemy.species_id) : null;
            const base = enemy.species_id ? `/assets/imported/creatures/${enemy.species_id}` : null;
            hunt = {
                name: (sp && sp.name) || (enemy.species_id ? prettify(enemy.species_id) : '?'),
                sprite: (sp && sp.sprite) || (base && `${base}/front.png`),
                shinySprite: (sp && sp.shiny) || (base && `${base}/shiny.png`),
            };
            render();
        }

        if (enemy.is_shiny) {
            state.shinyEncounters++;
            return true;
        }
    }

    function onCaptureAttempt(data, succeeded) {
        // A qualidade fica em lugares diferentes: solta no evento de falha,
        // dentro de `creature` no de sucesso.
        const src = succeeded ? (data && data.creature) : data;
        if (!src || !state) return;

        const rarity = markQuality(src.quality);
        if (!rarity) return;

        state.attempts[rarity]++;

        const key = ballKey(data.capsule_item_id, data.capsule_name);
        const ball = state.balls[key] || (state.balls[key] = { attempts: 0, captures: 0 });
        ball.attempts++;
        if (succeeded) ball.captures++;

        if (succeeded) {
            state.captures[rarity]++;
            if (src.is_shiny) state.shinyCaptures++;
            if (src.captured_by_name && state.accountName !== src.captured_by_name) {
                state.accountName = src.captured_by_name;
            }
        }
        return true;
    }

    function handleEvent(msg) {
        const { type, seq, data } = msg;

        // Só os eventos numerados entram no controle de sequência;
        // pong/ping ficam de fora (seq 0).
        if (typeof seq === 'number' && seq > 0) {
            if (seq <= lastSeq) {
                // Salto grande para trás = reconexão; caso contrário é repetido.
                if (lastSeq - seq > 500) lastSeq = seq - 1;
                else return;
            }
            if (lastSeq > 0 && seq > lastSeq + 1) diag.gaps += seq - lastSeq - 1;
            lastSeq = seq;
        }

        let changed = false;
        if (type === 'combat.started') changed = onCombatStarted(data);
        else if (type === 'capture.success') changed = onCaptureAttempt(data, true);
        else if (type === 'capture.failed') changed = onCaptureAttempt(data, false);
        else return;

        if (changed) save();
        render();
    }

    /* ---------------------------------------------------------------
     * Interceptação do WebSocket
     * ------------------------------------------------------------- */
    // O token do WebSocket é um JWT; o payload traz o id do treinador, que
    // é estável mesmo quando o token é renovado.
    function decodeJwtPayload(token) {
        try {
            const part = String(token).split('.')[1];
            if (!part) return null;
            const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
            const padded = b64 + '==='.slice((b64.length + 3) % 4);
            const bytes = atob(padded);
            const json = decodeURIComponent(
                bytes.split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join('')
            );
            return JSON.parse(json);
        } catch (e) {
            return null;
        }
    }

    function identifyAccount(wsUrl) {
        let token = null;
        try {
            token = new URL(wsUrl, location.href).searchParams.get('token');
        } catch (e) {
            const m = String(wsUrl).match(/[?&]token=([^&]+)/);
            if (m) token = decodeURIComponent(m[1]);
        }
        if (!token) return;

        const p = decodeJwtPayload(token);
        const id = p && (p.trainer_id || p.sub || p.user_id || p.uid || p.id);
        const name = p && (p.name || p.trainer_name || p.username);

        // Sem um id utilizável, o token inteiro ainda separa as abas nesta
        // sessão — melhor isso do que duas contas somando na mesma conta.
        useAccount(id || ('token:' + token.slice(-24)), name || null);
    }

    // O catálogo de espécies vem por HTTP, não pelo WebSocket: é a única
    // chamada que ainda interessa interceptar.
    const origFetch = W.fetch;
    if (typeof origFetch === 'function') {
        W.fetch = function (...args) {
            const p = origFetch.apply(this, args);
            try {
                const first = args[0];
                const url = (typeof first === 'string' ? first : (first && first.url)) || '';
                if (/\/species(\?|$)/.test(url)) {
                    p.then(res => res.clone().json())
                     .then(b => { const d = b && b.data; if (Array.isArray(d)) { indexSpecies(d); render(); } })
                     .catch(() => {});
                }
            } catch (e) { /* nunca atrapalha o jogo */ }
            return p;
        };
    }

    const OrigWS = W.WebSocket;
    if (typeof OrigWS === 'function') {
        class TrackedWebSocket extends OrigWS {
            constructor(...args) {
                super(...args);
                diag.connected = true;
                try { identifyAccount(args[0]); } catch (e) { /* segue sem rótulo */ }
                this.addEventListener('message', ev => {
                    if (typeof ev.data !== 'string') return;

                    let msg;
                    try {
                        msg = JSON.parse(ev.data);
                    } catch (e) {
                        return;   // mensagem não-JSON: esperado, segue o jogo
                    }

                    // Falha aqui é bug nosso, não ruído do protocolo: registra
                    // em vez de sumir com o erro.
                    try {
                        handleEvent(msg);
                    } catch (e) {
                        diag.lastError = String(e && e.message || e);
                        console.error('[Raridades] erro ao processar evento:', e, msg);
                        render();
                    }
                });
                this.addEventListener('open', () => { diag.connected = true; render(); });
            }
        }
        try {
            W.WebSocket = TrackedWebSocket;
        } catch (e) {
            console.warn('[Raridades] não consegui interceptar o WebSocket:', e);
        }
    }

    /* ---------------------------------------------------------------
     * Interface
     * ------------------------------------------------------------- */
    const CSS = `
    #pp-rt-fab {
        position: fixed; right: 18px; bottom: 18px; z-index: 2147483000;
        display: flex; align-items: center; gap: 8px;
        padding: 10px 14px; border-radius: 10px; cursor: grab;
        background: #16161a; border: 1px solid #33333c;
        color: #d9b665; font: 600 12px/1 ui-sans-serif, system-ui, sans-serif;
        letter-spacing: .08em; text-transform: uppercase;
        box-shadow: 0 6px 20px rgba(0,0,0,.55);
        touch-action: none; user-select: none;
        transition: border-color .15s;
    }
    #pp-rt-fab:hover { border-color: #d9b665; }
    #pp-rt-fab:active { cursor: grabbing; }
    #pp-rt-fab:focus-visible { outline: 2px solid #d9b665; outline-offset: 2px; }
    #pp-rt-fab.pp-dragging { border-color: #d9b665; opacity: .9; }
    #pp-rt-grip { color: #55555f; font-size: 13px; letter-spacing: -1px; }

    #pp-rt-overlay {
        position: fixed; inset: 0; z-index: 2147483001;
        background: rgba(0,0,0,.72); backdrop-filter: blur(2px);
        display: none; align-items: center; justify-content: center; padding: 14px;
        overflow: hidden;
    }
    #pp-rt-overlay.pp-open { display: flex; }

    #pp-rt-panel {
        width: min(940px, 100%); overflow: hidden;
        transform-origin: center center;
        background: #0e0e10; border: 1px solid #2a2a31; border-radius: 14px;
        color: #e6e6ea; font-family: ui-sans-serif, system-ui, sans-serif;
        box-shadow: 0 24px 60px rgba(0,0,0,.7);
    }
    #pp-rt-head {
        display: flex; align-items: center; justify-content: space-between;
        padding: 13px 20px; border-bottom: 1px solid #22222a;
    }
    #pp-rt-title {
        margin: 0; color: #d9b665; font-size: 15px; font-weight: 500;
        letter-spacing: .18em; text-transform: uppercase;
        font-family: ui-serif, Georgia, 'Times New Roman', serif;
    }
    #pp-rt-account {
        margin: 4px 0 0; color: #7a7a86; font-size: 10.5px;
        letter-spacing: .08em; text-transform: uppercase;
    }
    #pp-rt-close {
        background: none; border: 0; color: #8b8b95; cursor: pointer;
        font-size: 22px; line-height: 1; padding: 4px 8px; border-radius: 6px;
    }
    #pp-rt-close:hover { color: #e6e6ea; background: #1c1c22; }


    .pp-rt-totals {
        display: grid; grid-template-columns: repeat(3, 1fr);
        gap: 9px; padding: 11px 20px 0;
    }
    .pp-rt-total {
        background: #16161a; border: 1px solid #26262e; border-radius: 10px;
        padding: 11px 14px; text-align: center;
    }
    .pp-rt-total b { display: block; font-size: 21px; font-weight: 600; }
    .pp-rt-total span {
        display: block; margin-top: 3px; color: #8b8b95;
        font-size: 10.5px; letter-spacing: .1em; text-transform: uppercase;
    }

    /* Linha invisível que apenas ocupa altura, para as duas abas ficarem
       do mesmo tamanho e o painel não redimensionar ao alternar. */
    .pp-rt-spacer { visibility: hidden; }

    #pp-rt-hunt {
        display: none; align-items: center; gap: 14px;
        margin: 11px 20px 0; padding: 9px 13px;
        background: #16161a; border: 1px solid #26262e; border-radius: 10px;
    }
    #pp-rt-hunt.pp-on { display: flex; }
    #pp-rt-hunt-btn {
        background: none; border: 0; padding: 0; flex: none;
        cursor: pointer; border-radius: 8px; line-height: 0;
    }
    #pp-rt-hunt-btn:focus-visible { outline: 2px solid #d9b665; outline-offset: 2px; }
    #pp-rt-hunt-img {
        width: 44px; height: 44px; object-fit: contain;
        image-rendering: pixelated;   /* sprites do jogo são pixel art */
    }
    #pp-rt-hunt-hint { color: #55555f; font-size: 11px; }
    #pp-rt-hunt-label {
        margin: 0 0 2px; color: #7a7a86; font-size: 10.5px;
        letter-spacing: .12em; text-transform: uppercase;
    }
    #pp-rt-hunt-name { margin: 0 0 4px; font-size: 15px; font-weight: 500; color: #e6e6ea; }
    #pp-rt-hunt-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .pp-rt-shiny { color: #4fc6ea; font-size: 12px; font-weight: 500; }

    .pp-rt-tabs {
        display: grid; grid-template-columns: 1fr 1fr;
        gap: 9px; padding: 9px 20px 3px;
    }
    .pp-rt-tab {
        background: #16161a; border: 1px solid #26262e; border-radius: 10px;
        color: #8b8b95; padding: 9px 13px; cursor: pointer;
        font: 600 12px/1 ui-sans-serif, system-ui, sans-serif;
        letter-spacing: .06em; transition: color .15s, border-color .15s;
    }
    .pp-rt-tab:hover { color: #c9ced4; }
    .pp-rt-tab.pp-active {
        background: #221d12; border-color: #4a3d22; color: #d9b665;
    }
    .pp-rt-tab:focus-visible { outline: 2px solid #d9b665; outline-offset: 2px; }

    #pp-rt-table { padding: 6px 20px 2px; }
    .pp-rt-hrow, .pp-rt-row {
        display: grid; grid-template-columns: 1.4fr .8fr .8fr 1.7fr;
        gap: 12px; align-items: center;
    }
    .pp-rt-hrow {
        padding: 7px 14px; color: #7a7a86;
        font-size: 10px; letter-spacing: .1em; text-transform: uppercase;
    }
    .pp-rt-row {
        background: #16161a; border: 1px solid #26262e; border-radius: 10px;
        padding: 9px 14px; margin-bottom: 5px;
    }
    .pp-rt-row--all {
        background: #1b1b21; border-color: #3a3a44;
        margin-bottom: 11px; position: relative;
    }
    .pp-rt-row--all::after {
        content: ''; position: absolute; left: 14px; right: 14px; bottom: -6px;
        height: 1px; background: #26262e;
    }
    .pp-rt-ball {
        width: 14px; height: 14px; border-radius: 50%; flex: none;
        margin-right: 7px; position: relative;
        border: 1px solid rgba(0,0,0,.6);
        box-shadow: inset 0 0 0 .5px rgba(255,255,255,.14);
    }
    .pp-rt-ball::after {
        content: ''; position: absolute; left: 50%; top: 50%;
        width: 4.5px; height: 4.5px; margin: -2.25px 0 0 -2.25px;
        border-radius: 50%; background: #f5f6f8;
        border: 1px solid var(--pp-band, #141418);
    }
    .pp-rt-badge {
        display: inline-flex; align-items: center; justify-self: start;
        padding: 4px 11px; border-radius: 999px;
        background: #101014; border: 1px solid currentColor;
        font-size: 12px; font-weight: 700; letter-spacing: .02em;
    }
    .pp-rt-num { font-variant-numeric: tabular-nums; font-size: 14px; }
    .pp-rt-rate { display: flex; align-items: center; gap: 10px; }
    .pp-rt-bar { flex: 1; height: 5px; border-radius: 3px; background: #26262e; overflow: hidden; }
    .pp-rt-fill { height: 100%; border-radius: 3px; transition: width .3s ease; }
    .pp-rt-pct { font-variant-numeric: tabular-nums; font-size: 13px; min-width: 52px; text-align: right; }
    .pp-rt-muted { color: #55555f; }

    #pp-rt-foot {
        display: flex; align-items: center; justify-content: space-between;
        gap: 12px; padding: 11px 20px 14px; border-top: 1px solid #22222a; margin-top: 6px;
    }
    #pp-rt-note { color: #7a7a86; font-size: 12px; line-height: 1.5; margin: 0; }
    #pp-rt-diag { color: #55555f; font-size: 11px; margin: 5px 0 0; font-variant-numeric: tabular-nums; }
    #pp-rt-diag.pp-warn { color: #f0a5a5; }
    #pp-rt-reset {
        background: #16161a; border: 1px solid #33333c; color: #b9b9c2;
        padding: 8px 13px; border-radius: 8px; cursor: pointer; flex: none;
        font-size: 12px; letter-spacing: .06em; text-transform: uppercase;
    }
    #pp-rt-reset:hover { border-color: #6b4a4a; color: #f0a5a5; }

    @media (max-width: 640px) {
        .pp-rt-totals { grid-template-columns: 1fr; }
        .pp-rt-hrow, .pp-rt-row { grid-template-columns: 1.2fr .6fr .6fr 1.2fr; gap: 8px; }
        #pp-rt-foot { flex-direction: column; align-items: stretch; }
    }
    @media (prefers-reduced-motion: reduce) {
        #pp-rt-fab, .pp-rt-fill { transition: none; }
    }
    `;

    let els = null;
    let view = 'rarity';   // 'rarity' | 'ball'

    function buildUI() {
        const style = document.createElement('style');
        style.textContent = CSS;
        document.head.appendChild(style);

        const fab = document.createElement('button');
        fab.id = 'pp-rt-fab';
        fab.type = 'button';
        fab.title = 'Arraste para mover • clique para abrir';
        fab.__ppSetTitle = name => {
            fab.title = (name ? `${name} — ` : '') + 'Arraste para mover • clique para abrir';
        };
        fab.innerHTML = '<span id="pp-rt-grip" aria-hidden="true">⠿</span>Raridades';

        const overlay = document.createElement('div');
        overlay.id = 'pp-rt-overlay';
        overlay.innerHTML = `
            <div id="pp-rt-panel" role="dialog" aria-modal="true" aria-labelledby="pp-rt-title">
                <div id="pp-rt-head">
                    <div>
                        <h2 id="pp-rt-title">Capturas por raridade</h2>
                        <p id="pp-rt-account"></p>
                    </div>
                    <button id="pp-rt-close" type="button" aria-label="Fechar">&times;</button>
                </div>
                <div id="pp-rt-hunt">
                    <button id="pp-rt-hunt-btn" type="button" title="Clique para alternar entre normal e shiny">
                        <img id="pp-rt-hunt-img" alt="" />
                    </button>
                    <div>
                        <p id="pp-rt-hunt-label">Hunt atual</p>
                        <p id="pp-rt-hunt-name"></p>
                        <div id="pp-rt-hunt-meta">
                            <span id="pp-rt-hunt-hint">clique no sprite para ver o shiny</span>
                        </div>
                    </div>
                </div>
                <div class="pp-rt-totals">
                    <div class="pp-rt-total"><b id="pp-rt-t-att" style="color:#d9b665">0</b><span>Tentativas</span></div>
                    <div class="pp-rt-total"><b id="pp-rt-t-cap" style="color:#54d97c">0</b><span>Capturas</span></div>
                    <div class="pp-rt-total"><b id="pp-rt-t-shi" style="color:#4fc6ea">0</b><span>Shinies</span></div>
                </div>
                <div class="pp-rt-tabs">
                    <button class="pp-rt-tab pp-active" type="button" data-view="rarity">Por raridade</button>
                    <button class="pp-rt-tab" type="button" data-view="ball">Por pokébola</button>
                </div>
                <div id="pp-rt-table">
                    <div class="pp-rt-hrow">
                        <div id="pp-rt-h1">Raridade</div><div>Tentativas</div><div>Capturas</div><div>Taxa de captura</div>
                    </div>
                    <div id="pp-rt-rows"></div>
                </div>
                <div id="pp-rt-foot">
                    <div>
                        <p id="pp-rt-note"></p>
                        <p id="pp-rt-diag"></p>
                    </div>
                    <button id="pp-rt-reset" type="button">Zerar contagem</button>
                </div>
            </div>`;

        document.body.appendChild(fab);
        document.body.appendChild(overlay);

        els = {
            overlay, fab,
            rows: overlay.querySelector('#pp-rt-rows'),
            note: overlay.querySelector('#pp-rt-note'),
            hunt: overlay.querySelector('#pp-rt-hunt'),
            huntImg: overlay.querySelector('#pp-rt-hunt-img'),
            huntName: overlay.querySelector('#pp-rt-hunt-name'),
            huntHint: overlay.querySelector('#pp-rt-hunt-hint'),
            huntBtn: overlay.querySelector('#pp-rt-hunt-btn'),
            panel: overlay.querySelector('#pp-rt-panel'),
            tAtt: overlay.querySelector('#pp-rt-t-att'),
            tCap: overlay.querySelector('#pp-rt-t-cap'),
            tShi: overlay.querySelector('#pp-rt-t-shi'),
            title: overlay.querySelector('#pp-rt-title'),
            head1: overlay.querySelector('#pp-rt-h1'),
            tabs: [...overlay.querySelectorAll('.pp-rt-tab')],
            account: overlay.querySelector('#pp-rt-account'),
            diag: overlay.querySelector('#pp-rt-diag'),
        };

        els.tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                view = tab.dataset.view;
                els.tabs.forEach(t => t.classList.toggle('pp-active', t === tab));
                render();
            });
        });

        setupDrag(fab);
        if (fabPos) placeFab(fabPos.left, fabPos.top);

        const open = () => { overlay.classList.add('pp-open'); render(); fitPanel(); };
        const close = () => overlay.classList.remove('pp-open');

        overlay.querySelector('#pp-rt-close').addEventListener('click', close);
        overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape' && overlay.classList.contains('pp-open')) close();
        });

        fab.addEventListener('click', e => {
            if (fab.__ppMoved) { e.preventDefault(); e.stopPropagation(); return; }
            open();
        });

        els.huntBtn.addEventListener('click', () => {
            if (!hunt || !hunt.shinySprite) return;
            showShiny = !showShiny;
            renderHunt();
        });

        overlay.querySelector('#pp-rt-reset').addEventListener('click', () => {
            if (!state) return;
            const quem = state.accountName ? `da conta ${state.accountName}` : 'desta conta';
            if (!confirm(`Zerar os contadores ${quem}? A outra aba não é afetada, e seu progresso no jogo também não.`)) return;
            const name = state.accountName;
            state = defaultState();
            state.accountName = name;
            seenCombat.clear();
            diag.gaps = 0;
            save();
            render();
        });

        window.addEventListener('resize', () => {
            if (fabPos) placeFab(fabPos.left, fabPos.top);
            fitPanel();
        });

        render();
    }

    /* ---- Arrastar o botão ---- */
    function placeFab(left, top) {
        const fab = els.fab;
        const w = fab.offsetWidth || 120;
        const h = fab.offsetHeight || 38;
        const x = Math.max(4, Math.min(left, window.innerWidth - w - 4));
        const y = Math.max(4, Math.min(top, window.innerHeight - h - 4));
        fab.style.left = x + 'px';
        fab.style.top = y + 'px';
        fab.style.right = 'auto';
        fab.style.bottom = 'auto';
    }

    function setupDrag(fab) {
        let startX = 0, startY = 0, origX = 0, origY = 0, dragging = false;

        fab.addEventListener('pointerdown', e => {
            if (e.button !== 0 && e.pointerType === 'mouse') return;
            dragging = true;
            fab.__ppMoved = false;
            startX = e.clientX;
            startY = e.clientY;
            const r = fab.getBoundingClientRect();
            origX = r.left;
            origY = r.top;
            fab.setPointerCapture(e.pointerId);
        });

        fab.addEventListener('pointermove', e => {
            if (!dragging) return;
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;
            if (!fab.__ppMoved && Math.hypot(dx, dy) < 4) return;
            fab.__ppMoved = true;
            fab.classList.add('pp-dragging');
            placeFab(origX + dx, origY + dy);
        });

        const finish = e => {
            if (!dragging) return;
            dragging = false;
            fab.classList.remove('pp-dragging');
            try { fab.releasePointerCapture(e.pointerId); } catch (err) {}
            if (fab.__ppMoved) {
                const r = fab.getBoundingClientRect();
                fabPos = { left: r.left, top: r.top };
                savePos();
                setTimeout(() => { fab.__ppMoved = false; }, 0);
            }
        };
        fab.addEventListener('pointerup', finish);
        fab.addEventListener('pointercancel', finish);
    }

    // Em vez de torcer para a soma dos espaçamentos caber, o painel se mede
    // e encolhe proporcionalmente quando a janela é menor que ele. Assim a
    // interface é sempre a mesma, só reduzida — e nunca precisa rolar.
    let fitPending = false;
    function fitPanel() {
        if (!els || !els.panel || !els.overlay.classList.contains('pp-open')) return;
        if (fitPending) return;
        fitPending = true;

        requestAnimationFrame(() => {
            fitPending = false;
            const panel = els.panel;
            panel.style.transform = 'none';

            const margem = 28;
            const alturaNatural = panel.offsetHeight;
            const larguraNatural = panel.offsetWidth;
            if (!alturaNatural || !larguraNatural) return;

            const k = Math.min(
                1,
                (window.innerHeight - margem) / alturaNatural,
                (window.innerWidth - margem) / larguraNatural
            );
            panel.style.transform = k < 1 ? `scale(${k})` : 'none';
        });
    }

    /* ---- Render ---- */
    const fmt = n => n.toLocaleString('pt-BR');

    function renderHunt() {
        if (!els || !els.hunt) return;
        if (!hunt) { els.hunt.classList.remove('pp-on'); return; }

        els.hunt.classList.add('pp-on');
        els.huntName.textContent = hunt.name;

        const alvo = showShiny ? hunt.shinySprite : hunt.sprite;
        if (alvo) {
            // Reatribuir src recarregaria a imagem; só troca quando muda.
            if (els.huntImg.getAttribute('src') !== alvo) els.huntImg.setAttribute('src', alvo);
            els.huntImg.alt = hunt.name + (showShiny ? ' shiny' : '');
            els.huntBtn.style.display = '';
        } else {
            els.huntBtn.style.display = 'none';
        }

        els.huntHint.textContent = showShiny ? 'mostrando shiny' : 'clique no sprite para ver o shiny';
        els.huntHint.style.color = showShiny ? '#4fc6ea' : '#55555f';
    }

    function render() {
        if (!els) return;

        if (!state) {
            els.account.textContent = 'identificando a conta…';
            els.diag.textContent = diag.connected
                ? 'Aguardando o token da conta'
                : 'WebSocket não detectado — recarregue a página';
            els.diag.classList.toggle('pp-warn', !diag.connected);
            return;
        }

        renderHunt();

        els.account.textContent = state.accountName
            ? `Conta: ${state.accountName}`
            : `Conta ${String(accountId).slice(0, 8)}`;

        const totalAtt = RARITY_KEYS.reduce((s, k) => s + state.attempts[k], 0);
        const totalCap = RARITY_KEYS.reduce((s, k) => s + state.captures[k], 0);

        els.tAtt.textContent = fmt(totalAtt);
        els.tCap.textContent = fmt(totalCap);
        els.tShi.textContent = `${fmt(state.shinyCaptures)} / ${fmt(state.shinyEncounters)}`;

        const row = (label, color, att, cap, opts) => {
            const o = opts || {};
            const pct = att > 0 ? (cap / att) * 100 : null;
            const width = pct === null ? 0 : Math.min(pct, 100);
            // Bola do catálogo que nunca foi usada aparece com traços, não com zeros.
            const vazio = o.dashWhenEmpty && att === 0;
            return `
            <div class="pp-rt-row${o.extraClass || ''}">
                <span class="pp-rt-badge" style="color:${color};
                      box-shadow: 0 0 9px ${color}59, inset 0 0 9px ${color}1f;
                      text-shadow: 0 0 7px ${color}8c;">${o.icon || ''}${label}</span>
                <div class="pp-rt-num ${att ? '' : 'pp-rt-muted'}">${vazio ? '—' : fmt(att)}</div>
                <div class="pp-rt-num ${cap ? '' : 'pp-rt-muted'}" style="${cap ? 'color:#54d97c' : ''}">${vazio ? '—' : fmt(cap)}</div>
                <div class="pp-rt-rate">
                    <div class="pp-rt-bar"><div class="pp-rt-fill" style="width:${width}%;background:${color}"></div></div>
                    <span class="pp-rt-pct ${pct === null ? 'pp-rt-muted' : ''}">
                        ${pct === null ? '—' : pct.toFixed(1) + '%'}
                    </span>
                </div>
            </div>`;
        };

        // As duas abas têm quantidades diferentes de linhas (7 raridades
        // contra 5 pokébolas). A menor é preenchida com linhas invisíveis
        // para que trocar de aba não mude a altura do painel.
        const extras = Object.keys(state.balls)
            .filter(k => !BALL_BY_KEY[k] && state.balls[k].attempts > 0);
        const maxLinhas = Math.max(RARITIES.length, BALLS.length + extras.length);
        const preencher = n => n > 0
            ? row('—', '#000000', 0, 0, { extraClass: ' pp-rt-spacer' }).repeat(n)
            : '';

        // O título acompanha a aba ativa.
        els.title.textContent = view === 'ball'
            ? 'Capturas por pokébola'
            : 'Capturas por raridade';

        if (view === 'ball') {
            els.head1.textContent = 'Pokébola';

            const vazia = { attempts: 0, captures: 0 };
            const chaves = Object.keys(state.balls);

            const tAtt = chaves.reduce((a, k) => a + state.balls[k].attempts, 0);
            const tCap = chaves.reduce((a, k) => a + state.balls[k].captures, 0);

            // O catálogo vem sempre inteiro e na ordem de eficiência.
            const icone = b => `<span class="pp-rt-ball" style="--pp-band:${b.band};`
                + `background:linear-gradient(to bottom,${b.top} 0 44%,${b.band} 44% 56%,${b.bottom} 56% 100%)"></span>`;

            const linhas = BALLS.map(b => {
                const d = state.balls[b.key] || vazia;
                return row(b.label, b.color, d.attempts, d.captures,
                    { dashWhenEmpty: true, icon: icone(b) });
            });

            // Qualquer bola fora do catálogo (ex.: recompensa de evento) entra
            // depois, e só se tiver sido usada.
            extras.slice()
                .sort((a, b) => state.balls[b].attempts - state.balls[a].attempts)
                .forEach(k => linhas.push(
                    row(k, OTHER_BALL_COLOR, state.balls[k].attempts, state.balls[k].captures)));

            els.rows.innerHTML =
                row('Todas', ALL_ROW.color, tAtt, tCap, { extraClass: ' pp-rt-row--all' })
                + linhas.join('')
                + preencher(maxLinhas - linhas.length);
        } else {
            els.head1.textContent = 'Raridade';

            const sum = key => RARITY_KEYS.reduce((acc, k) => acc + state[key][k], 0);
            const allAtt = sum('attempts');
            const allCap = sum('captures');

            els.rows.innerHTML =
                row(ALL_ROW.label, ALL_ROW.color, allAtt, allCap, { extraClass: ' pp-rt-row--all' })
                + RARITIES.map(r =>
                    row(r.label, r.color, state.attempts[r.key], state.captures[r.key])
                ).join('')
                + preencher(maxLinhas - RARITIES.length);
        }

        const since = new Date(state.startedAt).toLocaleString('pt-BR');
        if (els.fab.__ppSetTitle) els.fab.__ppSetTitle(state.accountName);

        els.note.textContent = totalAtt === 0
            ? 'Nenhuma pokébola registrada ainda. A conta começa quando a primeira for jogada.'
            : `Contando desde ${since}.`;

        const parts = [];
        if (!diag.connected) parts.push('WebSocket não detectado — recarregue a página');
        if (diag.gaps) parts.push(`${fmt(diag.gaps)} eventos perdidos na conexão`);
        if (diag.lastError) parts.push(`erro interno: ${diag.lastError}`);

        if (diag.unknownQuality.size) parts.push(`qualidade desconhecida: ${[...diag.unknownQuality].join(', ')}`);

        els.diag.textContent = parts.join(' | ');
        els.diag.classList.toggle('pp-warn', !diag.connected || diag.gaps > 0 || !!diag.lastError);

        fitPanel();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', buildUI);
    } else {
        buildUI();
    }
})();
