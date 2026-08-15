// ==UserScript==
// @name         Pokepixel — Raridades
// @namespace    https://pokepixel.nietore.com/
// @version      2.32.0
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

    // Chaves que alterariam o protótipo do objeto se usadas como índice.
    const BLOCKED_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

    const safeLabel = value => {
        const label = String(value || '').trim().slice(0, 60);
        return label && !BLOCKED_KEYS.has(label) ? label : 'Desconhecida';
    };

    function ballKey(itemId, name) {
        const alvo = `${itemId || ''} ${name || ''}`;
        const achou = BALLS.find(b => b.match.test(alvo));
        return achou ? achou.key : safeLabel(name || itemId);
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
    const LOG_CAP = 100;        // limite do registro; o armazenamento não é infinito
    const IV_MAX = 186;         // 31 por atributo, seis atributos
    const IV_STAT_MAX = 31;
    // Ordem e rótulos iguais aos do painel de genética do jogo
    const BAT_STATS = ['HP máximo', 'Ataque', 'Defesa',
                       'Atq. Especial', 'Def. Especial', 'Velocidade'];
    const IV_STATS = [
        ['hp',  'IV HP'],
        ['atk', 'IV Ataque'],
        ['def', 'IV Defesa'],
        ['spa', 'IV Ataque Especial'],
        ['spd', 'IV Defesa Especial'],
        ['spe', 'IV Velocidade'],
    ];
    const LOG_PAGE = 6;         // linhas por página, para o painel não crescer
    const HUNTS_CAP = 40;       // hunts guardadas; as mais antigas saem

    const STORE_PREFIX = 'pokepixel_rarity_tracker_v2:';
    const POS_KEY = 'pokepixel_rarity_tracker_fab';   // posição do botão é global
    const emptyTally = () => RARITY_KEYS.reduce((acc, k) => (acc[k] = 0, acc), {});

    const defaultState = () => ({
        attempts: emptyTally(),     // capture.failed + capture.success
        captures: emptyTally(),     // capture.success
        balls: Object.create(null), // { "Ultra Bola": { attempts, captures } }
        log: [],                    // últimas capturas, da mais recente para a mais antiga
        hunts: Object.create(null), // chave da hunt -> contadores próprios
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

    const safeCount = v => Number.isSafeInteger(v) && v >= 0 ? v : 0;

    // O que vem do armazenamento é tratado como não confiável: números viram
    // inteiros válidos e textos ganham limite de tamanho.
    function sanitizeState(value) {
        const limpo = defaultState();
        if (!value || typeof value !== 'object' || Array.isArray(value)) return limpo;

        for (const k of RARITY_KEYS) {
            limpo.attempts[k] = safeCount(value.attempts && value.attempts[k]);
            // Toda captura também incrementa a tentativa, então capturas nunca
            // podem passar de tentativas.
            limpo.captures[k] = Math.min(safeCount(value.captures && value.captures[k]),
                                         limpo.attempts[k]);
        }

        // Shiny visto e shiny capturado vêm de eventos diferentes e são
        // independentes: capturar um shiny cuja luta começou antes do script
        // subir é legítimo, então aqui não cabe limitar um pelo outro.
        limpo.shinyEncounters = safeCount(value.shinyEncounters);
        limpo.shinyCaptures = safeCount(value.shinyCaptures);

        limpo.balls = migrateBalls(value.balls);

        limpo.hunts = Object.create(null);
        for (const [k, h] of Object.entries(value.hunts || {})) {
            if (BLOCKED_KEYS.has(k) || !h || typeof h !== 'object') continue;
            const lim = novaHunt(h.nome, h.sp, h.map);
            for (const rk of RARITY_KEYS) {
                lim.attempts[rk] = safeCount(h.attempts && h.attempts[rk]);
                lim.captures[rk] = Math.min(safeCount(h.captures && h.captures[rk]),
                                            lim.attempts[rk]);
            }
            lim.balls = migrateBalls(h.balls);
            lim.shinyEncounters = safeCount(h.shinyEncounters);
            lim.shinyCaptures = safeCount(h.shinyCaptures);
            lim.desde = typeof h.desde === 'string' && !Number.isNaN(Date.parse(h.desde))
                ? h.desde : lim.desde;
            lim.ultimo = safeCount(h.ultimo) || lim.ultimo;
            limpo.hunts[String(k).slice(0, 80)] = lim;
        }
        limpo.log = Array.isArray(value.log)
            ? value.log.filter(e => e && typeof e === 'object').slice(0, LOG_CAP).map(e => ({
                sp: typeof e.sp === 'string' ? e.sp.slice(0, 40) : '',
                nome: typeof e.nome === 'string' ? e.nome.slice(0, 40) : '?',
                q: RARITY_KEYS.includes(e.q) ? e.q : 'weak',
                lvl: safeCount(e.lvl),
                iv: Math.min(safeCount(e.iv), IV_MAX),
                det: Array.isArray(e.det) && e.det.length === IV_STATS.length
                    ? e.det.map(v => Math.min(safeCount(v), IV_STAT_MAX)) : null,
                mult: Number.isFinite(e.mult) && e.mult >= 0 ? e.mult : 0,
                bat: Array.isArray(e.bat) && e.bat.length === IV_STATS.length
                    ? e.bat.map(v => safeCount(v)) : null,
                poder: safeCount(e.poder),
                nat: typeof e.nat === 'string' ? e.nat.slice(0, 20) : '',
                gen: e.gen === 'male' || e.gen === 'female' ? e.gen : '',
                bola: typeof e.bola === 'string' ? e.bola.slice(0, 40) : '',
                sold: !!e.sold,
                shiny: !!e.shiny,
                h: typeof e.h === 'string' ? e.h.slice(0, 80) : '',
                at: typeof e.at === 'string' ? e.at.slice(0, 40) : '',
            }))
            : [];
        limpo.accountName = typeof value.accountName === 'string'
            ? value.accountName.slice(0, 60) : null;
        limpo.startedAt = typeof value.startedAt === 'string'
            && !Number.isNaN(Date.parse(value.startedAt))
            ? value.startedAt : limpo.startedAt;
        return limpo;
    }

    function loadState(id) {
        try {
            const raw = GM_getValue(STORE_PREFIX + id, null);
            if (raw) return sanitizeState(JSON.parse(raw));
        } catch (e) { /* dado corrompido: começa limpo */ }
        return defaultState();
    }

    // Versões anteriores indexavam por capsule_name; reagrupa pela chave
    // canônica para não duplicar a mesma bola sob dois rótulos.
    function migrateBalls(balls) {
        const out = Object.create(null);
        for (const [k, v] of Object.entries(balls || {})) {
            const key = ballKey(k, k);
            const alvo = out[key] || (out[key] = { attempts: 0, captures: 0 });
            const tentativas = safeCount(v && v.attempts);
            alvo.attempts += tentativas;
            alvo.captures += Math.min(safeCount(v && v.captures), tentativas);
        }
        return out;
    }

    function useAccount(id, name) {
        id = id == null ? null : String(id).slice(0, 120);
        name = typeof name === 'string' ? name.slice(0, 60) : null;
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

    // Uma hunt guarda os mesmos contadores do total, só que restritos ao mapa.
    const novaHunt = (nome, sp, map) => ({
        nome: typeof nome === 'string' ? nome.slice(0, 40) : '?',
        sp: typeof sp === 'string' ? sp.slice(0, 40) : '',
        map: map == null ? '' : String(map).slice(0, 20),
        attempts: emptyTally(),
        captures: emptyTally(),
        balls: Object.create(null),
        shinyEncounters: 0,
        shinyCaptures: 0,
        desde: new Date().toISOString(),
        ultimo: Date.now(),
    });

    // Hunt em que as bolas estão sendo gastas agora.
    let huntAtual = null;

    // Sair da caçada dispara um POST /stop — é o sinal direto e imediato.
    // A inatividade fica como reserva: recarregar a página já na cidade não
    // gera nenhum stop para observar.
    const HUNT_INATIVA_MS = 60000;
    let ultimoCombate = 0;
    let cacadaEncerrada = false;

    function encerrarHunt() {
        huntAtual = null;
        hunt = null;
        huntKey = null;
        ultimoCombate = 0;
        render();
    }

    function markQuality(q) {
        const r = normalize(q);
        if (!r && typeof q === 'string') diag.unknownQuality.add(q);
        return r;
    }

    function onCombatStarted(data) {
        const enemy = data && data.enemy;
        if (!enemy || !state) return;

        // Antes da deduplicação: um combat.started repetido no mesmo spawn não
        // conta de novo, mas ainda é sinal de que a caçada está viva.
        ultimoCombate = Date.now();
        cacadaEncerrada = false;

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
        huntAtual = chave;

        if (!BLOCKED_KEYS.has(chave)) {
            // Hunt já conhecida continua de onde parou; só a marca de uso muda.
            if (state.hunts[chave]) {
                state.hunts[chave].ultimo = Date.now();
            } else {
                const sp0 = enemy.species_id ? speciesIndex.get(enemy.species_id) : null;
                state.hunts[chave] = novaHunt(
                    (sp0 && sp0.name) || prettify(enemy.species_id || '?'),
                    enemy.species_id, enemy.map_id);

                // Passando do limite, sai a que está há mais tempo sem uso —
                // e não a mais antiga, que pode ser justamente a favorita.
                let chaves = Object.keys(state.hunts);
                while (chaves.length > HUNTS_CAP) {
                    const velha = chaves.reduce((a, b) =>
                        state.hunts[a].ultimo <= state.hunts[b].ultimo ? a : b);
                    delete state.hunts[velha];
                    chaves = Object.keys(state.hunts);
                }
            }
        }

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
            const h = state.hunts[chave];
            if (h) h.shinyEncounters++;
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

        const key = ballKey(data.capsule_item_id, data.capsule_name);
        const hunt = huntAtual && state.hunts[huntAtual];

        // O combat.started sempre precede as bolas daquele combate, então a
        // hunt corrente é a dona desta tentativa.
        for (const alvo of hunt ? [state, hunt] : [state]) {
            alvo.attempts[rarity]++;
            const b = alvo.balls[key] || (alvo.balls[key] = { attempts: 0, captures: 0 });
            b.attempts++;
            if (succeeded) { alvo.captures[rarity]++; b.captures++; }
        }

        if (succeeded) {
            if (hunt && src.is_shiny) hunt.shinyCaptures++;
            registrarCaptura(data, src, rarity, key);
            if (src.is_shiny) state.shinyCaptures++;
            if (typeof src.captured_by_name === 'string') {
                const nome = src.captured_by_name.slice(0, 60);
                if (state.accountName !== nome) state.accountName = nome;
            }
        }
        return true;
    }

    // Guarda o detalhe de cada captura. O evento já traz tudo: IVs, nature,
    // gênero, nível e se a venda automática levou o Pokémon.
    function registrarCaptura(data, creature, rarity, ballKeyName) {
        const ivs = creature.ivs && typeof creature.ivs === 'object' ? creature.ivs : {};
        // Guardados como lista na ordem de IV_STATS: ocupa menos que um objeto
        // e o registro precisa caber no armazenamento.
        const det = IV_STATS.map(([k]) => Math.min(Number(ivs[k]) || 0, IV_STAT_MAX));
        const ivTotal = det.reduce((soma, v) => soma + v, 0);

        state.log.unshift({
            sp: String(creature.species_id || '').slice(0, 40),
            nome: String(creature.species_name || creature.species_id || '?').slice(0, 40),
            q: rarity,
            lvl: Number(creature.level) || 0,
            iv: Math.min(ivTotal, IV_MAX),
            det,
            mult: Number(creature.quality_multiplier) || 0,
            // Atributos de batalha, na mesma ordem de IV_STATS
            bat: [creature.max_hp, creature.atk, creature.def,
                  creature.spa, creature.spd, creature.spe].map(v => Number(v) || 0),
            poder: Number(creature.power) || 0,
            nat: String(creature.nature || '').slice(0, 20),
            gen: creature.gender === 'male' || creature.gender === 'female' ? creature.gender : '',
            bola: ballKeyName,
            h: huntAtual || '',
            sold: !!data.auto_sold,
            shiny: !!creature.is_shiny,
            at: String(creature.captured_at || '').slice(0, 40),
        });

        if (state.log.length > LOG_CAP) state.log.length = LOG_CAP;
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

        // Sem um id utilizável, deriva um identificador opaco: separa as abas
        // do mesmo jeito, sem guardar nenhum pedaço reaproveitável do token.
        let hash = 2166136261;
        for (let i = 0; i < token.length; i++) {
            hash ^= token.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }
        useAccount(id || ('sessao:' + (hash >>> 0).toString(16).padStart(8, '0')), name || null);
    }

    // Anúncios do mercado: id do anúncio -> criatura. O card no DOM traz
    // data-listing-id, que casa com o id daqui — por isso a correspondência
    // é exata, sem depender de nome nem dos números na tela.
    const listings = new Map();
    const LISTINGS_CAP = 4000;

    function indexListings(list) {
        for (const l of list) {
            if (!l || !l.id || l.kind !== 'pokemon' || !l.creature) continue;
            listings.set(l.id, l.creature);
        }
        // O mercado é paginado; o índice acumula o que já passou, mas não
        // cresce sem limite.
        while (listings.size > LISTINGS_CAP) {
            listings.delete(listings.keys().next().value);
        }
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
                } else if (/\/stop(\?|$)/.test(url)) {
                    // "Voltar à cidade" encerra a caçada. É o sinal exato de
                    // que não há mais hunt ativa, sem depender de espera.
                    p.then(() => { encerrarHunt(); }).catch(() => {});
                } else if (/\/stop(\?|$)/.test(url)) {
                    // Encerrou a caçada: o cartão deixa de apontar um mapa.
                    p.then(() => {
                        cacadaEncerrada = true;
                        huntAtual = null;
                        renderHunt();
                    }).catch(() => {});
                } else if (/\/listings(\?|$)/.test(url)) {
                    p.then(res => res.clone().json())
                     .then(b => { const d = b && b.data; if (Array.isArray(d)) indexListings(d); })
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
                        console.error('[Raridades] erro ao processar evento:',
                            msg && msg.type, e);
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
        /* Altura presa no sprite: assim o bloco do perfil, que fica à direita,
           nunca faz o cartão crescer e empurrar o painel. */
        height: 62px; box-sizing: border-box; overflow: hidden;
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
    #pp-rt-perfil-box { margin-left: auto; text-align: right; flex: none; }
    #pp-rt-perfil-label {
        display: block; margin-bottom: 4px; color: #7a7a86;
        font-size: 9.5px; letter-spacing: .12em; text-transform: uppercase;
    }
    /* O sprite fica junto do seletor, e não do "hunt atual": sem isso, o
       Pokémon exibido seria o da caçada enquanto os números são de outro. */
    #pp-rt-perfil-row { display: flex; align-items: center; gap: 8px; justify-content: flex-end; }
    #pp-rt-perfil-img {
        width: 24px; height: 24px; flex: none; object-fit: contain;
        image-rendering: pixelated; display: none;
    }
    #pp-rt-perfil-img.pp-on { display: block; }
    #pp-rt-perfil {
        background: #101014; border: 1px solid #33333c; border-radius: 8px;
        color: #d9b665; padding: 6px 9px; max-width: 200px;
        font: 500 12px ui-sans-serif, system-ui, sans-serif;
    }
    #pp-rt-perfil:focus-visible { outline: 2px solid #d9b665; outline-offset: 1px; }
    #pp-rt-hunt-label {
        margin: 0 0 2px; color: #7a7a86; font-size: 10.5px;
        letter-spacing: .12em; text-transform: uppercase;
    }
    #pp-rt-hunt-name { margin: 0 0 4px; font-size: 15px; font-weight: 500; color: #e6e6ea; }
    #pp-rt-hunt-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .pp-rt-shiny { color: #4fc6ea; font-size: 12px; font-weight: 500; }

    .pp-rt-tabs {
        display: grid; grid-template-columns: 1fr 1fr 1fr;
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

    /* Filtros ficam no HTML fixo e só são exibidos na aba de capturas: se
       fossem recriados a cada render, o campo perderia o foco na digitação. */
    #pp-rt-filters {
        display: none; grid-template-columns: 1.3fr .8fr .8fr 1.1fr;
        gap: 8px; padding: 6px 20px 0; align-items: end;
        height: 56px; box-sizing: border-box;
    }
    #pp-rt-filters.pp-on { display: grid; }
    .pp-rt-field { display: flex; flex-direction: column; gap: 4px; }
    .pp-rt-field label {
        color: #7a7a86; font-size: 9.5px; letter-spacing: .1em; text-transform: uppercase;
    }
    .pp-rt-field select, .pp-rt-field input {
        background: #16161a; border: 1px solid #26262e; border-radius: 8px;
        color: #e6e6ea; padding: 7px 9px; font: 400 12px ui-sans-serif, system-ui, sans-serif;
    }
    .pp-rt-field select:focus-visible, .pp-rt-field input:focus-visible {
        outline: 2px solid #d9b665; outline-offset: 1px;
    }
    .pp-rt-iv { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }

    #pp-rt-pager {
        display: none; align-items: center; justify-content: space-between;
        gap: 10px; padding: 3px 20px 0;
        height: 44px; box-sizing: border-box;
    }
    #pp-rt-pager.pp-on { display: flex; }
    #pp-rt-pager span { color: #7a7a86; font-size: 11px; font-variant-numeric: tabular-nums; }
    #pp-rt-pager div { display: flex; gap: 6px; }
    #pp-rt-pager button {
        background: #16161a; border: 1px solid #26262e; border-radius: 7px;
        color: #b9b9c2; padding: 5px 11px; cursor: pointer; font-size: 12px;
    }
    #pp-rt-pager button:disabled { color: #3c3c44; cursor: default; }
    #pp-rt-pager button:not(:disabled):hover { border-color: #d9b665; color: #d9b665; }

    /* Cada captura é uma linha só. A especificidade dupla vence a regra de
       colunas da tabela, que aparece depois no arquivo. */
    /* Cabeçalho e linhas compartilham a mesma grade para os rótulos ficarem
       alinhados. A especificidade dupla vence a grade padrão da tabela. */
    .pp-rt-hrow.pp-rt-hrow--log,
    .pp-rt-row.pp-rt-row--log {
        display: grid;
        grid-template-columns: 1.6fr .9fr .75fr .9fr .95fr 1fr .85fr;
        gap: 14px; align-items: center;
    }
    .pp-rt-row.pp-rt-row--log { padding: 7px 14px; height: 42px; }

    .pp-rt-cap-nome {
        display: flex; align-items: center; gap: 9px; min-width: 0;
        font-weight: 500; font-size: 13px;
    }
    .pp-rt-cap-nome span {
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .pp-rt-cap-img {
        width: 26px; height: 26px; flex: none; object-fit: contain; image-rendering: pixelated;
    }
    .pp-rt-cap-iv { font-variant-numeric: tabular-nums; font-size: 12.5px; }
    .pp-rt-cap-nat { font-size: 12px; color: #b9b9c2; text-transform: capitalize; }
    .pp-rt-cap-gen { font-size: 12px; color: #b9b9c2; white-space: nowrap; }
    .pp-rt-cap-bola {
        display: flex; align-items: center; font-size: 12px; color: #b9b9c2;
        white-space: nowrap; min-width: 0;
    }
    .pp-rt-cap-dest { font-size: 12px; text-align: right; }
    .pp-rt-empty {
        color: #55555f; font-size: 13px; height: 282px;
        display: flex; align-items: center; justify-content: center;
    }

    #pp-rt-table { padding: 6px 20px 2px; position: relative; }

    /* Mini painel de genética, no estilo da tela do jogo. pointer-events:none
       para que ele nunca roube o hover da própria linha. */
    #pp-rt-market-tip {
        position: fixed; z-index: 2147483647; display: none;
        width: 336px; padding: 0; pointer-events: none; overflow: hidden;
        background: #0e0e10; border: 1px solid #3a3a44; border-radius: 12px;
        box-shadow: 0 16px 38px rgba(0,0,0,.72);
        font-family: ui-sans-serif, system-ui, sans-serif; color: #e6e6ea;
    }
    #pp-rt-market-tip.pp-on { display: block; }

    #pp-rt-tip {
        position: absolute; display: none; z-index: 5; right: 26px;
        width: 336px; padding: 0; pointer-events: none; overflow: hidden;
        background: #0e0e10; border: 1px solid #3a3a44; border-radius: 12px;
        box-shadow: 0 16px 38px rgba(0,0,0,.7);
    }
    #pp-rt-tip.pp-on { display: block; }

    /* Cabeçalho: sprite, nome, raridade, multiplicador e poder total */
    .pp-rt-tip-top {
        display: flex; align-items: center; gap: 12px;
        padding: 11px 13px; background: #16161a; border-bottom: 1px solid #26262e;
    }
    .pp-rt-tip-sprite {
        width: 52px; height: 52px; flex: none; object-fit: contain;
        image-rendering: pixelated; background: #101014;
        border: 1px solid #26262e; border-radius: 50%; padding: 3px;
    }
    .pp-rt-tip-id { flex: 1; min-width: 0; }
    .pp-rt-tip-id h3 { margin: 0 0 4px; font-size: 15px; font-weight: 600; }
    .pp-rt-tip-tags { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .pp-rt-tip-lvl {
        background: #1c2b3a; border: 1px solid #2f4a63; color: #7fb6e0;
        border-radius: 6px; padding: 2px 7px; font-size: 10.5px;
    }
    .pp-rt-tip-poder { text-align: right; flex: none; }
    .pp-rt-tip-poder b { display: block; font-size: 19px; color: #e6e6ea; line-height: 1.1; }
    .pp-rt-tip-poder span {
        display: block; color: #7a7a86; font-size: 8.5px;
        letter-spacing: .1em; text-transform: uppercase;
    }
    .pp-rt-tip-mult {
        display: block; margin-top: 5px; text-align: center;
        background: #221d12; border: 1px solid #4a3d22; border-radius: 6px;
        color: #d9b665; padding: 3px 7px; font-size: 10.5px;
        font-variant-numeric: tabular-nums;
    }

    /* Duas colunas: atributos de batalha e genética, como no jogo */
    .pp-rt-tip-cols { display: grid; grid-template-columns: 1fr 1fr; }
    .pp-rt-tip-col { padding: 10px 13px; }
    .pp-rt-tip-col + .pp-rt-tip-col { border-left: 1px solid #26262e; }
    .pp-rt-tip-head {
        margin: 0 0 7px; color: #d9b665; font-size: 10px;
        letter-spacing: .1em; text-transform: uppercase;
    }
    .pp-rt-stat {
        display: flex; justify-content: space-between; align-items: baseline;
        gap: 8px; margin-bottom: 5px; font-size: 11px;
    }
    .pp-rt-stat span { color: #8b8b95; }
    .pp-rt-stat b { color: #e6e6ea; font-weight: 600; font-variant-numeric: tabular-nums; }
    .pp-rt-tip-total {
        display: flex; justify-content: space-between; align-items: baseline;
        padding: 8px 13px; border-top: 1px solid #26262e;
        font-size: 11.5px; color: #8b8b95;
    }
    .pp-rt-tip-total b { color: #e6e6ea; font-variant-numeric: tabular-nums; }
    .pp-rt-tip-vazio { color: #55555f; font-size: 11px; margin: 0; }
    .pp-rt-hrow, .pp-rt-row {
        display: grid; grid-template-columns: 1.4fr .8fr .8fr 1.7fr;
        gap: 12px; align-items: center;
    }
    .pp-rt-hrow {
        padding: 7px 14px; color: #7a7a86;
        font-size: 10px; letter-spacing: .1em; text-transform: uppercase;
        height: 26px; box-sizing: border-box;
    }
    .pp-rt-row {
        background: #16161a; border: 1px solid #26262e; border-radius: 10px;
        padding: 9px 14px; margin-bottom: 5px;
        height: 42px; box-sizing: border-box;
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
        max-width: 190px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
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
    let view = 'rarity';   // 'rarity' | 'ball' | 'log'
    let logPage = 0;
    let perfilAtivo = '';  // '' = todas as hunts somadas

    // Os três painéis leem daqui: o total da conta ou uma hunt específica.
    const dadosAtivos = () =>
        (perfilAtivo && state && state.hunts[perfilAtivo]) || state;

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
                    <div id="pp-rt-perfil-box">
                        <label id="pp-rt-perfil-label" for="pp-rt-perfil">Mostrando estatísticas</label>
                        <div id="pp-rt-perfil-row">
                            <img id="pp-rt-perfil-img" alt="" />
                            <select id="pp-rt-perfil"></select>
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
                    <button class="pp-rt-tab" type="button" data-view="log">Capturas</button>
                </div>
                <div id="pp-rt-filters">
                    <div class="pp-rt-field">
                        <label for="pp-rt-f-q">Raridade</label>
                        <select id="pp-rt-f-q"><option value="">Todas</option></select>
                    </div>
                    <div class="pp-rt-field">
                        <label for="pp-rt-f-ivmin">IV mínimo</label>
                        <input id="pp-rt-f-ivmin" type="number" min="0" max="186" placeholder="0" />
                    </div>
                    <div class="pp-rt-field">
                        <label for="pp-rt-f-ivmax">IV máximo</label>
                        <input id="pp-rt-f-ivmax" type="number" min="0" max="186" placeholder="186" />
                    </div>
                    <div class="pp-rt-field">
                        <label for="pp-rt-f-sold">Destino</label>
                        <select id="pp-rt-f-sold">
                            <option value="">Todos</option>
                            <option value="sold">Vendidos</option>
                            <option value="kept">Guardados</option>
                        </select>
                    </div>
                </div>
                <div id="pp-rt-table">
                    <div class="pp-rt-hrow">
                        <div id="pp-rt-h1">Raridade</div><div>Tentativas</div><div>Capturas</div><div>Taxa de captura</div>
                    </div>
                    <div id="pp-rt-rows"></div>
                    <div id="pp-rt-tip"></div>
                </div>
                <div id="pp-rt-pager">
                    <span id="pp-rt-pager-info"></span>
                    <div>
                        <button id="pp-rt-prev" type="button">Anteriores</button>
                        <button id="pp-rt-next" type="button">Próximas</button>
                    </div>
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
            perfil: overlay.querySelector('#pp-rt-perfil'),
            perfilLabel: overlay.querySelector('#pp-rt-perfil-label'),
            perfilImg: overlay.querySelector('#pp-rt-perfil-img'),
            reset: overlay.querySelector('#pp-rt-reset'),
            panel: overlay.querySelector('#pp-rt-panel'),
            tAtt: overlay.querySelector('#pp-rt-t-att'),
            tCap: overlay.querySelector('#pp-rt-t-cap'),
            tShi: overlay.querySelector('#pp-rt-t-shi'),
            title: overlay.querySelector('#pp-rt-title'),
            head1: overlay.querySelector('#pp-rt-h1'),
            tabs: [...overlay.querySelectorAll('.pp-rt-tab')],
            account: overlay.querySelector('#pp-rt-account'),
            diag: overlay.querySelector('#pp-rt-diag'),
            hrow: overlay.querySelector('.pp-rt-hrow'),
            tip: overlay.querySelector('#pp-rt-tip'),
            filters: overlay.querySelector('#pp-rt-filters'),
            fQ: overlay.querySelector('#pp-rt-f-q'),
            fIvMin: overlay.querySelector('#pp-rt-f-ivmin'),
            fIvMax: overlay.querySelector('#pp-rt-f-ivmax'),
            fSold: overlay.querySelector('#pp-rt-f-sold'),
            pager: overlay.querySelector('#pp-rt-pager'),
            pagerInfo: overlay.querySelector('#pp-rt-pager-info'),
            prev: overlay.querySelector('#pp-rt-prev'),
            next: overlay.querySelector('#pp-rt-next'),
        };

        // Preenche o filtro de raridade a partir do catálogo
        RARITIES.forEach(r => {
            const opt = document.createElement('option');
            opt.value = r.key;
            opt.textContent = r.label;
            els.fQ.appendChild(opt);
        });

        // Qualquer mudança de filtro volta para a primeira página
        [els.fQ, els.fIvMin, els.fIvMax, els.fSold].forEach(el => {
            el.addEventListener('change', () => { logPage = 0; render(); });
            el.addEventListener('input', () => { logPage = 0; render(); });
        });

        // Delegação: as linhas são recriadas a cada render, então o ouvinte
        // fica no contêiner, que é permanente.
        els.rows.addEventListener('mouseover', ev => {
            if (view !== 'log') return;
            const linha = ev.target.closest && ev.target.closest('.pp-rt-row--log[data-i]');
            if (linha) mostrarTip(linha); else esconderTip();
        });
        els.rows.addEventListener('mouseleave', esconderTip);

        els.prev.addEventListener('click', () => { logPage = Math.max(0, logPage - 1); render(); });
        els.next.addEventListener('click', () => { logPage++; render(); });

        els.tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                view = tab.dataset.view;
                logPage = 0;
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

        els.perfil.addEventListener('change', () => {
            perfilAtivo = els.perfil.value;
            logPage = 0;
            render();
        });

        els.huntBtn.addEventListener('click', () => {
            if (!hunt || !hunt.shinySprite) return;
            showShiny = !showShiny;
            renderHunt();
        });

        els.reset.addEventListener('click', () => {
            if (!state) return;
            const h = perfilAtivo && state.hunts[perfilAtivo];

            if (h) {
                if (!confirm(`Zerar os contadores da hunt ${h.nome}? `
                    + 'Esses números também saem do total, e as outras hunts não são afetadas.')) return;

                // Subtrai do total o que pertencia a esta hunt: sem isso, o
                // total guardaria números que você não vê em lugar nenhum.
                for (const k of RARITY_KEYS) {
                    state.attempts[k] = Math.max(0, state.attempts[k] - h.attempts[k]);
                    state.captures[k] = Math.max(0, state.captures[k] - h.captures[k]);
                }
                for (const [bk, bv] of Object.entries(h.balls)) {
                    const g = state.balls[bk];
                    if (!g) continue;
                    g.attempts = Math.max(0, g.attempts - bv.attempts);
                    g.captures = Math.max(0, g.captures - bv.captures);
                }
                state.shinyEncounters = Math.max(0, state.shinyEncounters - h.shinyEncounters);
                state.shinyCaptures = Math.max(0, state.shinyCaptures - h.shinyCaptures);
                state.log = state.log.filter(e => e.h !== perfilAtivo);

                const zerada = novaHunt(h.nome, h.sp, h.map);
                zerada.ultimo = h.ultimo;
                state.hunts[perfilAtivo] = zerada;
            } else {
                const quem = state.accountName ? `da conta ${state.accountName}` : 'desta conta';
                if (!confirm(`Zerar TODOS os contadores ${quem}, incluindo todas as hunts? `
                    + 'A outra aba não é afetada, e seu progresso no jogo também não.')) return;
                const name = state.accountName;
                state = defaultState();
                state.accountName = name;
                perfilAtivo = '';
                seenCombat.clear();
                diag.gaps = 0;
            }

            logPage = 0;
            if (els.perfil) els.perfil.__pp = null;
            save();
            render();
        });

        window.addEventListener('resize', () => {
            if (fabPos) placeFab(fabPos.left, fabPos.top);
            fitPanel();
        });

        ligarMercado();

        // Sem evento novo, nada dispararia o redesenho; esta checagem leve faz
        // o cartão passar para "sem caçada" quando os combates cessam.
        setInterval(() => {
            if (els.overlay.classList.contains('pp-open')) renderHunt();
        }, 5000);

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

    // O rótulo de uma bola fora do catálogo vem do servidor e é o único
    // trecho de origem externa que entra em innerHTML.
    const escapeHtml = v => String(v).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[c]);

    // Sprites vêm do endpoint de espécies; aceitar só http(s) impede que uma
    // URL javascript: chegue ao atributo src.
    function safeImageUrl(value) {
        try {
            const url = new URL(String(value), location.href);
            return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
        } catch (e) {
            return null;
        }
    }

    function renderHunt() {
        if (!els || !els.hunt) return;

        // O cartão nunca some: o seletor de estatísticas mora nele.
        els.hunt.classList.add('pp-on');

        const parado = !hunt || cacadaEncerrada
            || Date.now() - ultimoCombate > HUNT_INATIVA_MS;
        if (parado) {
            // Sem combates chegando. Pode ser cidade, caçada pausada ou troca
            // de mapa — como não dá para distinguir, o texto vale para todos.
            els.huntName.textContent = 'Nenhuma caçada em andamento';
            els.huntHint.textContent = 'os contadores seguem guardados';
            els.huntHint.style.color = '#55555f';
            els.huntBtn.style.display = 'none';
            return;
        }

        els.huntName.textContent = hunt.name;

        const alvo = safeImageUrl(showShiny ? hunt.shinySprite : hunt.sprite);
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

    const GENERO = { male: '♂', female: '♀' };
    const GENERO_NOME = { male: 'Macho ♂', female: 'Fêmea ♀' };

    const iconeBola = b => `<span class="pp-rt-ball" style="--pp-band:${b.band};`
        + `background:linear-gradient(to bottom,${b.top} 0 44%,${b.band} 44% 56%,${b.bottom} 56% 100%)"></span>`;

    // Lista de perfis: o total e cada hunt vista, da mais movimentada para a
    // menos. Nomes repetidos ganham o mapa para não ficarem ambíguos.
    function renderPerfis() {
        const chaves = Object.keys(state.hunts).sort((a, b) => {
            const A = state.hunts[a], B = state.hunts[b];
            const sa = RARITY_KEYS.reduce((x, k) => x + A.attempts[k], 0);
            const sb = RARITY_KEYS.reduce((x, k) => x + B.attempts[k], 0);
            return sb - sa;
        });

        const contagem = Object.create(null);
        for (const k of chaves) {
            const n = state.hunts[k].nome;
            contagem[n] = (contagem[n] || 0) + 1;
        }

        const assinatura = perfilAtivo + '|' + chaves.join(',');
        if (els.perfil.__pp === assinatura) return;   // nada mudou: não redesenha
        els.perfil.__pp = assinatura;

        const opcoes = [['', 'Todas as hunts']].concat(chaves.map(k => {
            const h = state.hunts[k];
            const rotulo = contagem[h.nome] > 1 && h.map
                ? `${h.nome} · mapa ${h.map}` : h.nome;
            return [k, rotulo];
        }));

        els.perfil.innerHTML = opcoes.map(([v, r]) =>
            `<option value="${escapeHtml(v)}">${escapeHtml(r)}</option>`).join('');

        // A hunt selecionada pode ter saído do limite guardado.
        if (perfilAtivo && !state.hunts[perfilAtivo]) perfilAtivo = '';
        els.perfil.value = perfilAtivo;
    }

    // Deixa explícito de quem são os números na tela.
    function renderRotuloPerfil() {
        const h = perfilAtivo && state.hunts[perfilAtivo];
        els.perfilLabel.textContent = h
            ? 'Mostrando estatísticas de'
            : 'Mostrando estatísticas gerais';

        const url = h && spriteDe({ sp: h.sp, shiny: false });
        if (url) {
            if (els.perfilImg.getAttribute('src') !== url) els.perfilImg.setAttribute('src', url);
            els.perfilImg.alt = h.nome;
            els.perfilImg.classList.add('pp-on');
        } else {
            els.perfilImg.classList.remove('pp-on');
        }
    }

    function renderLog() {
        els.hrow.style.display = '';
        els.hrow.classList.add('pp-rt-hrow--log');
        els.hrow.innerHTML = '<div>Pokémon</div><div>Raridade</div><div>IV</div>'
            + '<div>Natureza</div><div>Gênero</div><div>Pokébola</div>'
            + '<div style="text-align:right">Destino</div>';
        esconderTip();

        // Filtros lidos na hora; os campos vivem no HTML fixo justamente para
        // não perderem o foco a cada redesenho.
        const fq = els.fQ.value;
        const min = els.fIvMin.value === '' ? 0 : Number(els.fIvMin.value);
        const max = els.fIvMax.value === '' ? IV_MAX : Number(els.fIvMax.value);
        const fs = els.fSold.value;

        const lista = state.log.filter(e =>
            (!perfilAtivo || e.h === perfilAtivo)
            && (!fq || e.q === fq)
            && e.iv >= (Number.isFinite(min) ? min : 0)
            && e.iv <= (Number.isFinite(max) ? max : IV_MAX)
            && (!fs || (fs === 'sold' ? e.sold : !e.sold)));

        const paginas = Math.max(1, Math.ceil(lista.length / LOG_PAGE));
        if (logPage > paginas - 1) logPage = paginas - 1;
        const inicio = logPage * LOG_PAGE;
        const pagina = lista.slice(inicio, inicio + LOG_PAGE);

        if (!lista.length) {
            els.rows.innerHTML = `<div class="pp-rt-empty">${state.log.length
                ? 'Nenhuma captura corresponde aos filtros.'
                : 'Nenhuma captura registrada ainda.'}</div>`;
        } else {
            paginaAtual = pagina;
            els.rows.innerHTML = pagina.map((e, i) => {
                const r = RARITIES.find(x => x.key === e.q) || RARITIES[0];
                const bola = BALL_BY_KEY[e.bola];
                const sp = e.sp && speciesIndex.get(e.sp);
                const img = safeImageUrl((sp && (e.shiny ? sp.shiny : sp.sprite))
                    || (e.sp ? `/assets/imported/creatures/${e.sp}/${e.shiny ? 'shiny' : 'front'}.png` : ''));

                // O evento de captura nem sempre traz species_name; o catálogo
                // de espécies tem o nome correto, e o id serve de reserva.
                const nome = (sp && sp.name) || prettify(e.nome);

                return `
                <div class="pp-rt-row pp-rt-row--log" data-i="${i}">
                    <span class="pp-rt-cap-nome">
                        ${img ? `<img class="pp-rt-cap-img" src="${escapeHtml(img)}" alt="" />` : ''}
                        <span>${escapeHtml(nome)}${e.shiny ? ' ✦' : ''}</span>
                    </span>
                    <span class="pp-rt-badge" style="color:${r.color};font-size:11px;padding:3px 10px;
                          box-shadow: 0 0 9px ${r.color}59, inset 0 0 9px ${r.color}1f;
                          text-shadow: 0 0 7px ${r.color}8c;">${r.label}</span>
                    <span class="pp-rt-cap-iv">${fmt(e.iv)}<span class="pp-rt-muted">/${IV_MAX}</span></span>
                    <span class="pp-rt-cap-nat">${escapeHtml(e.nat)}</span>
                    <span class="pp-rt-cap-gen">${GENERO_NOME[e.gen] || '—'}</span>
                    <span class="pp-rt-cap-bola">
                        ${bola ? iconeBola(bola) : ''}${escapeHtml(bola ? bola.label : e.bola)}
                    </span>
                    <span class="pp-rt-cap-dest" style="color:${e.sold ? '#8b8b95' : '#54d97c'}">
                        ${e.sold ? 'Vendido' : 'Guardado'}
                    </span>
                </div>`;
            }).join('')
            + `<div class="pp-rt-row pp-rt-row--log pp-rt-spacer"></div>`
                .repeat(Math.max(0, LOG_PAGE - pagina.length));
        }

        const limite = `mostra as últimas ${fmt(LOG_CAP)} capturas`;
        els.pagerInfo.textContent = lista.length
            ? `${fmt(inicio + 1)}–${fmt(inicio + pagina.length)} de ${fmt(lista.length)} · ${limite}`
            : limite.charAt(0).toUpperCase() + limite.slice(1);
        els.prev.disabled = logPage === 0;
        els.next.disabled = inicio + LOG_PAGE >= lista.length;
    }

    let paginaAtual = [];

    const esconderTip = () => { if (els && els.tip) els.tip.classList.remove('pp-on'); };

    // Sprite de uma entrada: prioriza a URL que veio junto do dado, depois o
    // catálogo de espécies, e por último o caminho padrão.
    function spriteDe(e) {
        const sp = e.sp && speciesIndex.get(e.sp);
        return safeImageUrl(
            (e.shiny ? e.spriteS : e.spriteN)
            || (sp && (e.shiny ? sp.shiny : sp.sprite))
            || (e.sp ? `/assets/imported/creatures/${e.sp}/${e.shiny ? 'shiny' : 'front'}.png` : ''));
    }

    // Monta o cartão de detalhes. Usado tanto pelo registro de capturas
    // quanto pelos anúncios do mercado, que têm os mesmos campos.
    function tipHtml(e) {
        const r = RARITIES.find(x => x.key === e.q) || RARITIES[0];
        const sp = e.sp && speciesIndex.get(e.sp);
        const nome = e.nome && e.nome !== e.sp ? e.nome : ((sp && sp.name) || prettify(e.nome || e.sp || '?'));
        const img = spriteDe(e);

        const batalha = e.bat
            ? BAT_STATS.map((rotulo, i) =>
                `<div class="pp-rt-stat"><span>${rotulo}</span><b>${fmt(e.bat[i])}</b></div>`).join('')
            : '<p class="pp-rt-tip-vazio">Sem dados desta captura.</p>';

        const genetica = (e.nat || e.gen
            ? `<div class="pp-rt-stat"><span>Natureza</span><b>${escapeHtml(e.nat || '—')}</b></div>`
              + `<div class="pp-rt-stat"><span>Gênero</span><b>${GENERO_NOME[e.gen] || '—'}</b></div>`
            : '')
            + (e.det
                ? IV_STATS.map(([, rotulo], i) =>
                    `<div class="pp-rt-stat"><span>${rotulo}</span><b>${e.det[i]}</b></div>`).join('')
                : '<p class="pp-rt-tip-vazio">Capturas anteriores a esta versão não guardaram os IVs.</p>');

        return `
            <div class="pp-rt-tip-top">
                ${img ? `<img class="pp-rt-tip-sprite" src="${escapeHtml(img)}" alt="" />` : ''}
                <div class="pp-rt-tip-id">
                    <h3 style="color:${r.color}">${escapeHtml(nome)}${e.shiny ? ' ✦' : ''}</h3>
                    <div class="pp-rt-tip-tags">
                        ${e.lvl ? `<span class="pp-rt-tip-lvl">Nível ${fmt(e.lvl)}</span>` : ''}
                        <span class="pp-rt-badge" style="color:${r.color};font-size:10.5px;padding:2px 9px;
                              box-shadow: 0 0 8px ${r.color}4d, inset 0 0 8px ${r.color}1a;
                              text-shadow: 0 0 6px ${r.color}80;">${r.label}</span>
                    </div>
                </div>
                <div class="pp-rt-tip-poder">
                    <b>${fmt(e.poder || 0)}</b><span>Poder total</span>
                    ${e.mult ? `<span class="pp-rt-tip-mult">×${e.mult.toFixed(2)}</span>` : ''}
                </div>
            </div>
            <div class="pp-rt-tip-cols">
                <div class="pp-rt-tip-col">
                    <p class="pp-rt-tip-head">Atributos de batalha</p>
                    ${batalha}
                </div>
                <div class="pp-rt-tip-col">
                    <p class="pp-rt-tip-head">Genética</p>
                    ${genetica}
                </div>
            </div>
            <div class="pp-rt-tip-total"><span>IV total</span>
                <b>${fmt(e.iv)}/${IV_MAX}</b></div>`;
    }

    // O anúncio traz a criatura completa; aqui ela vira o mesmo formato que
    // o registro de capturas usa, para reaproveitar o cartão.
    function criaturaParaCartao(c) {
        const ivs = c.ivs && typeof c.ivs === 'object' ? c.ivs : {};
        const det = IV_STATS.map(([k]) => Math.min(Number(ivs[k]) || 0, IV_STAT_MAX));
        return {
            sp: String(c.species_id || ''),
            nome: String(c.species_name || c.species_id || '?'),
            q: normalize(c.quality) || 'weak',
            lvl: Number(c.level) || 0,
            iv: det.reduce((a, v) => a + v, 0),
            det,
            mult: Number(c.quality_multiplier) || 0,
            bat: [c.max_hp, c.atk, c.def, c.spa, c.spd, c.spe].map(v => Number(v) || 0),
            poder: Number(c.power) || 0,
            nat: String(c.nature || ''),
            gen: c.gender === 'male' || c.gender === 'female' ? c.gender : '',
            shiny: !!c.is_shiny,
            spriteN: c.normal_sprite_url,
            spriteS: c.shiny_sprite_url,
        };
    }

    // Largura aproximada do balão nativo do jogo, medida na tela do mercado.
    // Serve só para desviar dele quando não há espaço do outro lado.
    const BALAO_JOGO = 300;

    let marketTip = null;

    function ligarMercado() {
        marketTip = document.createElement('div');
        marketTip.id = 'pp-rt-market-tip';
        document.body.appendChild(marketTip);

        const esconder = () => marketTip.classList.remove('pp-on');

        // Delegação no documento: os cards do mercado são criados e destruídos
        // pelo próprio jogo, então não dá para ouvir cada um.
        document.addEventListener('mouseover', ev => {
            const card = ev.target.closest
                && ev.target.closest('article.market-listing[data-listing-id]');
            if (!card) { esconder(); return; }

            const c = listings.get(card.dataset.listingId);
            if (!c) { esconder(); return; }

            marketTip.innerHTML = tipHtml(criaturaParaCartao(c));
            marketTip.classList.add('pp-on');

            // Colado no card, do lado direito. O balão nativo do jogo só abre
            // quando o mouse está sobre o sprite (.market-listing__icon) e sai
            // pela direita — nesse caso este vai para a esquerda, e os dois
            // ficam lado a lado em vez de sobrepostos.
            const sobreSprite = !!(ev.target.closest
                && ev.target.closest('.market-listing__icon'));

            const r = card.getBoundingClientRect();
            const w = marketTip.offsetWidth;
            const h = marketTip.offsetHeight;
            const folga = 12;

            const naDireita = r.right + folga;
            const naEsquerda = r.left - folga - w;
            const cabeDireita = naDireita + w <= window.innerWidth - 6;
            const cabeEsquerda = naEsquerda >= 6;

            let esquerda;
            if (sobreSprite) {
                // Primeira escolha: o lado oposto ao balão do jogo.
                // Sem espaço lá (card na coluna da esquerda), passa depois
                // dele, deixando card, balão e cartão em fila.
                const depoisDoBalao = r.right + folga + BALAO_JOGO;
                esquerda = cabeEsquerda ? naEsquerda
                    : depoisDoBalao + w <= window.innerWidth - 6 ? depoisDoBalao
                    : Math.max(6, window.innerWidth - w - 6);
            } else {
                esquerda = cabeDireita ? naDireita : Math.max(6, naEsquerda);
            }

            const topo = Math.max(6, Math.min(r.top, window.innerHeight - h - 6));
            marketTip.style.left = Math.max(6, esquerda) + 'px';
            marketTip.style.top = topo + 'px';
        }, true);

        document.addEventListener('mouseout', ev => {
            if (ev.target.closest && ev.target.closest('article.market-listing')) esconder();
        }, true);
    }

    function mostrarTip(linha) {
        const e = paginaAtual[Number(linha.dataset.i)];
        if (!e) return;

        els.tip.innerHTML = tipHtml(e);
        els.tip.classList.add('pp-on');

        // Ancorada na linha, mas presa dentro da tabela: o painel usa
        // overflow hidden e a mini tela sumiria se vazasse.
        const alturaTabela = els.rows.offsetHeight + els.rows.offsetTop;
        const alvo = linha.offsetTop + linha.offsetHeight / 2 - els.tip.offsetHeight / 2;
        const topo = Math.max(els.rows.offsetTop,
            Math.min(alvo, alturaTabela - els.tip.offsetHeight));
        els.tip.style.top = topo + 'px';
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

        renderPerfis();
        renderRotuloPerfil();
        const D = dadosAtivos();

        const totalAtt = RARITY_KEYS.reduce((s, k) => s + D.attempts[k], 0);
        const totalCap = RARITY_KEYS.reduce((s, k) => s + D.captures[k], 0);

        els.tAtt.textContent = fmt(totalAtt);
        els.tCap.textContent = fmt(totalCap);
        els.tShi.textContent = `${fmt(D.shinyCaptures)} / ${fmt(D.shinyEncounters)}`;

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
                      text-shadow: 0 0 7px ${color}8c;">${o.icon || ''}${escapeHtml(label)}</span>
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
        const extras = Object.keys(D.balls)
            .filter(k => !BALL_BY_KEY[k] && D.balls[k].attempts > 0);
        const maxLinhas = Math.max(RARITIES.length, BALLS.length + extras.length);
        const preencher = n => n > 0
            ? row('—', '#000000', 0, 0, { extraClass: ' pp-rt-spacer' }).repeat(n)
            : '';

        // O título acompanha a aba ativa.
        els.title.textContent = view === 'ball' ? 'Capturas por pokébola'
            : view === 'log' ? 'Registro de capturas'
            : 'Capturas por raridade';

        // Filtros e paginação só existem na aba de capturas.
        els.filters.classList.toggle('pp-on', view === 'log');
        els.pager.classList.toggle('pp-on', view === 'log');

        if (view === 'log') {
            renderLog();
        } else if (view === 'ball') {
            els.head1.textContent = 'Pokébola';

            const vazia = { attempts: 0, captures: 0 };
            const chaves = Object.keys(D.balls);

            const tAtt = chaves.reduce((a, k) => a + D.balls[k].attempts, 0);
            const tCap = chaves.reduce((a, k) => a + D.balls[k].captures, 0);

            const linhas = BALLS.map(b => {
                const d = D.balls[b.key] || vazia;
                return row(b.label, b.color, d.attempts, d.captures,
                    { dashWhenEmpty: true, icon: iconeBola(b) });
            });

            // Qualquer bola fora do catálogo (ex.: recompensa de evento) entra
            // depois, e só se tiver sido usada.
            extras.slice()
                .sort((a, b) => D.balls[b].attempts - D.balls[a].attempts)
                .forEach(k => linhas.push(
                    row(k, OTHER_BALL_COLOR, D.balls[k].attempts, D.balls[k].captures)));

            els.rows.innerHTML =
                row('Todas', ALL_ROW.color, tAtt, tCap, { extraClass: ' pp-rt-row--all' })
                + linhas.join('')
                + preencher(maxLinhas - linhas.length);
        } else {
            els.hrow.style.display = '';
            els.hrow.classList.remove('pp-rt-hrow--log');
            els.hrow.innerHTML = '<div id="pp-rt-h1">Raridade</div><div>Tentativas</div>'
                + '<div>Capturas</div><div>Taxa de captura</div>';
            els.head1 = els.hrow.querySelector('#pp-rt-h1');

            const sum = key => RARITY_KEYS.reduce((acc, k) => acc + D[key][k], 0);
            const allAtt = sum('attempts');
            const allCap = sum('captures');

            els.rows.innerHTML =
                row(ALL_ROW.label, ALL_ROW.color, allAtt, allCap, { extraClass: ' pp-rt-row--all' })
                + RARITIES.map(r =>
                    row(r.label, r.color, D.attempts[r.key], D.captures[r.key])
                ).join('')
                + preencher(maxLinhas - RARITIES.length);
        }

        const since = new Date(D === state ? state.startedAt : D.desde).toLocaleString('pt-BR');
        if (els.fab.__ppSetTitle) els.fab.__ppSetTitle(state.accountName);

        const huntSel = perfilAtivo && state.hunts[perfilAtivo];
        els.reset.textContent = huntSel ? `Zerar ${huntSel.nome}` : 'Zerar tudo';

        const nHunts = Object.keys(state.hunts).length;
        const aviso = nHunts
            ? ` · guarda ${fmt(HUNTS_CAP)} hunts; passando disso, sai a menos usada`
            : '';
        els.note.textContent = totalAtt === 0
            ? 'Nenhuma pokébola registrada ainda. A conta começa quando a primeira for jogada.'
            : `Contando desde ${since}${aviso}`;

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
