// ==UserScript==
// @name         Pokepixel — Raridades
// @namespace    https://pokepixel.nietore.com/
// @version      7.13.0
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
// @grant        GM_info
// ==/UserScript==

(function () {
    'use strict';

    // Com qualquer @grant ativo o Tampermonkey roda num sandbox: patchear
    // `window` ali não afeta o que a página realmente usa.
    const W = (typeof unsafeWindow !== 'undefined' && unsafeWindow) || window;

    // Versão visível no painel. Sem isto não há como saber, olhando o jogo,
    // se a extensão que está rodando é a que você acabou de instalar — e uma
    // atualização que não pegou é indistinguível de uma correção que não
    // funcionou. Custou rodadas de investigação neste projeto.
    const VERSAO = (() => {
        try { return (GM_info && GM_info.script && GM_info.script.version) || '?'; }
        catch (e) { return '?'; }
    })();

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
        // Não é pokébola: é a Eevee comprada no cassino, que o jogo também
        // soma como captura. Fica na mesma aba para o total fechar, mas com
        // identidade própria. O match nunca casa — a chave é atribuída
        // diretamente pela zona de captura.
        { key: 'cassino', label: 'Cassino Eevee', match: /(?!)/, art: 'eevee',
          color: '#c8a06a', top: '#c07f3c', band: '#f0dfae', bottom: '#a4682f' },
    ];
    const BALL_BY_KEY = BALLS.reduce((m, b) => (m[b.key] = b, m), {});

    /* ---------------------------------------------------------------
     * CHANCE DE CAPTURA
     *
     * Fórmula publicada na wiki do jogo:
     *
     *   base      = taxa da espécie ÷ 255 × multiplicador da cápsula
     *   penalidade de nível = 1 ÷ (1 + nível selvagem × escala)
     *   chance    = base × penalidade × dificuldade
     *               × lendário/mítico × shiny × penalidade da qualidade
     *               × zona × bônus globais
     *
     * A escala de nível é 0,012, não o 0,01 que o painel do simulador
     * mostra — ele arredonda. Conferido em três pontos: nos níveis 50,
     * 100 e 150 o simulador dá 16,5441%, 12,0321% e 9,4538%, e a conta
     * com 0,012 reproduz os três na quarta casa. Com 0,01 nenhum fecha.
     * ------------------------------------------------------------- */
    const CAP_DIFICULDADE = 0.3;
    const CAP_ESCALA_NIVEL = 0.012;
    const CAP_MULT_SHINY = 0.00001;   // "0,001%" no painel do simulador
    // "O cálculo aplica pisos e tetos para manter os resultados válidos."
    // O piso foi medido: com shiny e qualidade Lendária, o simulador devolve
    // 0,01% nos níveis 1, 50, 100 e 150 — o fator de nível varia quase três
    // vezes entre eles e o resultado não muda. Isso só acontece com piso.
    const CAP_PISO = 0.01;
    const CAP_TETO = 100;

    // Multiplicador de cada cápsula, do seletor do simulador. As chaves
    // seguem o catálogo BALLS acima; o resto casa pelo nome.
    const CAP_MULT_BOLA = {
        poke: 1, great: 2, super: 3, ultra: 4, pixel: 5,
    };
    const CAP_MULT_NOME = [
        [/master/i, 255], [/dusk|crep/i, 5], [/fast|r[áa]pida/i, 5],
        [/heavy|pesada/i, 5], [/janguru/i, 5], [/lure|isca/i, 5],
        [/magu/i, 5], [/moon|lua/i, 5], [/net|rede/i, 5], [/old|antiga/i, 4],
        [/premier/i, 4], [/quick/i, 2.1], [/repeat/i, 4], [/safari/i, 1],
        [/sora/i, 5], [/tale/i, 5], [/tinker/i, 5], [/yume/i, 5],
    ];

    // Penalidade por qualidade do indivíduo. Note que é OUTRA coisa que o
    // multiplicador de espécie lendária/mítica — a wiki avisa explicitamente
    // que os dois podem incidir na mesma tentativa.
    const CAP_PEN_QUALIDADE = {
        weak: 1, common: 1, uncommon: 0.95, rare: 0.6,
        epic: 0.09, legendary: 0.009, mythical: 0.0009,
    };
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

    // Do pior para o melhor. Declarado junto das outras constantes de raridade
    // porque é usado bem acima do ponto onde estava — com `const` isso lançava
    // ReferenceError, engolido pelo try/catch do hover, e o cartão congelava.
    const TIER_ORDEM = ['weak', 'common', 'uncommon', 'rare', 'epic', 'legendary', 'mythical'];

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
    // Perdidos são muito mais frequentes que capturas (na conta de referência,
    // 5.779 bolas para 55 capturas), então o registro deles precisa de folga.
    // 500 cobre cerca de 50 minutos de caçada no ritmo medido e ocupa ~135 KB.
    const LOST_CAP = 500;
    // Lendário, mítico e shiny não disputam vaga com os comuns: eles têm um
    // teto próprio e só saem quando ESTE encher. Perder o registro de um
    // mítico que escapou porque 500 comuns entraram depois seria absurdo —
    // é justamente o que ninguém quer esquecer. O teto existe mesmo assim
    // porque o armazenamento não é infinito: 1.000 notáveis ocupam ~270 KB e
    // cobrem semanas de caçada no ritmo medido.
    const LOST_KEEP = 1000;
    const perdidoNotavel = e => !!e && (e.shiny || e.q === 'legendary' || e.q === 'mythical');

    // Poda respeitando os dois tetos, sem embaralhar a ordem (a lista vem do
    // mais recente para o mais antigo).
    function podarPerdidos(lista) {
        if (!Array.isArray(lista)) return [];
        let comuns = 0, notaveis = 0;
        const out = [];
        for (const e of lista) {
            if (perdidoNotavel(e)) { if (notaveis++ < LOST_KEEP) out.push(e); }
            else if (comuns++ < LOST_CAP) out.push(e);
        }
        return out;
    }
    const IV_MAX = 186;         // 31 por atributo, seis atributos
    const IV_STAT_MAX = 31;
    // Ordem e rótulos iguais aos do painel de genética do jogo
    // Rótulos curtos na ordem [max_hp, atk, def, spa, spd, spe]
    const BAT_STATS = ['HP', 'ATK', 'DEF', 'ATK SP', 'DEF SP', 'VEL'];
    const BAT_NOMES = ['HP', 'Ataque', 'Defesa', 'Atq. Esp.', 'Def. Esp.', 'Velocidade'];

    // Disposição do card do jogo: duas colunas, HP/ATK/ATK SP à esquerda.
    const BAT_ORDEM = [[0, 2], [1, 4], [3, 5]];

    // Natureza: nome em pt-BR e qual atributo ela favorece e prejudica.
    // Índices seguem BAT_STATS; null = natureza neutra.
    // Faixas de multiplicador por raridade, lidas de /formulas. São duas
    // tabelas distintas: shiny tem só três faixas, e a mais baixa delas fica
    // acima da lendária normal — por isso não dá para derivar uma da outra.
    const faixas = { normal: Object.create(null), shiny: Object.create(null), iv: Object.create(null) };
    // Catálogo de golpes, global por id. O jogo declara category/source_category
    // e power/cooldown_ms, então dá para medir quanto do dano de uma espécie é
    // físico e quanto é especial sem depender de suposição externa.
    const moveIndex = new Map();
    const MOVES_KEY = 'pokepixel_moves_cache_v1';

    function indexFaixas(f) {
        const ler = (lista, destino) => {
            if (!Array.isArray(lista)) return;
            for (const b of lista) {
                const k = b && normalize(b.label);
                if (k) destino[k] = { min: Number(b.min), max: Number(b.max) };
            }
        };
        ler(f && f.normal_quality_bands, faixas.normal);
        ler(f && f.shiny_quality_bands, faixas.shiny);
        // Cada tier sorteia o IV total dentro da própria faixa: uma Épica nunca
        // chega a 186. Sem isso o "perfeito do tier" sairia errado para cima.
        const iv = f && f.quality_iv_bands;
        if (iv && typeof iv === 'object') {
            for (const [k, v] of Object.entries(iv)) {
                const kk = normalize(k);
                if (kk && v) faixas.iv[kk] = { min: Number(v.min) || 0, max: Number(v.max) || 0 };
            }
        }
    }

    const faixaDe = (rarity, shiny) =>
        (shiny ? faixas.shiny[rarity] : faixas.normal[rarity]) || null;

    // Bônus de gênero. O caso da fêmea está confirmado no card do jogo;
    // o do macho segue o comportamento relatado pelos jogadores.
    const BONUS_GENERO = {
        female: '<span class="pp-rt-up">▲</span> HP +10%',
        male: '<span class="pp-rt-up">▲</span> Ataque +10% · <span class="pp-rt-up">▲</span> Atq. Esp. +10%',
    };

    const NATUREZAS = {
        hardy: ['Destemida', null, null],       docile: ['Dócil', null, null],
        serious: ['Séria', null, null],         bashful: ['Envergonhada', null, null],
        quirky: ['Peculiar', null, null],
        lonely: ['Solitária', 1, 2],            brave: ['Valente', 1, 5],
        adamant: ['Rígida', 1, 3],              naughty: ['Teimosa', 1, 4],
        bold: ['Ousada', 2, 1],                 relaxed: ['Relaxada', 2, 5],
        impish: ['Travessa', 2, 3],             lax: ['Descuidada', 2, 4],
        timid: ['Tímida', 5, 1],                hasty: ['Apressada', 5, 2],
        jolly: ['Alegre', 5, 3],                naive: ['Ingênua', 5, 4],
        modest: ['Modesta', 3, 1],              mild: ['Suave', 3, 2],
        quiet: ['Quieta', 3, 5],                rash: ['Impulsiva', 3, 4],
        calm: ['Calma', 4, 1],                  gentle: ['Gentil', 4, 2],
        sassy: ['Atrevida', 4, 5],              careful: ['Cuidadosa', 4, 3],
    };
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
    // Global, sem accountId: base stats do Machamp são os mesmos nas duas contas.
    const SPECIES_KEY = 'pokepixel_species_cache_v1';

    const POS_KEY = 'pokepixel_rarity_tracker_fab';   // posição do botão é global
    const emptyTally = () => RARITY_KEYS.reduce((acc, k) => (acc[k] = 0, acc), {});

    const defaultState = () => ({
        attempts: emptyTally(),     // capture.failed + capture.success
        captures: emptyTally(),     // capture.success
        balls: Object.create(null), // { "Ultra Bola": { attempts, captures } }
        log: [],                    // últimas capturas, da mais recente para a mais antiga
        perdidos: [],               // bola gasta que não capturou, da mais recente para a mais antiga
        hunts: Object.create(null), // chave da hunt -> contadores próprios
        shinyEncounters: 0,
        shinyCaptures: 0,
        // Spawns shiny já contados, gravados. O dedupe de combate vive só em
        // memória: sem esta lista, recarregar a página com um shiny na tela
        // contava o mesmo encontro de novo, e o número ficava para sempre
        // acima do analisador do jogo.
        shinySeen: [],
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
        limpo.shinySeen = Array.isArray(value.shinySeen)
            ? value.shinySeen.filter(k => typeof k === 'string' && k.length <= 100).slice(-SHINY_SEEN_CAP)
            : [];

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
        // Capturas e perdidos guardam o mesmo retrato de criatura; só o campo
        // final difere (destino da captura x nível do selvagem que escapou).
        const limparEntrada = e => ({
            sp: typeof e.sp === 'string' ? e.sp.slice(0, 40) : '',
            nome: typeof e.nome === 'string' ? e.nome.slice(0, 40) : '?',
            q: RARITY_KEYS.includes(e.q) ? e.q : 'weak',
            lvl: safeCount(e.lvl),
            lvlSel: safeCount(e.lvlSel),
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
        });
        const limparLista = (arr, teto) => Array.isArray(arr)
            ? arr.filter(e => e && typeof e === 'object').slice(0, teto).map(limparEntrada)
            : [];
        limpo.log = limparLista(value.log, LOG_CAP);
        // Podado DEPOIS de limpar: a regra dos notáveis depende de campos que
        // só existem na entrada sanitizada. Cortar por slice aqui apagaria
        // lendários guardados só porque vieram depois de 500 comuns.
        limpo.perdidos = podarPerdidos(
            (Array.isArray(value.perdidos) ? value.perdidos : [])
                .filter(e => e && typeof e === 'object')
                .slice(0, LOST_CAP + LOST_KEEP)
                .map(limparEntrada));
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
                anunciarConta();
            }
            return;
        }
        accountId = id;
        state = loadState(id);
        if (name) state.accountName = name;
        lastSeq = 0;
        seenCombat.clear();
        render();
        anunciarConta();
    }

    // Qual conta está nesta aba. O companheiro do Discord usa isto para saber
    // a quem pertence a aba ANTES da primeira captura — sem isso, configurar
    // um webhook por conta só seria possível depois de capturar algo nela.
    // Evento local, como o de captura: nada sai do navegador.
    const EVENTO_CONTA = 'pokepixel-raridades:conta';
    const EVENTO_QUEM = 'pokepixel-raridades:quem';
    function anunciarConta() {
        if (!state || !state.accountName) return;
        try {
            W.dispatchEvent(new W.CustomEvent(EVENTO_CONTA, {
                detail: { versao: 1, conta: state.accountName },
            }));
        } catch (e) { /* companheiro é opcional */ }
    }

    // Anunciar só uma vez não bastava: este arquivo roda em document-start e
    // a conta é identificada quando o WebSocket conecta, o que costuma ser
    // ANTES de o companheiro (document-idle) estar escutando. O anúncio caía
    // no vazio e a aba ficava sem dono — de forma intermitente, porque
    // depende de qual dos dois chega primeiro. Agora quem pergunta é o
    // companheiro, quando ele está pronto, e aqui só se responde.
    try {
        W.addEventListener(EVENTO_QUEM, anunciarConta);
    } catch (e) { /* companheiro é opcional */ }

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
     * ANALISADOR NAS TELAS DO JOGO
     *
     * Inventário, market e chat. Em todos, o dado já chega ao navegador
     * sozinho — só é lido, nunca pedido. O cartão é posicionado AO LADO
     * do card e também ao lado do tooltip que o próprio jogo abre, para
     * nunca cobrir o que o jogador foi olhar.
     * ------------------------------------------------------------- */
    const criaturas = new Map();   // id da criatura   -> criatura (/creatures)
    const anuncios = new Map();    // id do anúncio    -> criatura (/market/listings)
    const chatLinks = new Map();   // id da mensagem   -> [criaturas] (chat.message)
    // Teto por mapa. Era 400 para todos: o mercado estourava depois de ~30
    // páginas e descartava as mais antigas, então as primeiras páginas paravam
    // de mostrar análise enquanto as recém-abertas funcionavam.
    const CAP = { criaturas: 1200, anuncios: 6000, chat: 400 };

    // Casar pelo atributo, não pela tag/classe: se o jogo mudar o elemento que
    // carrega o id, o cartão continua funcionando.
    const SEL_INV = '[data-creature-id]';
    const SEL_MKT = '[data-listing-id]';
    // Teto de tamanho para considerar algo "o Pokémon apontado". Precisa
    // acomodar tanto um slot de 56px quanto o card largo do Pokémon ativo.
    const LARG_ANCORA = 480;
    const SEL_TIME = '.pokeidle-team-card, .pokeidle-team-hud__active, .pokeidle-team-hud__list > *';
    // Telas confirmadas pelo raio-X onde os slots não carregam id.
    // Grades misturam Pokémon, itens e slots vazios: ali o badge "Nv. N" é o
    // que distingue. O cassino mostra um Pokémon só, sem badge — exigir nível
    // lá derrubava o analisador.
    const SEL_GRADES = '.pokecentro-slot-grid, .pokecentro-vault, .storage-window,'
        + ' .inventory-slot-grid, .pokeidle-team-hud';
    const SEL_TELAS_EXTRAS = '.pokecentro-slot-grid, .pokecentro-vault, .storage-window,'
        + ' .npc-casino-reveal-card, .pokeidle-team-hud, .inventory-slot-grid';
    let equipe = [];
    const SEL_CHAT = '.pokeidle-persistent-chat__item-link';
    const SEL_LINHA = '.pokeidle-persistent-chat__line[data-message-key]';

    function guardar(mapa, chave, valor, teto) {
        if (!chave) return;
        const lim = teto || 1000;
        if (mapa.size >= lim) mapa.delete(mapa.keys().next().value);
        mapa.set(String(chave), valor);
    }

    // Converte qualquer retrato de criatura do jogo no formato que o
    // analisador já usa para as capturas do log.
    function deCriatura(c) {
        if (!c || typeof c !== 'object') return null;
        const ivs = c.ivs;
        if (!ivs || typeof ivs !== 'object') return null;
        const q = normalize(c.quality || c.rarity);
        const mult = Number(c.quality_multiplier);
        const sp = c.species_id || c.source_species_id;
        if (!q || !mult || !sp) return null;
        return {
            sp: String(sp), q, mult, shiny: !!c.is_shiny,
            nat: c.nature, gen: c.gender,
            det: ORDEM.map(k => Number(ivs[k]) || 0),
            nome: c.species_name || c.name || null,
            lvl: Number(c.level) || 0,
        };
    }

    function indexCreatures(body) {
        const lista = (body && body.data) || body;
        if (!Array.isArray(lista)) return;
        for (const c of lista) if (c && c.id) guardar(criaturas, c.id, c, CAP.criaturas);
    }

    function indexChatHistory(body) {
        const lista = (body && body.data) || (body && body.messages) || body;
        if (!Array.isArray(lista)) return;
        for (const m of lista) {
            if (m && m.id && Array.isArray(m.item_links)) {
                guardar(chatLinks, m.id, m.item_links.filter(x => x && x.ivs), CAP.chat);
            }
        }
    }

    // Colhe criatura de QUALQUER resposta: /creatures, /state/resync,
    // /casino/..., /market/listings, /team, individuais. Assim Poké Centro,
    // Cassino e telas futuras funcionam sem eu ter que descobrir o endpoint
    // de cada uma.
    function colher(v, prof) {
        if (!v || typeof v !== 'object' || prof > 6) return;
        if (Array.isArray(v)) {
            const n = Math.min(v.length, 500);
            for (let i = 0; i < n; i++) colher(v[i], prof + 1);
            return;
        }
        if (v.id && v.ivs && typeof v.ivs === 'object' && Number(v.quality_multiplier)) {
            guardar(criaturas, v.id, v, CAP.criaturas);
        }
        if (Array.isArray(v.team) && v.team.some(x => x && x.ivs)) {
            equipe = v.team.filter(x => x && x.ivs);
        }
        for (const k in v) {
            const x = v[k];
            if (x && typeof x === 'object') colher(x, prof + 1);
        }
    }

    function indexTeam(body) {
        const l = (body && body.data) || (body && body.creatures) || (body && body.members) || body;
        if (!Array.isArray(l)) return;
        equipe = l.filter(c => c && c.ivs);
        for (const c of equipe) if (c.id) guardar(criaturas, c.id, c, CAP.criaturas);
    }

    function indexListings(body) {
        const lista = (body && body.data) || body;
        if (!Array.isArray(lista)) return;
        for (const l of lista) {
            if (l && l.id && l.creature) guardar(anuncios, l.id, l.creature, CAP.anuncios);
        }
    }

    // Qual criatura está sob o elemento apontado, nas três telas.
    // Último recurso: procura, em qualquer atributo do elemento e dos
    // ancestrais, um valor que seja id de criatura ou de anúncio já conhecido.
    // Poké Centro e Cassino podem guardar o id sob outro nome de atributo.
    function porQualquerAtributo(alvo) {
        let cur = alvo, n = 0;
        while (cur && cur.attributes && n++ < 10) {
            for (const a of cur.attributes) {
                const v = a.value;
                if (!v || v.length < 3 || v.length > 64) continue;
                if (criaturas.has(v)) return { c: criaturas.get(v), el: cur, tipo: 'attr' };
                if (anuncios.has(v)) return { c: anuncios.get(v), el: cur, tipo: 'attr' };
            }
            cur = cur.parentElement;
        }
        return null;
    }

    // Quando o slot não tem id nenhum (Poké Centro, Cassino, HUD da equipe),
    // usa o cartão que o PRÓPRIO JOGO abriu como fonte: ele mostra nível,
    // multiplicador e IV total, e essa trinca identifica a criatura no mapa.
    // Assim funciona em qualquer tela, inclusive nas que o jogo criar depois.
    // O multiplicador nunca tem separador de milhar (vai de 0,90 a 2,60), mas
    // o separador DECIMAL muda com o idioma do jogo: "×1,74" em português e
    // "×1.74" em espanhol. A versão antiga apagava todos os pontos, então o
    // cartão espanhol virava ×174 — fora de qualquer faixa — e o analisador
    // sumia calado em toda tela sem identificador.
    const NUM = t => Number(String(t).replace(',', '.'));
    // Motivo em constante, não em texto solto: ele é comparado em mostrarJogo()
    // para decidir se vale mostrar o diagnóstico, e duas cópias do mesmo texto
    // divergiriam em silêncio na primeira vez que uma fosse reescrita.
    const SEM_CARTA = 'o jogo não abriu o cartão de detalhes';
    function pelaCartaDoJogo() {
        // Pode haver mais de um elemento com essa classe (resíduo do cartão
        // anterior). Pegar o primeiro lia dados velhos, então percorre todos e
        // usa o primeiro VISÍVEL cujo conteúdo realmente se lê.
        let cards = [];
        motivoCarta = SEM_CARTA;
        try { cards = Array.prototype.slice.call(document.querySelectorAll(SEL_CARD_JOGO)); }
        catch (e) { return null; }
        for (const card of cards.reverse()) {
            let cs; try { cs = W_getCS(card); } catch (e) { continue; }
            if (cs && (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0)) continue;
            const achou = lerCartaDoJogo(card);
            if (achou) return achou;
        }
        return null;
    }

    /* Lê o cartão de detalhes do próprio jogo e MONTA a criatura a partir dele.
     *
     * O cartão mostra tudo que a análise precisa: nível, multiplicador, IV
     * total e o IV de cada atributo individualmente (o "20/31" ao lado de cada
     * valor). Montar dali, em vez de procurar a criatura nos dados do jogador,
     * é o que faz a negociação entre jogadores funcionar — o Pokémon do outro
     * nunca passou pela sua conta.
     *
     * O jogo tem interface em português e em inglês, então os dois conjuntos
     * de rótulos são aceitos.
     */
    /* Os IVs por atributo vêm no formato "<rótulo><valor> · <iv>/31", mas o
     * textContent cola tudo — "ATRIBUTOS DE BATALHAHP4.443·27/31DEF884·31/31".
     * Depender do rótulo isolado (\bHP\b) falha, porque não há fronteira de
     * palavra nem antes nem depois dele.
     *
     * Então a âncora é o VALOR, que é inconfundível: "· N/31". Para cada
     * ocorrência, o rótulo é o texto imediatamente anterior, e basta olhar
     * como ele TERMINA. Funciona com ou sem espaços, em português e inglês. */
    // Rótulo guloso e com espaço: "DEF SP" precisa ser capturado inteiro, e a
    // seta de natureza pode aparecer entre o rótulo e o valor.
    const RE_LINHA_IV = /([A-Za-zÀ-ÿ. ]{2,16})\s*[▲▼]?\s*[\d.,]+\s*[·|]\s*(\d+)\s*\/\s*31/g;

    // A ordem importa: os compostos são testados antes dos simples, senão
    // "SP.DEF" cairia em "DEF" e "SPD" (velocidade em inglês) em "SP".
    // Sufixos de rótulo, sem acento e sem pontuação. Cobrem português, inglês
    // e espanhol: o cartão espanhol escreve "AT SP" (não "ATK SP"), e sem
    // 'ATSP' o Atq. Especial não era lido — a soma dos IVs não fechava e o
    // cartão inteiro era descartado.
    const ROTULOS_IV = [
        ['spa', ['ATKSP', 'SPATK', 'ATQESP', 'SPATQ', 'ATSP', 'ATAQUEESP']],
        ['spd', ['DEFSP', 'SPDEF', 'DEFESP', 'DEFENSAESP']],
        ['spe', ['VELOCIDADE', 'VELOCIDAD', 'VEL', 'SPEED', 'SPD']],
        ['atk', ['ATAQUE', 'ATK', 'ATQ', 'AT']],
        ['def', ['DEFESA', 'DEFENSA', 'DEF']],
        ['hp',  ['HP', 'PS']],
    ];

    function ivsDoTexto(txt) {
        const out = {};
        RE_LINHA_IV.lastIndex = 0;
        let m;
        while ((m = RE_LINHA_IV.exec(txt))) {
            const rot = m[1].toUpperCase().replace(/[^A-Z]/g, '');
            for (const [chave, sufixos] of ROTULOS_IV) {
                if (out[chave] !== undefined) continue;
                if (sufixos.some(sf => rot.endsWith(sf))) { out[chave] = Number(m[2]); break; }
            }
        }
        return out;
    }

    // Descobre o tier pela faixa em que o multiplicador cai, em vez de tentar
    // ler o rótulo — que muda de idioma.
    function tierPeloMult(mult, shiny) {
        for (const t of TIER_ORDEM) {
            const b = faixaDe(t, shiny);
            if (b && mult >= b.min - 1e-9 && mult <= b.max + 1e-9) return t;
        }
        return null;
    }

    // Casa o título do cartão com uma espécie conhecida, por nome ou por id.
    function especiePeloTitulo(cabeca) {
        const t = cabeca.toLowerCase();
        let achado = null, tam = 0;
        for (const [id, sp] of speciesIndex) {
            const nome = String((sp && sp.name) || '').toLowerCase();
            for (const cand of [nome, String(id).toLowerCase()]) {
                if (cand && cand.length > tam && t.indexOf(cand) >= 0) { achado = id; tam = cand.length; }
            }
        }
        return achado;
    }

    // Motivo da última tentativa de ler o cartão. Aparece no próprio cartão da
    // extensão quando a identificação falha num slot que claramente é Pokémon —
    // sem isso, a falha era silenciosa e só dava para investigar pelo console.
    let motivoCarta = null;

    // O cartão do jogo só mostra o multiplicador com 2 casas ("×1,74"). Um
    // slot COM identificador resolve pelo índice e usa o valor cheio, então o
    // MESMO Pokémon marcava notas diferentes em telas diferentes (44% e 45%
    // no mesmo Charizard) — a faixa de um tier é estreita e 0,002 de
    // multiplicador já vale um ponto percentual. Aqui procuro o exemplar no
    // índice para recuperar o valor exato. Casa por espécie, shiny e os seis
    // IVs, e ainda exige que o valor exato arredonde no que o cartão mostra.
    function exataDoIndice(spId, det, shiny, mu) {
        const casa2 = x => Math.round(x * 100) / 100;
        for (const c of criaturas.values()) {
            if (!c || (c.species_id || c.source_species_id) !== spId) continue;
            if (!!c.is_shiny !== !!shiny) continue;
            const iv = c.ivs;
            if (!iv || typeof iv !== 'object') continue;
            let bate = true;
            for (let i = 0; i < ORDEM.length; i++) {
                if (Number(iv[ORDEM[i]]) !== det[i]) { bate = false; break; }
            }
            if (!bate) continue;
            const exato = Number(c.quality_multiplier);
            if (!Number.isFinite(exato) || casa2(exato) !== casa2(mu)) continue;
            return c;
        }
        return null;
    }

    function lerCartaDoJogo(card) {
        // textContent cola os elementos sem espaço: o que na tela é
        // "HP 4.443 · 27/31" chega como "HP4.443·27/31". Sem separar letra de
        // número, o \b depois do rótulo não encontra fronteira de palavra e
        // TODOS os padrões de atributo falham de uma vez.
        const txt = (card.textContent || '')
            .replace(/([A-Za-zÀ-ÿ])(\d)/g, '$1 $2')
            .replace(/(\d)([A-Za-zÀ-ÿ])/g, '$1 $2')
            .replace(/\s+/g, ' ');
        const mLv = /(?:N[ÍI]VEL|LEVEL)\s+(\d+)/i.exec(txt);
        const mIv = /(?:IV\s*TOTAL|TOTAL\s*IV)\s*(\d+)\s*\/\s*186/i.exec(txt);
        const mMu = /×\s*([\d.,]+)/.exec(txt);
        if (!mLv || !mIv || !mMu) {
            motivoCarta = 'cartão sem ' + [!mLv && 'nível', !mIv && 'IV total', !mMu && 'multiplicador']
                .filter(Boolean).join(', ');
            return null;
        }
        const lv = Number(mLv[1]), ivTot = Number(mIv[1]), mu = NUM(mMu[1]);
        if (!lv || !ivTot || !mu) return null;

        const shiny = /\bSHINY\b/i.test(txt);
        const cabeca = txt.slice(0, 60);
        const spId = especiePeloTitulo(cabeca);
        const q = tierPeloMult(mu, shiny);
        if (!spId || !q) {
            motivoCarta = !spId ? `espécie do título não reconhecida ("${cabeca.slice(0, 24)}")`
                                : `multiplicador ×${mu} fora das faixas conhecidas`;
            return null;
        }

        // IV de cada atributo, direto do cartão. Só vale se os seis forem
        // lidos e a soma bater com o IV total que o próprio cartão informa —
        // é a checagem que garante que não montei um Pokémon errado.
        const lidos = ivsDoTexto(txt);
        const det = [];
        for (const k of ORDEM) {
            if (lidos[k] === undefined) { det.length = 0; break; }
            det.push(lidos[k]);
        }
        if (det.length !== 6) { motivoCarta = `só li ${det.length} dos 6 IVs por atributo`; return null; }
        const soma = det.reduce((a, b) => a + b, 0);
        if (soma !== ivTot) { motivoCarta = `IVs somam ${soma}, cartão diz ${ivTot}`; return null; }
        motivoCarta = null;

        let gen = /♀|F[êe]mea|\bHembra\b|\bFemale\b/i.test(txt) ? 'female'
                : (/♂|\bMacho\b|\bVar[óo]n\b|\bMale\b/i.test(txt) ? 'male' : '');
        // O cartão vem no idioma do jogo: em português mostra "Séria", não
        // "serious". Procurar só pela chave em inglês fazia TODA natureza
        // virar neutra na leitura pelo cartão — invisível enquanto a nota
        // ignorava natureza, visível agora que ela entra no cálculo.
        // Acentos saem dos dois lados: \b é ASCII e não casaria "Ingênua".
        const semAcento = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const txtSa = semAcento(txt);
        let nat = '';
        for (const nome of Object.keys(NATUREZAS)) {
            const rot = semAcento((NATUREZAS[nome] || [])[0] || '');
            const alvos = rot ? [nome, rot] : [nome];
            if (alvos.some(a => new RegExp('\\b' + a + '\\b', 'i').test(txtSa))) { nat = nome; break; }
        }

        // Valor exato quando o mesmo exemplar já está no índice — ver
        // exataDoIndice(). Sem ele fica o arredondado do cartão, que é tudo
        // o que o jogo mostra ali.
        const exemplar = exataDoIndice(spId, det, shiny, mu);
        const mult = exemplar ? Number(exemplar.quality_multiplier) : mu;
        const tier = (exemplar && normalize(exemplar.quality)) || tierPeloMult(mult, shiny) || q;
        if (exemplar) {
            if (exemplar.nature) nat = String(exemplar.nature).toLowerCase();
            if (exemplar.gender) gen = String(exemplar.gender).toLowerCase();
        }

        return {
            // Id sintético: sem ele, a chave de comparação do hover caía no
            // elemento, e o laço de reidentificação nunca trocava o conteúdo —
            // o cartão congelava no primeiro Pokémon da tela. Usa o
            // multiplicador JÁ resolvido: quando o índice chega depois do
            // primeiro hover, a chave muda e o cartão se atualiza sozinho.
            c: { id: `carta:${spId}:${lv}:${mult}:${ivTot}`,
                 species_id: spId, level: lv, quality: tier, quality_multiplier: mult,
                 is_shiny: shiny, nature: nat, gender: gen,
                 ivs: ORDEM.reduce((o, k, i) => (o[k] = det[i], o), {}) },
            el: card, tipo: 'carta', nivel: lv,
        };
    }

    // Slot de Pokémon tem badge de nível ("Nv. 126"). Slot de item mostra só a
    // quantidade, e slot vazio não mostra nada. Para em caixas de tamanho de
    // slot: subindo demais, o "Nv." lido vinha de outro elemento da página.
    function nivelDoSlot(el) {
        let cur = el, n = 0;
        while (cur && cur.tagName && cur !== document.body && n++ < 3) {
            let r = null;
            try { r = cur.getBoundingClientRect(); } catch (e) { r = null; }
            if (r && (r.width > LARG_ANCORA || r.height > LARG_ANCORA)) break;
            const m = /Nv\.?\s*(\d+)/i.exec(cur.textContent || '');
            if (m) return Number(m[1]);
            cur = cur.parentElement;
        }
        return null;
    }

    // Sobe do elemento sob o mouse até uma caixa de tamanho de slot.
    function ancoraCompacta(alvo) {
        let cur = alvo, n = 0;
        while (cur && cur.getBoundingClientRect && n++ < 5) {
            const r = cur.getBoundingClientRect();
            // O teto era 260, calibrado para slots de grade. O card do Pokémon
            // ativo na EQUIPE é um card largo e passava desse limite, então era
            // descartado e o analisador nunca aparecia nele.
            if (r && r.width > 8 && r.width <= LARG_ANCORA && r.height > 8 && r.height <= LARG_ANCORA) return cur;
            cur = cur.parentElement;
        }
        return alvo;
    }

    // Slot de Pokémon: tem badge "Nv. N" OU um sprite de criatura, numa caixa
    // de tamanho de slot. Sem isso, passar o mouse em qualquer canto da tela
    // acionaria a identificação pelo cartão.
    function pareceSlotDePokemon(alvo) {
        let el = alvo, n = 0;
        while (el && el.tagName && el !== document.body && n++ < 4) {
            let r = null;
            try { r = el.getBoundingClientRect(); } catch (e) { r = null; }
            if (r && (r.width > LARG_ANCORA || r.height > LARG_ANCORA)) return false;
            if (/Nv\.?\s*\d+/i.test(el.textContent || '')) return true;
            try {
                if (el.querySelector && el.querySelector('img[src*="creature"], img[src*="sprite"]')) return true;
            } catch (e) { /* seletor inválido em SVG */ }
            el = el.parentElement;
        }
        return false;
    }

    function criaturaDoAlvo(alvo) {
        let el = alvo.closest && alvo.closest(SEL_INV);
        if (el) {
            const c = criaturas.get(el.dataset.creatureId);
            if (c) return { c, el };
            const porCarta = pelaCartaDoJogo();
            return { c: porCarta && porCarta.c, el };
        }

        el = alvo.closest && alvo.closest(SEL_MKT);
        if (el) {
            const id = el.dataset.listingId;
            let c = anuncios.get(id);
            // Alguns anúncios trazem o id da criatura no próprio elemento.
            if (!c && el.dataset.creatureId) c = criaturas.get(el.dataset.creatureId);
            if (!c) { const pc = pelaCartaDoJogo(); if (pc) c = pc.c; }
            return { c, el, tipo: 'mkt', id };
        }

        el = alvo.closest && alvo.closest(SEL_TIME);
        if (el) {
            if (el.dataset && el.dataset.creatureId) {
                return { c: criaturas.get(el.dataset.creatureId), el, tipo: 'time' };
            }
            // Sem id no slot: casa pela posição entre os cards ocupados, e só
            // quando a contagem bate exatamente. Um palpite mostraria o
            // Pokémon errado, que é pior do que não mostrar nada.
            const cheios = Array.prototype.filter.call(
                document.querySelectorAll(SEL_TIME),
                x => !/--empty/.test(String(x.className || '')));
            const i = cheios.indexOf(el);
            const ok = cheios.length === equipe.length && i >= 0;
            // Se a contagem não bater, NÃO devolve aqui: deixa cair no
            // reconhecimento pela carta do jogo. Antes esse return com c=null
            // barrava o fallback e o HUD da equipe nunca mostrava nada.
            if (ok) return { c: equipe[i], el, tipo: 'time' };
            const porCarta = pelaCartaDoJogo();
            return { c: porCarta && porCarta.c, el, tipo: 'time' };
        }

        el = alvo.closest && alvo.closest(SEL_CHAT);
        if (el) {
            const linha = el.closest(SEL_LINHA);
            const lista = linha && chatLinks.get(linha.dataset.messageKey);
            if (!lista) return { c: null, el };
            // Os botões seguem a ordem de item_links[]; o índice é o vínculo.
            const irmaos = linha.querySelectorAll(SEL_CHAT);
            const i = Array.prototype.indexOf.call(irmaos, el);
            return { c: i >= 0 ? lista[i] : null, el };
        }
        const porAttr = porQualquerAtributo(alvo);
        if (porAttr && porAttr.c) return porAttr;

        // Última linha: se o jogo abriu o cartão dele para algo sob o mouse,
        // identifica por ali. Cobre Poké Centro, Cassino e HUD da equipe.
        // Regra geral, em vez de lista de telas: se o jogo abriu o cartão de
        // detalhes DELE e o elemento sob o mouse parece um slot de Pokémon,
        // tenta identificar pelo cartão. Assim vale para a negociação entre
        // jogadores e para qualquer tela que o jogo adicionar depois, sem eu
        // precisar conhecer o HTML de cada uma. A conferência de nível logo
        // abaixo é o que impede casar com o Pokémon errado.
        // O cartão do jogo como âncora: quando o Pokémon não vive num slot HTML
        // — personagem no mapa, que é canvas do PixiJS, ou o próprio cartão sob
        // o mouse — não há onde ancorar, mas o cartão já descreve a criatura
        // inteira. Ele serve de âncora de si mesmo.
        const semSlot = alvo.closest
            && (alvo.closest(SEL_CARD_JOGO) || alvo.tagName === 'CANVAS');
        if (semSlot) {
            const pc = pelaCartaDoJogo();
            if (pc && pc.c) return { c: pc.c, el: pc.el, tipo: 'carta' };
            return null;
        }

        if (alvo.closest && (alvo.closest(SEL_TELAS_EXTRAS) || pareceSlotDePokemon(alvo))) {
            const pelaCarta = pelaCartaDoJogo();
            // Âncora TEM que ser o slot, não a grade inteira: com o container
            // como âncora, mover o mouse de um Pokémon para outro mantinha o
            // mesmo elemento e o cartão travava no primeiro.
            const caixa = ancoraCompacta(alvo);
            const nvSlot = nivelDoSlot(caixa);
            const emGrade = !!(alvo.closest && alvo.closest(SEL_GRADES));
            // Dentro de grade, sem badge de nível não é Pokémon: item, slot
            // vazio ou área morta. Fora de grade (cassino), não há o que
            // confundir — um Pokémon só na tela.
            if (emGrade && nvSlot === null) return null;
            // Havendo badge, ele tem que bater com o cartão aberto: enquanto o
            // jogo não trocou o cartão, nada é mostrado, em vez do anterior.
            if (pelaCarta && (nvSlot === null || pelaCarta.nivel === nvSlot)) {
                return { c: pelaCarta.c, el: caixa, tipo: 'carta' };
            }
            return { c: null, el: caixa, tipo: 'carta' };
        }
        return porAttr;
    }

    /* Posicionamento: nunca sobrepor o card nem o tooltip do jogo. */
    const W_getCS = el => W.getComputedStyle(el);

    // O cartão de detalhes do jogo, confirmado pelo raio-X: classe estável,
    // position fixed, z-index máximo, pointer-events:none (por isso
    // elementsFromPoint nunca o enxergava) e 380px de largura.
    // Só o cartão de DETALHES. O curinga [class*="creature-card"] que havia
    // aqui também casava com os cards de criatura do inventário, e o parser,
    // lendo o primeiro que encontrava, desistia sem tentar o cartão real.
    const SEL_CARD_JOGO = '.pokemon-tooltip-card, .pokemon-card--hover';
    const cardsDoJogo = () => {
        const out = [];
        const vis = el => {
            let cs; try { cs = W_getCS(el); } catch (e) { return null; }
            if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return null;
            const r = el.getBoundingClientRect();
            if (!r || !isFinite(r.width) || r.width < 200 || r.height < 200) return null;
            return { r, cs };
        };
        const push = r => {
            if (!out.some(o => Math.abs(o.left - r.left) < 3 && Math.abs(o.width - r.width) < 3)) out.push(r);
        };
        try {
            for (const el of document.querySelectorAll(SEL_CARD_JOGO)) {
                const v = vis(el); if (v) push(v.r);
            }
        } catch (e) { /* segue para o reconhecimento geométrico */ }
        // Rede de segurança: painel flutuante estreito e alto, com z-index
        // altíssimo, é o cartão de detalhes — mesmo que a classe mude.
        if (!out.length) {
            let n = 0;
            const fila = document.body ? [document.body] : [];
            while (fila.length && n < 6000) {
                const el = fila.pop();
                const f = el.children;
                for (let i = 0; i < f.length && n < 6000; i++) { fila.push(f[i]); n++; }
                if (el === document.body) continue;
                if (el.id && el.id.indexOf('pp-rt') === 0) continue;
                const v = vis(el); if (!v) continue;
                const z = Number(v.cs.zIndex);
                if (v.cs.position !== 'fixed' || !(z > 100000)) continue;
                if (v.r.width > 520 || v.r.height < 300) continue;
                push(v.r);
            }
        }
        return out;
    };

    function flutuantes() {
        const out = [];
        const W = window.innerWidth, H = window.innerHeight;
        const olhar = el => {
            if (!el || el.id === 'pp-rt-gtip' || el.id === 'pp-rt-overlay' || el.id === 'pp-rt-fab') return;
            // Elementos da página: medir com o window dela, não o do sandbox.
            // ATENÇÃO: aqui W é o número innerWidth (sombreado logo acima), não
            // o unsafeWindow. Usar W.getComputedStyle lançava em todo elemento
            // e a função devolvia lista vazia — nenhum painel do jogo virava
            // obstáculo, e o cartão era posto em cima deles.
            let cs; try { cs = W_getCS(el); } catch (e) { return; }
            if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return;
            // Painel flutuante: posicionado, OU com z-index próprio, OU com
            // fundo opaco sobre o mapa. Exigir só fixed/absolute deixava
            // passar painéis montados com sticky/transform.
            const posicionado = cs.position === 'fixed' || cs.position === 'absolute'
                || cs.position === 'sticky';
            const empilhado = cs.zIndex && cs.zIndex !== 'auto' && Number(cs.zIndex) > 0;
            if (!posicionado && !empilhado) return;
            const r = el.getBoundingClientRect();
            // Rect inválido (elemento fora de layout) envenenaria os mínimos e
            // máximos com NaN e jogaria o cartão para um canto qualquer.
            if (!r || !isFinite(r.left) || !isFinite(r.top)
                || !isFinite(r.width) || !isFinite(r.height)) return;
            // Painéis, não ícones. E ignora overlays de tela cheia, que
            // bloqueariam qualquer posição.
            if (r.width < 90 || r.height < 70) return;
            if (r.width * r.height > W * H * 0.82) return;
            if (r.right < 0 || r.left > W || r.bottom < 0 || r.top > H) return;
            out.push(r);
        };
        const body = document.body;
        if (!body) return out;
        // Varredura da árvore inteira com orçamento. Dois níveis a partir do
        // body não alcançavam os painéis do jogo, e elementsFromPoint IGNORA
        // elementos com pointer-events:none — que é o que tooltip de jogo
        // costuma usar. Só a varredura direta enxerga os dois casos.
        let n = 0;
        const fila = [body];
        while (fila.length && n < 8000) {
            const el = fila.pop();
            if (el !== body) {
                if (el.id === 'pp-rt-gtip' || el.id === 'pp-rt-overlay' || el.id === 'pp-rt-fab') continue;
                const antes = out.length;
                olhar(el);
                // Achou painel: não precisa descer dentro dele.
                if (out.length > antes) continue;
            }
            const filhos = el.children;
            for (let i = 0; i < filhos.length && n < 8000; i++) { fila.push(filhos[i]); n++; }
        }
        return out;
    }

    const cruza = (a, b) => a.left < b.right && a.right > b.left
                          && a.top < b.bottom && a.bottom > b.top;

    // flutuantes() varre só os filhos do body; o painel do jogo fica bem mais
    // fundo na árvore e escapava, então o cartão era posto em cima dele.
    // elementsFromPoint devolve a pilha real sob cada ponto, em qualquer
    // profundidade — é o que garante que o painel aberto vire obstáculo.
    // Sobe até a raiz do painel: o elemento sob o ponto costuma ser um filho
    // fundo, e o que precisa virar obstáculo é a caixa inteira.
    function painelRaiz(el, ancora) {
        // Sobe escolhendo o ancestral de MAIOR área que ainda seja um painel
        // plausível. Subir cegamente até o topo caía em wrappers de tamanho
        // zero, e aí o painel real era descartado pelo filtro de tamanho.
        const W = window.innerWidth, H = window.innerHeight;
        let melhor = el, area = -1, cur = el, n = 0;
        while (cur && cur !== document.body && n++ < 12) {
            if (ancora && cur.contains && cur.contains(ancora)) break;
            const r = cur.getBoundingClientRect();
            if (r && isFinite(r.width) && r.width >= 60 && r.height >= 40) {
                const a = r.width * r.height;
                if (a <= W * H * 0.9 && a > area) { melhor = cur; area = a; }
            }
            cur = cur.parentElement;
        }
        return melhor;
    }

    function coberturasAntigas(base) {
        const out = [];
        const W = window.innerWidth, H = window.innerHeight;
        const vistos = new Set();
        const xs = [base.left + base.width / 2, base.left + 2, base.right - 2];
        const ys = [base.top + base.height / 2, base.top + 2, base.bottom - 2];
        for (const x of xs) for (const y of ys) {
            if (!isFinite(x) || !isFinite(y) || x < 0 || y < 0 || x > W || y > H) continue;
            let pilha = [];
            try { pilha = document.elementsFromPoint(x, y) || []; } catch (e) { continue; }
            for (const el of pilha) {
                if (!el || !el.tagName || vistos.has(el)) continue;
                vistos.add(el);
                if (el === document.body || el === document.documentElement) continue;
                if (gtip && (el === gtip || gtip.contains(el))) continue;
                if (el.closest && el.closest('#pp-rt-overlay, #pp-rt-fab, #pp-rt-gtip')) continue;
                let cs; try { cs = W_getCS(el); } catch (e) { continue; }
                if (!cs || (cs.position !== 'fixed' && cs.position !== 'absolute')) continue;
                const r = el.getBoundingClientRect();
                if (!r || !isFinite(r.left) || !isFinite(r.width)) continue;
                if (r.width < 90 || r.height < 70) continue;
                if (r.width * r.height > W * H * 0.82) continue;
                out.push(r);
            }
        }
        return out;
    }


    // Varre a FAIXA horizontal onde o cartão pode ser posto e devolve todo
    // painel que estiver ali — independente de position, profundidade ou
    // classe. É isso que garante que ele nunca caia por cima do cartão do jogo.
    function coberturas(base, ancora) {
        const out = [];
        const W = window.innerWidth, H = window.innerHeight;
        const ys = [base.top + base.height / 2, base.top + 3, base.bottom - 3];
        const passo = Math.max(36, Math.floor(W / 28));
        const vistos = new Set();
        for (const y of ys) {
            if (!isFinite(y) || y < 1 || y > H - 1) continue;
            for (let x = 4; x < W; x += passo) {
                let pilha = [];
                try { pilha = document.elementsFromPoint(x, y) || []; } catch (e) { continue; }
                for (const el of pilha) {
                    if (!el || !el.tagName) continue;
                    if (gtip && (el === gtip || gtip.contains(el))) continue;
                    if (el.closest && el.closest('#pp-rt-overlay, #pp-rt-fab, #pp-rt-gtip')) continue;
                    if (el === document.body || el === document.documentElement) break;
                    if (ancora && el.contains && el.contains(ancora)) break;
                    const raiz = painelRaiz(el, ancora);
                    if (vistos.has(raiz)) break;
                    vistos.add(raiz);
                    const r = raiz.getBoundingClientRect();
                    if (!r || !isFinite(r.left) || !isFinite(r.width)) break;
                    if (r.width < 60 || r.height < 40) break;
                    if (r.width * r.height > W * H * 0.9) break;
                    out.push(r);
                    break;      // só o topo da pilha em cada ponto
                }
            }
        }
        return out;
    }

    function posicionar(cartao, ancora) {
        const base = ancora.getBoundingClientRect();
        // NUNCA encolher por scale: reduzia a fonte junto. O ajuste é na
        // largura — o texto reflui e o cartão cresce para baixo.
        cartao.style.transform = 'none';
        const folga = 10;
        const W = window.innerWidth, H = window.innerHeight;
        // Duros: o cartão do jogo. Jamais pode ser coberto — é literalmente o
        // que o jogador foi olhar. Moles: painéis de fundo (mochila, mercado),
        // que podem ser cobertos quando não há alternativa geométrica.
        const duros = cardsDoJogo();
        const moles = flutuantes().concat(coberturas(base, ancora))
            .filter(r => !duros.some(d => Math.abs(d.left - r.left) < 2 && Math.abs(d.width - r.width) < 2));
        const obs = duros.concat(moles);

        // Espaço livre à esquerda e à direita de tudo que está aberto.
        let maisEsq = base.left, maisDir = base.right;
        for (const r of obs) {
            if (r.bottom < 0 || r.top > H) continue;
            maisEsq = Math.min(maisEsq, r.left);
            maisDir = Math.max(maisDir, r.right);
        }
        // Largura medida contra os DUROS: é ao lado deles que o cartão precisa
        // caber. Medir contra tudo dava 300px onde só havia 210 e forçava a
        // sobreposição justamente do cartão do jogo.
        let dEsq = W, dDir = 0;
        for (const r of duros) { dEsq = Math.min(dEsq, r.left); dDir = Math.max(dDir, r.right); }
        const espDuro = duros.length
            ? Math.max(dEsq - folga - 6, W - dDir - folga - 6)
            : Math.max(maisEsq - folga - 6, W - maisDir - folga - 6);
        const esp = espDuro;
        // Não sobrepor vale mais que largura: quando nenhum lado comporta a
        // largura confortável, o cartão estreita até o piso absoluto em vez de
        // ser jogado por cima do painel que o jogador foi olhar.
        // Com cartão do jogo aberto o piso cai: melhor estreito ao lado do que
        // largo por cima. Sem ele, mantém o piso confortável.
        // Padrão: mesma largura do cartão do jogo (380px). Só encolhe quando a
        // margem ao lado dele não comporta — e aí encolhe o mínimo necessário,
        // nunca por scale.
        // Largura padrão: a maior que SEMPRE cabe ao lado do cartão do jogo,
        // esteja ele onde estiver na tela. Com janela de 923px e cartão de
        // 380px, o pior caso (cartão centralizado) deixa 271px de cada lado.
        // Derivar daí dá um valor CONSTANTE para a sessão, em vez de um
        // tamanho diferente a cada hover.
        const largJogo = duros.length ? duros[0].width : 380;
        const sempreCabe = Math.floor((W - largJogo) / 2) - folga - 6;
        const alvoLarg = Math.max(LARG_APERTO, Math.min(LARG_PADRAO, sempreCabe));
        const piso = duros.length ? LARG_APERTO : LARG_PISO;
        const lw = Math.max(piso, Math.min(alvoLarg, esp));
        cartao.style.width = lw + 'px';
        const lh = cartao.offsetHeight;

        // Candidatos: ao lado de cada painel aberto e do próprio card, mais as
        // bordas da janela. Nunca acima nem abaixo — só variações horizontais.
        const xs = [];
        const por = r => { xs.push(r.right + folga, r.left - folga - lw); };
        por(base); obs.forEach(por);
        xs.push(6, W - lw - 6);

        // Só variações que mantêm o cartão AO LADO do card apontado. Empurrar
        // para o topo ou o rodapé da janela deixaria de ser "ao lado", que é a
        // regra: se não couber num lado, vai para o oposto — nunca para cima.
        // Com o cartão do jogo aberto, alinhar pelo topo dele faz os dois
        // parecerem um par. Sem ele, centraliza no card apontado.
        const meio = base.top + base.height / 2;
        // Com o cartão do jogo aberto, UMA opção só: topo alinhado com ele.
        // Deixar alternativas fazia a nota preferir centralizar no card
        // apontado, e o cartão saía numa altura diferente a cada hover.
        const ys = duros.length
            ? [duros[0].top]
            : [meio - lh / 2, base.top, base.bottom - lh];

        let melhor = null, melhorD = Infinity;
        for (const bx of xs) {
            const x = Math.max(6, Math.min(bx, W - lw - 6));
            for (const by of ys) {
                const y = Math.max(6, Math.min(by, H - lh - 6));
                const cand = { left: x, right: x + lw, top: y, bottom: y + lh };
                if (cruza(cand, base)) continue;
                if (obs.some(r => cruza(cand, r))) continue;
                // Entre as posições livres, a mais perto do card apontado.
                const d = Math.abs(x + lw / 2 - (base.left + base.width / 2))
                        + Math.abs(y + lh / 2 - meio) * 0.4;
                if (d < melhorD) { melhorD = d; melhor = { x, y }; }
            }
        }

        // Sem nenhuma posição livre: encosta na margem com mais espaço, que
        // ainda é ao lado — nunca em cima do que o jogador foi olhar.
        // Segunda passada: se nada coube sem tocar o card apontado, aceita
        // encostar NELE, mas continua sem cobrir os painéis. Tapar um slot de
        // 60px é bem menos grave que tapar o cartão de detalhes do jogo.
        if (!melhor) {
            for (const bx of xs) {
                const x = Math.max(6, Math.min(bx, W - lw - 6));
                for (const by of ys) {
                    const y = Math.max(6, Math.min(by, H - lh - 6));
                    const cand = { left: x, right: x + lw, top: y, bottom: y + lh };
                    // Segunda passada: só afrouxa quando há cartão do jogo
                    // aberto. Sem ele, continua evitando todos os painéis.
                    const evitar = duros.length ? duros : obs;
                    if (evitar.some(r => cruza(cand, r))) continue;
                    const d = Math.abs(x + lw / 2 - (base.left + base.width / 2));
                    if (d < melhorD) { melhorD = d; melhor = { x, y }; }
                }
            }
        }

        if (!melhor) {
            // Nenhuma posição livre com a largura atual: escolhe a margem com
            // mais espaço e ESTREITA o cartão até caber nela. Ficar estreito é
            // aceitável; cobrir o painel que o jogador foi olhar, não.
            // Espaço medido só contra os painéis: incluir o card apontado
            // estreitava a margem à toa e empurrava o cartão para cima deles.
            const ref = duros.length ? duros : obs;
            let pEsq = W, pDir = 0;
            for (const r of ref) { pEsq = Math.min(pEsq, r.left); pDir = Math.max(pDir, r.right); }
            if (!ref.length) { pEsq = base.left; pDir = base.right; }
            const espDir = W - pDir - folga - 6;
            const espEsq = pEsq - folga - 6;
            const dir = espDir >= espEsq;
            const maisDirF = pDir, maisEsqF = pEsq;
            const lw2 = Math.max(duros.length ? 150 : LARG_EMERG,
                                 Math.min(lw, Math.max(espDir, espEsq)));
            cartao.style.width = lw2 + 'px';
            const lh2 = cartao.offsetHeight;
            melhor = {
                x: dir ? Math.max(6, Math.min(maisDirF + folga, W - lw2 - 6))
                       : Math.max(6, Math.min(maisEsqF - folga - lw2, W - lw2 - 6)),
                y: Math.max(6, Math.min(meio - lh2 / 2, H - lh2 - 6)),
            };
        }

        cartao.style.left = Math.round(melhor.x) + 'px';
        cartao.style.top = Math.round(melhor.y) + 'px';
    }

    const LARG_IDEAL = 470;   // bem maior que o tooltip do painel
    const LARG_MIN = 330;     // largura confortável para as duas pizzas grandes
    const LARG_PISO = 300;    // piso normal: só usado para não sobrepor
    const LARG_EMERG = 248;   // último recurso; abaixo disso as pizzas empilham
    const LARG_APERTO = 178;  // com o cartão do jogo aberto: estreito, nunca em cima
    const LARG_PADRAO = 380;  // igual ao cartão do jogo: o analisador vira um par dele
    let gChave = null;
    let gtip = null, gTimer = 0, gAncora = null;
    function cartaoJogo() {
        if (gtip && gtip.isConnected) return gtip;
        gtip = document.createElement('div');
        gtip.id = 'pp-rt-gtip';

        document.body.appendChild(gtip);
        return gtip;
    }

    let gSaida = 0;
    function esconderJogo() {
        clearTimeout(gTimer); clearTimeout(gSaida); gAncora = null; gChave = null;
        if (gtip) gtip.classList.remove('pp-on');
    }
    // O tooltip do jogo abre debaixo do cursor e dispara mouseout na âncora.
    // Sem o atraso, o cartão sumia no instante em que o do jogo aparecia.
    function agendarEsconder() {
        clearTimeout(gSaida);
        gSaida = setTimeout(esconderJogo, 400);
    }


    function mostrarJogo(alvo) {
        const achado = criaturaDoAlvo(alvo);
        if (!achado) { esconderJogo(); return; }
        clearTimeout(gSaida);
        const chave = (achado.c && (achado.c.id || achado.c.creature_id)) || null;
        // Comparar só o elemento não bastava: no Poké Centro o mesmo slot pode
        // exibir criaturas diferentes conforme o mouse anda pela grade.
        if (achado.el === gAncora && chave === gChave) return;
        gAncora = achado.el; gChave = chave;
        // Nessas telas o cartão do jogo é a única fonte: sem criatura resolvida,
        // some em vez de exibir aviso sobre um slot que talvez nem seja Pokémon.
        if (!achado.c && (achado.tipo === 'carta' || achado.tipo === 'time')) {
            // Se o slot tem badge de nível, é Pokémon com certeza: mostrar o
            // motivo ajuda mais que sumir. Sem badge, some (pode ser item).
            // Estrito: o badge tem que estar no PRÓPRIO elemento apontado, não
            // num vizinho da mesma grade. E só quando a leitura do cartão
            // falhou — divergência de nível continua sumindo em silêncio.
            //
            // Cartão NENHUM aberto também some. O mapa de caçadas rotula cada
            // área com "Espécie Nv. N", o que casa com o badge, mas ali não há
            // criatura sua nem cartão de detalhes — o diagnóstico aparecia em
            // dezenas de rótulos ao mesmo tempo, sem nada a diagnosticar. O
            // aviso continua valendo no caso que interessa: o jogo ABRIU um
            // cartão e a extensão não conseguiu lê-lo.
            const temBadge = /Nv\.?\s*\d+/i.test((achado.el && achado.el.textContent) || '');
            if (!temBadge || !motivoCarta || motivoCarta === SEM_CARTA) { esconderJogo(); return; }
            const c0 = cartaoJogo();
            c0.innerHTML = `<div class="pp-rt-tip-sec pp-rt-an">`
                + `<p class="pp-rt-tip-head">Análise</p>`
                + `<ul class="pp-rt-why"><li>Indisponível: ${escapeHtml(motivoCarta || 'não consegui identificar')}.</li></ul>`
                + `</div>`;
            c0.classList.add('pp-on');
            posicionar(c0, achado.el);
            return;
        }
        const e = deCriatura(achado.c);
        const html = analiseHtml(e, achado);
        if (!html) { esconderJogo(); return; }

        const c = cartaoJogo();
        c.innerHTML = html;
        c.classList.add('pp-on');
        // Duas medições: o tooltip do jogo costuma aparecer depois do mouseover,
        // então reposiciona uma vez com ele já na tela.
        posicionar(c, achado.el);
        // O painel do jogo às vezes abre bem depois do mouseover; sem remedir,
        // o cartão fica onde havia espaço antes de ele existir.
        clearTimeout(gTimer);
        let n = 0;
        const remedir = () => {
            if (gAncora !== achado.el) return;
            // O cartão do jogo só troca de conteúdo alguns quadros depois do
            // mouseover. Sem reidentificar, nas telas que dependem dele o
            // analisador ficava congelado no Pokémon anterior.
            if (achado.tipo === 'carta' || achado.tipo === 'time') {
                try {
                    const novo = pelaCartaDoJogo();
                    const nvAlvo = nivelDoSlot(achado.el);
                    const idNovo = novo && novo.c && novo.c.id
                        && (nvAlvo === null || novo.nivel === nvAlvo) && novo.c.id;
                    if (idNovo && idNovo !== gChave) {
                        gChave = idNovo;
                        const h2 = analiseHtml(deCriatura(novo.c), achado);
                        if (h2) c.innerHTML = h2;
                    }
                } catch (err) { /* segue com o que já tem */ }
            }
            posicionar(c, achado.el);
            if (++n < 5) gTimer = setTimeout(remedir, 140 + n * 120);
        };
        gTimer = setTimeout(remedir, 160);
    }

    function ligarTelasDoJogo() {
        if (!document.body) return;
        document.addEventListener('mouseover', ev => {
            try { mostrarJogo(ev.target); } catch (e) { /* nunca quebra a página */ }
        }, true);
        document.addEventListener('mouseout', ev => {
            try {
                const para = ev.relatedTarget;
                if (gAncora && para && gAncora.contains(para)) return;
                if (para && para.closest && criaturaDoAlvo(para)) return;
                agendarEsconder();
            } catch (e) { agendarEsconder(); }
        }, true);
        window.addEventListener('scroll', esconderJogo, true);
    }



    // Sem expor nada no window da página: os dois comandos aparecem no menu do
    // ícone do Tampermonkey, e só rodam quando clicados.
    function dumpResumo(p) {
        return '[Raridades] slots não resolvidos: ' + (p.slotMiss || []).length
            + ' | mapas: ' + criaturas.size + ' criaturas, ' + anuncios.size
            + ' anúncios, ' + chatLinks.size + ' msgs de chat | faixas de IV: '
            + Object.keys(faixas.iv).length + ' | espécies com base: '
            + Object.keys(p.bases).length + '\n'
            + (p.telas || []).length + ' tela(s) capturada(s), '
            + (p.chat || []).length + ' evento(s) de chat, '
            + (p.reqs || []).length + ' requisição(ões), '
            + (p.enemies || []).length + ' inimigo(s) de nível alto, '
            + (p.creatures ? 'coleção: sim' : 'coleção: NÃO') + ', '
            + p.amostras.length + ' captura(s), '
            + Object.keys(p.bases).length + ' espécies com base stats, formulas: '
            + (p.formulas ? 'sim' : 'NÃO');
    }




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
    // Shiny é raro: 400 chaves cobrem muito tempo de jogo e custam pouco.
    const SHINY_SEEN_CAP = 400;

    // id da espécie -> { nome, sprite normal, sprite shiny }. Vem do endpoint
    // `species`, que traz a URL exata de cada sprite.
    const speciesIndex = new Map();

    // A hunt é o mapa onde se está caçando: cada mapa tem uma espécie só,
    // então isso muda quando se troca de mapa, não a cada combate.
    let hunt = null;
    let huntKey = null;
    let showShiny = false;

    // Só aceita as seis chaves conhecidas e como número finito, para que um
    // payload estranho não injete campo arbitrário no cache persistido.
    const BASE_KEYS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];
    function lerBase(bs) {
        if (!bs || typeof bs !== 'object') return null;
        const out = Object.create(null);
        let achou = false;
        for (const k of BASE_KEYS) {
            const n = Number(bs[k]);
            if (Number.isFinite(n) && n > 0) { out[k] = n; achou = true; }
        }
        return achou ? out : null;
    }

    function indexSpecies(list) {
        let mudou = false, mudouMove = false;
        for (const sp of list) {
            if (!sp || !sp.id) continue;
            const id = String(sp.id).slice(0, 40);
            const antigo = speciesIndex.get(id) || null;
            const novo = {
                name: sp.name || (antigo && antigo.name) || null,
                sprite: sp.normal_sprite_url || (antigo && antigo.sprite) || null,
                shiny: sp.shiny_sprite_url || (antigo && antigo.shiny) || null,
                base: lerBase(sp.base_stats) || (antigo && antigo.base) || null,
                // Chance de captura que o próprio jogo declara para a espécie,
                // em porcentagem. Já vinha no payload; só não era guardada.
                cap: Number.isFinite(Number(sp.base_capture_chance))
                    ? Number(sp.base_capture_chance)
                    : (antigo && antigo.cap) || null,
            };
            if (Array.isArray(sp.learn_moves) && sp.learn_moves.length) {
                novo.moves = sp.learn_moves.map(m => String(m).slice(0, 40)).slice(0, 24);
            } else if (antigo && antigo.moves) novo.moves = antigo.moves;
            if (Array.isArray(sp.move_catalog)) {
                for (const m of sp.move_catalog) {
                    if (!m || !m.id) continue;
                    const cat = String(m.source_category || m.category || '').toLowerCase();
                    if (cat !== 'physical' && cat !== 'special') continue;
                    moveIndex.set(String(m.id).slice(0, 40), {
                        c: cat === 'physical' ? 'f' : 'e',
                        p: Math.max(0, Number(m.power) || 0),
                        cd: Math.max(1, Number(m.cooldown_ms) || 1),
                    });
                    mudouMove = true;
                }
            }
            speciesIndex.set(id, novo);
            if (!antigo || JSON.stringify(antigo) !== JSON.stringify(novo)) mudou = true;
        }
        if (mudou) saveSpeciesCache();
        if (mudouMove) saveMoveCache();
    }

    function saveMoveCache() {
        try {
            const o = Object.create(null);
            for (const [k, v] of moveIndex) o[k] = v;
            GM_setValue(MOVES_KEY, JSON.stringify(o));
        } catch (e) { /* cache é conveniência */ }
    }
    function loadMoveCache() {
        try {
            const raw = GM_getValue(MOVES_KEY, null);
            if (!raw) return;
            const o = JSON.parse(raw);
            if (!o || typeof o !== 'object') return;
            for (const [k, v] of Object.entries(o)) {
                if (!v || (v.c !== 'f' && v.c !== 'e')) continue;
                moveIndex.set(String(k).slice(0, 40),
                    { c: v.c, p: Math.max(0, Number(v.p) || 0), cd: Math.max(1, Number(v.cd) || 1) });
            }
        } catch (e) { /* cache corrompido */ }
    }

    // O jogo não serve mais catálogo em lista: cada espécie chega sozinha,
    // sob demanda, quando entra numa hunt ou no time. Sem persistir, o índice
    // só teria a espécie da sessão atual e o histórico ficaria sem base stats.
    // A chave é global de propósito: base stats não variam por conta.
    function saveSpeciesCache() {
        try {
            const obj = Object.create(null);
            for (const [id, v] of speciesIndex) obj[id] = v;
            GM_setValue(SPECIES_KEY, JSON.stringify(obj));
        } catch (e) { /* cache é conveniência: falhar aqui não quebra nada */ }
    }

    function loadSpeciesCache() {
        try {
            const raw = GM_getValue(SPECIES_KEY, null);
            if (!raw) return;
            const obj = JSON.parse(raw);
            if (!obj || typeof obj !== 'object') return;
            for (const [id, v] of Object.entries(obj)) {
                if (!v || typeof v !== 'object') continue;
                const lim = s => (typeof s === 'string' ? s.slice(0, 300) : null);
                const url = s => (typeof s === 'string' && /^https?:\/\/|^\//.test(s) ? s.slice(0, 300) : null);
                speciesIndex.set(String(id).slice(0, 40), {
                    name: lim(v.name),
                    sprite: url(v.sprite),
                    shiny: url(v.shiny),
                    base: lerBase(v.base),
                });
            }
        } catch (e) { /* cache corrompido: começa vazio */ }
    }

    loadSpeciesCache();
    loadMoveCache();

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
    // Inimigo do combate corrente, do combat.started. Só memória: o que
    // interessa dele já vai gravado na entrada de perdido.
    let ultimoInimigo = null;

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

        // Retrato completo de quem está na tela AGORA. O capture.failed traz
        // só qualidade, cápsula e IV total — sem isto o registro de perdidos
        // não teria IV por atributo, natureza, gênero nem multiplicador, e o
        // cartão de detalhes ficaria pela metade. Guardado antes do dedupe:
        // um combat.started repetido continua sendo o inimigo corrente.
        ultimoInimigo = enemy;

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
            // Confere contra a lista gravada, não só contra o dedupe em
            // memória: um shiny permanece no mapa entre recarregamentos.
            if (state.shinySeen.indexOf(key) >= 0) return;
            state.shinySeen.push(key);
            if (state.shinySeen.length > SHINY_SEEN_CAP) state.shinySeen.shift();

            state.shinyEncounters++;
            const h = state.hunts[chave];
            if (h) h.shinyEncounters++;
            return true;
        }
    }

    /* Reconciliação com o analisador nativo do jogo.
     *
     * Compara INCREMENTOS, não totais: funciona mesmo que a extensão e o jogo
     * tenham sido zerados em momentos diferentes. Se entre duas leituras o jogo
     * somou mais tentativas que a extensão, a diferença são eventos que o
     * WebSocket não entregou — o que acontece quando o servidor engasga. */
    const recon = { sessao: null, jogoAtt: null, extAtt: null, perdidas: 0 };

    function totalTentativas() {
        if (!state) return 0;
        return RARITY_KEYS.reduce((n, k) => n + (state.attempts[k] || 0), 0);
    }

    function reconciliar(body) {
        try {
            const b = (body && body.data) || body;
            const sum = b && b.summary;
            if (!sum || typeof sum.capture_attempts !== 'number') return;
            const sessao = b.session_id || null;
            const gAtt = sum.capture_attempts;
            const eAtt = totalTentativas();
            if (recon.sessao !== sessao) {          // sessão nova: refaz a base
                recon.sessao = sessao; recon.jogoAtt = gAtt; recon.extAtt = eAtt;
                return;
            }
            if (recon.jogoAtt != null && gAtt >= recon.jogoAtt && eAtt >= recon.extAtt) {
                const dJogo = gAtt - recon.jogoAtt, dExt = eAtt - recon.extAtt;
                if (dJogo > dExt) { recon.perdidas += dJogo - dExt; render(); }
            }
            recon.jogoAtt = gAtt; recon.extAtt = eAtt;
        } catch (e) { /* reconciliação é informativa, nunca crítica */ }
    }

    function onCaptureAttempt(data, succeeded) {
        // A qualidade fica em lugares diferentes: solta no evento de falha,
        // dentro de `creature` no de sucesso.
        const src = succeeded ? (data && data.creature) : data;
        if (!src || !state) return;

        const rarity = markQuality(src.quality);
        if (!rarity) return;



        // A Eevee do cassino chega sem cápsula: sem categoria própria ela caía
        // num balde sem nome. Conta normalmente, mas separada — a taxa de
        // captura dela é 100% e misturá-la distorceria a das bolas de verdade.
        const key = (succeeded && src.captured_zone === 'npc-cassino')
            ? 'cassino'
            : ballKey(data.capsule_item_id, data.capsule_name);
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
                if (state.accountName !== nome) { state.accountName = nome; anunciarConta(); }
            }
            // A estimativa do bônus de treinador sai das capturas: com o
            // cache preso, a primeira leitura (registro vazio, fator 1)
            // valeria para sempre.
            treinadorCache = null;
            anunciarCaptura(state.log[0]);
        } else {
            registrarPerdido(data, rarity, key);
        }
        return true;
    }

    // Aviso local de captura, para um script companheiro OPCIONAL (o de
    // notificação no Discord). É um CustomEvent na própria página: nada sai
    // do navegador, nenhuma requisição é feita, e sem o companheiro instalado
    // o evento simplesmente não tem ouvinte. É o que permite manter este
    // arquivo com zero requisições próprias — a promessa do README continua
    // valendo ao pé da letra, e o teste que a garante continua intacto.
    // O conteúdo é o mesmo retrato que já está no registro de capturas, e
    // veio do jogo: nada aqui é informação nova exposta à página.
    const EVENTO_CAPTURA = 'pokepixel-raridades:captura';
    function anunciarCaptura(entrada) {
        if (!entrada) return;
        try {
            W.dispatchEvent(new W.CustomEvent(EVENTO_CAPTURA, {
                detail: { versao: 1, conta: state.accountName || null, captura: entrada },
            }));
        } catch (e) { /* companheiro é opcional; falhar aqui nunca pode parar a contagem */ }
    }

    // Bola gasta que não capturou. O evento de falha não traz a criatura, só
    // qualidade e cápsula — o retrato vem do combat.started daquele combate,
    // que sempre precede a bola. Se o inimigo retido for de outro combate (a
    // qualidade não bate), grava o que o próprio evento oferece em vez de
    // inventar um Pokémon errado.
    /* ---------------------------------------------------------------
     * PROJEÇÃO PARA O NÍVEL DE CAPTURA
     *
     * O selvagem que escapou vem no nível do mapa; uma captura nasce no
     * nível 1. Mostrar 2.846 ao lado de capturas de 105 não compara nada.
     * Por isso o perdido é projetado para o que ele SERIA se a bola
     * tivesse acertado.
     *
     * A conta é a fórmula do jogo, aplicada no nível 1. Tudo o que ela
     * precisa a extensão já tem: base stats vindos do próprio jogo, IV
     * por atributo, multiplicador, natureza, gênero e shiny.
     *
     * O único dado ausente é o bônus de treinador (+2% a cada 10 níveis),
     * que entra nos SEUS Pokémon e não no selvagem — sem ele o perdido
     * sairia sistematicamente abaixo das capturas. O jogo não expõe esse
     * nível em nada que a extensão leia, mas o multiplicador está
     * embutido em toda captura registrada, e dá para recuperá-lo.
     * ------------------------------------------------------------- */
    const HP_ESCALA = 3;
    const NIVEL_CAPTURA = 1;

    // Atributo antes dos multiplicadores. HP tem fórmula própria.
    function baseCru(chave, base, iv, nivel) {
        const n = 2 * base + iv;
        return chave === 'hp'
            ? Math.trunc((n * nivel / 100 + nivel + 10) * HP_ESCALA)
            : Math.trunc(n * nivel / 100) + 5;
    }

    function fatoresDe(e) {
        const v = NATUREZAS[String(e.nat || '').toLowerCase()];
        const sobe = v && v[1] != null ? ORDEM[v[1]] : null;
        const desce = v && v[2] != null ? ORDEM[v[2]] : null;
        return {
            nat: k => (k === sobe ? 1.1 : k === desce ? 0.9 : 1),
            gen: k => (e.gen === 'male' && (k === 'atk' || k === 'spa') ? 1.1
                     : e.gen === 'female' && k === 'hp' ? 1.1 : 1),
        };
    }

    // Fator comum a TODOS os atributos (qualidade, shiny e o que mais o jogo
    // aplique por igual). Não é calculado: é MEDIDO. Dividindo o atributo que
    // o jogo mandou pelo cru, e tirando natureza e gênero, sobra ele.
    //
    // Medir em vez de calcular foi a virada. A versão anterior reconstruía o
    // valor absoluto a partir do multiplicador exibido e do expoente de
    // qualidade — bastava um deles estar levemente errado, ou o jogo aplicar
    // algum fator que a extensão não conhece, para a projeção inteira ser
    // descartada. Medindo, tudo o que multiplica por igual some da conta,
    // porque aparece dos dois lados da conversão.
    // Devolve { fator } quando dá para confiar, ou { erro } com o motivo em
    // texto. O motivo vai para a tela: sem ele, uma recusa é indistinguível
    // de "não mudou nada", e foi assim que este bug consumiu quatro rodadas.
    //
    // O HP FICA DE FORA DA MEDIÇÃO. Medido no jogo, o selvagem aparece com
    // cerca de 25% mais HP do que a fórmula prevê, enquanto os outros cinco
    // atributos batem na casa do milésimo (1.649 contra 1.315/1.315/1.318/
    // 1.321/1.318 num caso real). Um erro de base stat ou de multiplicador
    // apareceria nos seis; aparecer só no HP é bônus de combate do selvagem,
    // que não existe na criatura capturada. Incluir o HP na medição
    // contaminava o fator e derrubava a projeção inteira.
    // Filtrado DENTRO da função, não numa const no topo: ORDEM é declarada
    // mais adiante no arquivo, e uma const que a lê na carga lança
    // ReferenceError antes de a extensão sequer subir. Já aconteceu neste
    // projeto com TIER_ORDEM.
    function fatorMedido(e, sp, f) {
        const semHp = ORDEM.filter(k => k !== 'hp');
        const amostras = [];
        const faltando = [];
        for (const k of semHp) {
            const i = ORDEM.indexOf(k);
            const b = Number(sp.base[k]);
            const obs = Number(e.bat[i]) || 0;
            if (!(b > 0)) { faltando.push('base ' + k); continue; }
            if (!(obs > 0)) { faltando.push('atributo ' + k); continue; }
            const cru = baseCru(k, b, e.det[i], e.lvl) * f.nat(k) * f.gen(k);
            if (!(cru > 0)) { faltando.push('cru ' + k); continue; }
            amostras.push({ k, v: obs / cru });
        }
        if (faltando.length) return { erro: 'faltou ' + faltando.join(', ') };
        if (!Number.isFinite(Number(sp.base.hp)) || Number(sp.base.hp) <= 0) {
            return { erro: 'faltou base hp' };
        }

        const ord = [...amostras].map(a => a.v).sort((x, y) => x - y);
        const mediana = (ord[1] + ord[2] + ord[3]) / 3;
        if (!(mediana > 0)) return { erro: 'fator medido inválido' };

        // Os cinco TÊM que concordar: o fator é o mesmo para todos eles.
        let pior = 0, piorK = '';
        for (const a of amostras) {
            const d = Math.abs(a.v - mediana) / mediana;
            if (d > pior) { pior = d; piorK = a.k; }
        }
        if (pior > 0.06) {
            return { erro: `fatores não conferem (${amostras.map(a => a.v.toFixed(3)).join('/')}`
                + `; ${piorK} destoa ${(pior * 100).toFixed(0)}%)` };
        }
        return { fator: mediana };
    }

    // Bônus de treinador (+2% a cada 10 níveis do treinador). Ele entra nos
    // SEUS Pokémon e não no selvagem, então some da medição feita em cima do
    // perdido — e sem ele a projeção sai sistematicamente uns 30% abaixo de
    // uma captura equivalente. O jogo não expõe o seu nível em nada que a
    // extensão leia, mas o bônus está embutido em toda captura registrada:
    // o fator medido nela vale qualidade × treinador, e a qualidade a
    // extensão conhece.
    //
    // No nível 1 os atributos são de um dígito e o arredondamento domina, por
    // isso nenhuma captura isolada serve: a estimativa é a MEDIANA de todas
    // as amostras e depois encaixa na grade real de 2% do jogo.
    let treinadorCache = null;
    function fatorTreinador() {
        if (treinadorCache !== null) return treinadorCache;
        const amostras = [];
        for (const e of (state && state.log) || []) {
            if (!e || e.lvl !== NIVEL_CAPTURA) continue;
            const sp = e.sp && speciesIndex.get(e.sp);
            if (!sp || !sp.base || !Array.isArray(e.det) || !Array.isArray(e.bat)) continue;
            const mult = Number(e.mult);
            if (!(mult > 0)) continue;
            const qual = Math.pow(mult, QUAL_EXP) * (e.shiny ? SHINY_STAT : 1);
            const f = fatoresDe(e);
            for (const k of ORDEM) {
                if (k === 'hp') continue;              // HP tem bônus próprio
                const i = ORDEM.indexOf(k);
                const b = Number(sp.base[k]);
                const obs = Number(e.bat[i]) || 0;
                if (!(b > 0) || !(obs > 0)) continue;
                const cru = baseCru(k, b, e.det[i], NIVEL_CAPTURA) * f.nat(k) * f.gen(k);
                if (!(cru > 0)) continue;
                amostras.push(obs / (cru * qual));
            }
        }
        // Poucas amostras não dão mediana confiável; melhor não corrigir nada
        // do que corrigir pelo valor errado.
        if (amostras.length < 12) return (treinadorCache = 1);
        amostras.sort((x, y) => x - y);
        const med = amostras[Math.floor(amostras.length / 2)];
        if (!(med > 0.95) || med > 3) return (treinadorCache = 1);
        return (treinadorCache = 1 + Math.max(0, Math.round((med - 1) / 0.02)) * 0.02);
    }

    // Multiplicador da cápsula usada. Sem ele não há chance para mostrar:
    // uma bola desconhecida vira traço em vez de virar 1× calado.
    function multDaBola(nomeBola) {
        const chave = ballKey(nomeBola, nomeBola);
        if (CAP_MULT_BOLA[chave] !== undefined) return CAP_MULT_BOLA[chave];
        for (const [re, m] of CAP_MULT_NOME) if (re.test(String(nomeBola || ''))) return m;
        return null;
    }

    // Chance daquela tentativa, em porcentagem, pela fórmula da wiki.
    // Devolve null quando falta peça — melhor traço que produto pela metade.
    //
    // Fica de fora o que a extensão não tem como saber: bônus de zona, bônus
    // pessoais e o multiplicador de espécie lendária/mítica (que é OUTRA
    // coisa que a qualidade do indivíduo). O simulador do jogo também ignora
    // bônus pessoais, então o número é comparável ao que ele mostra.
    function chanceDe(e) {
        if (!e) return null;
        const sp = e.sp && speciesIndex.get(e.sp);
        const base = sp && Number.isFinite(Number(sp.cap)) ? Number(sp.cap) : null;
        if (base === null) return null;                       // espécie ainda não indexada

        const bola = multDaBola(e.bola);
        if (bola === null) return null;                       // cápsula desconhecida

        const nivel = Number(e.lvlSel);
        if (!(nivel > 0)) return null;                        // captura antiga, sem o nível gravado

        const penQual = CAP_PEN_QUALIDADE[e.q];
        if (penQual === undefined) return null;

        const penNivel = 1 / (1 + nivel * CAP_ESCALA_NIVEL);
        const pct = base * bola * penNivel * CAP_DIFICULDADE * penQual
            * (e.shiny ? CAP_MULT_SHINY : 1);
        if (!(pct > 0)) return null;
        // Na prática todo shiny cai no piso: o multiplicador dele é tão baixo
        // que o produto fica ordens de grandeza abaixo de 0,01%. Não é
        // arredondamento da extensão — é o jogo mesmo.
        return Math.min(CAP_TETO, Math.max(CAP_PISO, pct));
    }

    // Motivo da última recusa, para o cartão poder dizer o que houve.
    let motivoProjecao = null;

    // Os seis atributos como se a criatura fosse capturada agora, ou null
    // quando não dá para confiar na conta.
    function projetarNivel1(e) {
        motivoProjecao = null;
        if (!e || !Array.isArray(e.bat) || !Array.isArray(e.det)) {
            motivoProjecao = 'sem atributos ou IVs gravados'; return null;
        }
        if (!e.lvl || e.lvl <= NIVEL_CAPTURA) return null;
        const sp = e.sp && speciesIndex.get(e.sp);
        if (!sp) { motivoProjecao = `espécie "${e.sp || '?'}" não está no índice`; return null; }
        if (!sp.base) { motivoProjecao = 'base stats da espécie não carregados'; return null; }

        const f = fatoresDe(e);
        const r = fatorMedido(e, sp, f);
        if (r.erro) { motivoProjecao = r.erro; return null; }

        motivoProjecao = null;
        // O fator medido no selvagem NÃO inclui o bônus de treinador, que só
        // vale para Pokémon seus. Somar aqui é o que torna o número comparável
        // com o registro de capturas.
        const fator = r.fator * fatorTreinador();
        return ORDEM.map((k, i) => {
            const cru = baseCru(k, sp.base[k], e.det[i], NIVEL_CAPTURA) * f.nat(k);
            return Math.max(1, Math.round(Math.round(cru * fator) * f.gen(k)));
        });
    }

    // Atributos a exibir: os projetados quando a criatura não está no nível de
    // captura, os gravados no resto dos casos.
    function batDe(e) {
        return projetarNivel1(e) || (Array.isArray(e && e.bat) ? e.bat : null);
    }

    // Poder total = soma dos seis atributos. Conferido contra o cartão do
    // jogo: um Charizard cujos atributos somam 9.383 exibia 9.383.
    // Derivar aqui, e não só na gravação, cura os perdidos que já estavam
    // salvos com zero.
    function poderDe(e) {
        const bat = batDe(e);
        if (bat) {
            let t = 0;
            for (const v of bat) t += Number(v) || 0;
            if (t > 0) return Math.round(t);
        }
        const gravado = Number(e && e.poder);
        return Number.isFinite(gravado) && gravado > 0 ? gravado : 0;
    }

    function registrarPerdido(data, rarity, ballKeyName) {
        if (!state) return;
        const inimigo = ultimoInimigo && markQuality(ultimoInimigo.quality) === rarity
            ? ultimoInimigo : null;
        const ivs = inimigo && inimigo.ivs && typeof inimigo.ivs === 'object' ? inimigo.ivs : null;
        const det = ivs ? IV_STATS.map(([k]) => Math.min(Number(ivs[k]) || 0, IV_STAT_MAX)) : null;
        const ivEvento = Number(data && (data.iv_total != null ? data.iv_total : data.ivTotal));
        const bat = inimigo ? [inimigo.max_hp, inimigo.atk, inimigo.def,
                               inimigo.spa, inimigo.spd, inimigo.spe].map(v => Number(v) || 0) : null;
        // O inimigo do combate não traz o campo de poder que a criatura
        // capturada traz, e o cartão mostrava 0. O poder total é a soma dos
        // seis atributos — conferido contra o cartão do próprio jogo, que
        // exibia 9.383 para um Charizard cujos atributos somam 9.383.
        // Arredondado de propósito: a sanitização do estado usa safeCount, que
        // devolve 0 para qualquer valor não inteiro. Um total fracionário
        // sobreviveria à sessão e viraria zero no recarregamento seguinte.
        const poder = Math.round(Number(inimigo && inimigo.power)
            || (bat ? bat.reduce((s, v) => s + v, 0) : 0));

        state.perdidos.unshift({
            sp: String((inimigo && inimigo.species_id) || '').slice(0, 40),
            nome: String((inimigo && (inimigo.species_name || inimigo.species_id)) || '?').slice(0, 40),
            q: rarity,
            // Selvagem vem no nível do mapa — ao contrário das capturas, que
            // nascem no nível 1. É justamente o que a coluna final mostra.
            lvl: Number(inimigo && inimigo.level) || 0,
            lvlSel: Number(inimigo && inimigo.level) || 0,
            iv: Math.min(det ? det.reduce((s, v) => s + v, 0)
                             : (Number.isFinite(ivEvento) ? ivEvento : 0), IV_MAX),
            det,
            mult: Number(inimigo && inimigo.quality_multiplier) || 0,
            bat,
            poder,
            nat: String((inimigo && inimigo.nature) || '').slice(0, 20),
            gen: inimigo && (inimigo.gender === 'male' || inimigo.gender === 'female')
                ? inimigo.gender : '',
            bola: ballKeyName,
            h: huntAtual || '',
            sold: false,
            shiny: !!(inimigo && inimigo.is_shiny),
            at: new Date().toISOString(),
        });

        state.perdidos = podarPerdidos(state.perdidos);
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
            // Nível em que o SELVAGEM estava. A captura nasce nível 1, então
            // sem guardar isto a chance de captura daquele encontro não tem
            // como ser recalculada depois. Vem do combat.started retido.
            lvlSel: Number(ultimoInimigo && ultimoInimigo.level) || 0,
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

    // Eventos que disparam muitas vezes por segundo e nunca trazem criatura
    // completa: varrer o corpo deles seria desperdício puro.
    const EVENTOS_SEM_CRIATURA = new Set([
        'combat.hit', 'loot.received', 'wild_monster.respawned',
        'ping', 'pong', 'client.visibility', 'chat.message',
    ]);

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

        // Criaturas que chegam por WebSocket. A oferta do OUTRO jogador numa
        // negociação nunca passa pelo seu /creatures, então sem isto o
        // analisador não teria como identificá-la. Os eventos de alta
        // frequência do combate ficam de fora para não custar nada no farm.
        if (type && !EVENTOS_SEM_CRIATURA.has(type)) {
            try { colher(data, 0); } catch (e) { /* nunca atrapalha o evento */ }
        }

        // Pokémon marcados no chat: só o retrato da criatura é guardado, para
        // o analisador. O texto das mensagens nunca é lido nem armazenado.
        if (type === 'chat.message') {
            try {
                if (data && data.id && Array.isArray(data.item_links)) {
                    guardar(chatLinks, data.id, data.item_links.filter(x => x && x.ivs), CAP.chat);
                }
            } catch (e) { /* ignora */ }
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

    // Várias respostas HTTP alimentam a extensão: espécies, fórmulas, coleção,
    // equipe, anúncios do mercado, histórico do chat e o analisador nativo.
    // Todas são lidas via clone(), nunca modificadas.
    const origFetch = W.fetch;
    if (typeof origFetch === 'function') {
        W.fetch = function (...args) {
            const p = origFetch.apply(this, args);
            try {
                const first = args[0];
                const url = (typeof first === 'string' ? first : (first && first.url)) || '';
                // Colheita genérica, antes de qualquer tratamento específico.
                p.then(res => res.clone().json()).then(b => { colher(b, 0); }).catch(() => {});
                // O jogo não serve mais catálogo em lista: pede espécie por
                // espécie, e a URL termina no id (…/species/machamp). O regex
                // antigo exigia terminar em /species e nunca casava.
                if (/\/species(\/[^/?]+)?(\?|$)/.test(url)) {
                    p.then(res => res.clone().json())
                     .then(b => {
                         const d = (b && b.data) || b;
                         const lista = Array.isArray(d) ? d : (d && d.id ? [d] : null);
                         if (!lista) return;
                         indexSpecies(lista);
                         render();
                     })
                     .catch(() => {});
                } else if (/\/creatures(\?|$)/.test(url)) {
                    p.then(res => res.clone().json())
                     .catch(() => {});
                } else if (/\/hunts\/analyzer(\?|$)/.test(url)) {
                    p.then(res => res.clone().json()).then(b => { reconciliar(b); }).catch(() => {});
                } else if (/\/team(\?|$)/.test(url)) {
                    // Havia dois ramos /team; o segundo era inalcançável e por
                    // isso indexTeam nunca rodava — a equipe ficava vazia.
                    p.then(res => res.clone().json())
                     .then(b => { indexCreatures(b); indexTeam(b); })
                     .catch(() => {});
                } else if (/\/chat\/history(\?|$)/.test(url)) {
                    // O chat já vem preenchido no load: sem isso, só mensagens
                    // que chegam ao vivo teriam análise.
                    p.then(res => res.clone().json())
                     .then(b => { indexChatHistory(b); })
                     .catch(() => {});
                } else if (/\/market\/listings(\?|$)/.test(url)) {
                    p.then(res => res.clone().json())
                     .then(b => { indexListings(b); })
                     .catch(() => {});
                } else if (/\/formulas(\?|$)/.test(url)) {
                    p.then(res => res.clone().json())
                     .then(b => {
                         const q = b && (b.quality || b.data && b.data.quality) || b;
                         indexFaixas(q);
                         render();
                     })
                     .catch(() => {});
                } else if (/\/stop(\?|$)/.test(url)) {
                    // "Voltar à cidade" encerra a caçada. É o sinal exato de
                    // que não há mais hunt ativa, sem depender de espera.
                    // (Os dois ramos duplicados que existiam aqui eram
                    // inalcançáveis; a flag que só eles setavam vive agora
                    // neste, que é o que de fato executa.)
                    p.then(() => {
                        cacadaEncerrada = true;
                        encerrarHunt();
                    }).catch(() => {});
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
        display: grid; grid-template-columns: repeat(4, 1fr);
        gap: 9px; padding: 9px 20px 3px;
    }
    .pp-rt-tab {
        background: #16161a; border: 1px solid #26262e; border-radius: 10px;
        color: #8b8b95; padding: 9px 10px; cursor: pointer;
        font: 600 12px/1 ui-sans-serif, system-ui, sans-serif;
        letter-spacing: .06em; transition: color .15s, border-color .15s;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .pp-rt-tab:hover { color: #c9ced4; }
    .pp-rt-tab.pp-active {
        background: #221d12; border-color: #4a3d22; color: #d9b665;
    }
    .pp-rt-tab:focus-visible { outline: 2px solid #d9b665; outline-offset: 2px; }

    /* Filtros ficam no HTML fixo e só são exibidos na aba de capturas: se
       fossem recriados a cada render, o campo perderia o foco na digitação. */
    #pp-rt-filters {
        display: none; grid-template-columns: 1.15fr 1fr .68fr .68fr .8fr .85fr;
        gap: 8px; padding: 6px 20px 0; align-items: end;
        height: 56px; box-sizing: border-box;
    }
    #pp-rt-filters.pp-on { display: grid; }
    /* Perdido não tem destino. Especificidade dupla para vencer a grade
       padrão acima, que tem a mesma especificidade e vem antes. O campo é
       escondido pelo id, não por posição: com :last-child, acrescentar um
       filtro no fim esconderia o filtro errado. */
    #pp-rt-filters.pp-sem-destino.pp-sem-destino {
        grid-template-columns: 1.35fr 1.15fr .78fr .78fr .95fr;
    }
    #pp-rt-filters.pp-sem-destino #pp-rt-field-sold { display: none; }
    .pp-rt-field { display: flex; flex-direction: column; gap: 4px; }
    .pp-rt-field label {
        color: #7a7a86; font-size: 9.5px; letter-spacing: .1em; text-transform: uppercase;
    }
    .pp-rt-field select, .pp-rt-field input {
        background: #16161a; border: 1px solid #26262e; border-radius: 8px;
        color: #e6e6ea; padding: 7px 9px; font: 400 12px ui-sans-serif, system-ui, sans-serif;
    }
    .pp-rt-field select:focus-visible, .pp-rt-field input:focus-visible,
    .pp-rt-multi > button:focus-visible {
        outline: 2px solid #d9b665; outline-offset: 1px;
    }

    /* Filtro de múltipla escolha: botão + painel de caixas. Um <select
       multiple> nativo vira caixa de lista de altura própria e não caberia
       na fileira de 56px que os filtros ocupam. */
    .pp-rt-multi { position: relative; }
    .pp-rt-multi > button {
        background: #16161a; border: 1px solid #26262e; border-radius: 8px;
        color: #e6e6ea; padding: 7px 9px; cursor: pointer; text-align: left;
        font: 400 12px ui-sans-serif, system-ui, sans-serif;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .pp-rt-multi > button:hover { border-color: #3a3a45; }
    .pp-rt-multi > button.pp-ativo { border-color: #d9b665; color: #f0dfae; }
    .pp-rt-pop {
        display: none; position: absolute; top: 100%; left: 0; z-index: 30;
        margin-top: 4px; min-width: 100%; max-width: 260px;
        /* O PAINEL não rola, mas este popup precisa: a lista de espécies
           acompanha o que existe no perfil e pode passar de dez linhas. */
        max-height: 232px; overflow-y: auto;
        background: #101014; border: 1px solid #2f2f38; border-radius: 9px;
        box-shadow: 0 12px 28px rgba(0,0,0,.6); padding: 5px;
    }
    .pp-rt-pop.pp-on { display: block; }
    .pp-rt-pop label {
        display: flex; align-items: center; gap: 7px; cursor: pointer;
        padding: 5px 7px; border-radius: 6px; color: #c6c6d0;
        font: 400 12px ui-sans-serif, system-ui, sans-serif;
        letter-spacing: 0; text-transform: none; white-space: nowrap;
    }
    .pp-rt-pop label:hover { background: #1b1b21; }
    .pp-rt-pop .pp-rt-pop-sep {
        height: 1px; background: #26262e; margin: 4px 2px;
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
        grid-template-columns: 1.45fr .82fr .68fr .82fr .85fr .92fr .7fr .78fr;
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
    #pp-rt-gtip { max-width: none; }
    #pp-rt-tip, #pp-rt-gtip {
        /* Fixo e fora do painel: dentro dele o overflow hidden, que garante
           a ausência de rolagem, cortaria o cartão pelo pé.
           O #pp-rt-gtip é o mesmo cartão nas telas do jogo — mesma caixa,
           mesma tipografia. Sem ele aqui, o conteúdo saía solto na página. */
        position: fixed; display: none; z-index: 2147483647;
        width: 344px; padding: 0; pointer-events: none; overflow: hidden;
        background: #0e0e10; border: 1px solid #3a3a44; border-radius: 12px;
        box-shadow: 0 16px 38px rgba(0,0,0,.7);
        /* Fora do painel, a herança de fonte se perdeu e o cartão passou a
           usar a tipografia da página do jogo. Declarada aqui, volta a ser a
           mesma do resto do painel. */
        font-family: ui-sans-serif, system-ui, sans-serif;
        font-size: 13px; line-height: normal; color: #e6e6ea;
        font-weight: 400; letter-spacing: normal; text-transform: none;
    }
    #pp-rt-tip.pp-on, #pp-rt-gtip.pp-on { display: block; }

    .pp-rt-tip-top {
        display: flex; align-items: center; gap: 12px;
        padding: 11px 13px; background: #16161a; border-bottom: 1px solid #26262e;
    }
    .pp-rt-tip-sprite {
        width: 50px; height: 50px; flex: none; object-fit: contain;
        image-rendering: pixelated; background: #101014;
        border: 1px solid #3a3a44; border-radius: 50%; padding: 3px;
    }
    .pp-rt-tip-id { min-width: 0; }
    .pp-rt-tip-id h3 { margin: 0 0 6px; font-size: 16px; font-weight: 600; color: #e6e6ea; }
    .pp-rt-tip-tags { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .pp-rt-tip-lvl {
        background: #14252f; border: 1px solid #2b4a5e; color: #7fc4e0;
        border-radius: 6px; padding: 2px 8px; font-size: 10.5px;
    }
    .pp-rt-tip-shiny {
        background: #10242b; border: 1px solid #2c5a66; color: #4fc6ea;
        border-radius: 6px; padding: 2px 8px; font-size: 10.5px;
    }

    /* Poder total e IV total lado a lado, como no card do jogo */
    .pp-rt-tip-caixas { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; padding: 10px 13px 0; }
    .pp-rt-tip-caixas.pp-rt-uma { grid-template-columns: 1fr; }
    .pp-rt-caixa--rar b i { font-style: normal; color: #8b8b95; font-size: 13px; }
    .pp-rt-caixa--rar em {
        display: block; margin-top: 5px; font-style: normal;
        color: #7a7a86; font-size: 10px;
    }
    .pp-rt-caixa {
        background: #16161a; border: 1px solid #26262e; border-radius: 9px; padding: 8px 10px;
    }
    .pp-rt-caixa p {
        margin: 0 0 3px; color: #7a7a86; font-size: 9px;
        letter-spacing: .12em; text-transform: uppercase;
    }
    .pp-rt-caixa b { font-size: 16px; color: #e6e6ea; font-variant-numeric: tabular-nums; }
    .pp-rt-caixa b i { font-style: normal; font-size: 11px; color: #55555f; }
    .pp-rt-iv-barra {
        display: block; height: 4px; margin-top: 5px; border-radius: 2px;
        background: #26262e; overflow: hidden;
    }
    .pp-rt-iv-barra span { display: block; height: 100%; border-radius: 2px; }

    .pp-rt-tip-sec { padding: 10px 13px 0; }
    .pp-rt-tip-gen { padding-bottom: 11px; }
    .pp-rt-tip-head {
        margin: 0 0 6px; color: #d9b665; font-size: 9.5px;
        letter-spacing: .12em; text-transform: uppercase;
    }
    /* O título é caixa-alta; o crédito não pode ser, senão "PPTools" vira
       "PPTOOLS". Escapa do text-transform e do espaçamento do título. */
    .pp-rt-tip-head .pp-rt-fonte {
        text-transform: none; letter-spacing: .01em;
        color: #7a7a86; font-size: 10px; font-weight: 400;
    }

    /* Cada atributo mostra o valor efetivo e o IV que o gerou */
    .pp-rt-bat-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 3px 10px; }
    .pp-rt-bat {
        display: flex; align-items: baseline; gap: 5px;
        background: #16161a; border: 1px solid #26262e; border-radius: 7px;
        padding: 5px 8px; font-size: 11px;
    }
    .pp-rt-bat > span { color: #8b8b95; flex: 1; }
    .pp-rt-bat > b { color: #e6e6ea; font-variant-numeric: tabular-nums; }
    /* O IV por atributo é dado de decisão, não rodapé: em #55555f sobre
       #16161a ele ficava com contraste ~2,5:1, ilegível de relance. O valor
       vem claro e seminegrito; só o "/31", que é constante e não informa
       nada, continua discreto. */
    .pp-rt-bat > i {
        font-style: normal; color: #cfcfda; font-size: 10.5px; font-weight: 600;
        font-variant-numeric: tabular-nums;
    }
    .pp-rt-bat > i .pp-rt-ivmax { color: #6c6c78; font-weight: 400; }
    .pp-rt-neutro { color: #8b8b95 !important; font-weight: 500 !important; }
    .pp-rt-up { color: #54d97c; font-size: 9px; margin-left: 2px; }
    .pp-rt-down { color: #f0736b; font-size: 9px; margin-left: 2px; }

    .pp-rt-stat {
        display: flex; justify-content: space-between; align-items: baseline;
        gap: 8px; margin-bottom: 4px; font-size: 11px;
    }
    .pp-rt-stat span { color: #8b8b95; }
    .pp-rt-stat b { color: #e6e6ea; font-weight: 600; text-align: right; }
    .pp-rt-tip-vazio { color: #55555f; font-size: 11px; margin: 0; }
    .pp-rt-cap-chance {
        color: #b9b9c4; font-size: 12px; font-variant-numeric: tabular-nums;
    }
    .pp-rt-cap-chance i { font-style: normal; color: #6c6c78; font-size: 10.5px; }
    .pp-rt-hrow, .pp-rt-row {
        display: grid; grid-template-columns: 1.4fr .75fr .75fr .75fr 1.55fr;
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
    /* Especificidade DUPLA e depois de .pp-rt-ball::after: com uma classe só,
       as duas regras empatavam e a de baixo vencia, então o miolo branco da
       pokébola voltava por cima do desenho. */
    .pp-rt-ball.pp-rt-ball--art {
        border: none; box-shadow: none; background: none; border-radius: 0;
        width: 16px; height: 16px; overflow: visible;
    }
    .pp-rt-ball.pp-rt-ball--art::after { content: none; display: none; }
    .pp-rt-ball.pp-rt-ball--art svg { width: 16px; height: 16px; display: block; }

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
    /* Quando o cartão precisa estreitar, as pizzas empilham em vez de serem
       cortadas pelo overflow do container. */
    .pp-rt-an .pp-rt-pzs { display: flex; flex-wrap: wrap; gap: 18px 24px;
        justify-content: center; margin: 10px 0 14px; }
    .pp-rt-pz svg { max-width: 100%; height: auto; }
    #pp-rt-gtip, #pp-rt-gtip * { box-sizing: border-box; }
    #pp-rt-gtip .pp-rt-why li { overflow-wrap: anywhere; }
    .pp-rt-pz { text-align: center; }
    .pp-rt-pz span { display: block; font-size: 12px; color: #8b8b99; margin-top: 4px; }
    .pp-rt-leg { margin: 0 0 10px; font-size: 11.5px; line-height: 1.5; color: #8b8b99;
        border-bottom: 1px solid #26262e; padding-bottom: 9px; }
    .pp-rt-leg b { color: #b9b9c6; font-weight: 600; }
    .pp-rt-why { margin: 0; padding-left: 16px; }
    .pp-rt-why li { font-size: 13px; line-height: 1.6; color: #c4c4d0; margin-bottom: 5px; }
    .pp-rt-why b { color: #e8e8ef; font-weight: 600; }
    /* Recomendação: não entra na nota, então tem peso visual menor. */
    .pp-rt-rec { color: #9a9aa8; }
    .pp-rt-rec b { color: #c9c9d4; }
    #pp-rt-del {
        background: none; border: 1px solid #4a3a3a; color: #d09a9a;
        border-radius: 4px; padding: 3px 8px; font-size: 11px; cursor: pointer; margin-left: 6px;
    }
    #pp-rt-del:hover { border-color: #6b4a4a; color: #f0a5a5; }
    #pp-rt-del[disabled] { opacity: .35; cursor: default; }
    #pp-rt-reset {
        background: #16161a; border: 1px solid #33333c; color: #b9b9c2;
        padding: 8px 13px; border-radius: 8px; cursor: pointer; flex: none;
        font-size: 12px; letter-spacing: .06em; text-transform: uppercase;
        max-width: 190px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    #pp-rt-reset:hover { border-color: #6b4a4a; color: #f0a5a5; }
    /* Botão armado: o segundo clique executa. Especificidade dupla para
       vencer as regras de #pp-rt-reset e #pp-rt-del, que vêm antes. */
    .pp-rt-armado.pp-rt-armado {
        border-color: #d9534f; color: #ffd9d7; background: #3a1f1f;
        animation: pp-rt-pulsa 1s ease-in-out infinite;
    }
    @keyframes pp-rt-pulsa { 50% { border-color: #ff8a85; } }
    @media (prefers-reduced-motion: reduce) {
        .pp-rt-armado.pp-rt-armado { animation: none; }
    }

    @media (max-width: 640px) {
        .pp-rt-totals { grid-template-columns: 1fr; }
        .pp-rt-hrow, .pp-rt-row { grid-template-columns: 1.2fr .55fr .55fr .55fr 1.05fr; gap: 8px; }
        .pp-rt-hrow.pp-rt-hrow--log, .pp-rt-row.pp-rt-row--log {
            grid-template-columns: 1.3fr .75fr .62fr .75fr .78fr .85fr .62fr .7fr; gap: 9px;
        }
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
        ligarTelasDoJogo();

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
                    <button class="pp-rt-tab" type="button" data-view="lost">Perdidos</button>
                </div>
                <div id="pp-rt-filters">
                    <div class="pp-rt-field pp-rt-multi">
                        <label for="pp-rt-f-sp">Pokémon</label>
                        <button id="pp-rt-f-sp" type="button" aria-haspopup="true"
                                aria-expanded="false">Todos</button>
                        <div class="pp-rt-pop" id="pp-rt-pop-sp" role="group"></div>
                    </div>
                    <div class="pp-rt-field pp-rt-multi">
                        <label for="pp-rt-f-q">Raridade</label>
                        <button id="pp-rt-f-q" type="button" aria-haspopup="true"
                                aria-expanded="false">Todas</button>
                        <div class="pp-rt-pop" id="pp-rt-pop-q" role="group"></div>
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
                        <label for="pp-rt-f-shiny">Forma</label>
                        <select id="pp-rt-f-shiny">
                            <option value="">Todas</option>
                            <option value="normal">Normal</option>
                            <option value="shiny">Shiny</option>
                        </select>
                    </div>
                    <div class="pp-rt-field" id="pp-rt-field-sold">
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
                    <button id="pp-rt-del" type="button">Excluir perfil</button>
                </div>
            </div>`;

        document.body.appendChild(fab);
        document.body.appendChild(overlay);

        const tip = document.createElement('div');
        tip.id = 'pp-rt-tip';
        document.body.appendChild(tip);

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
            del: overlay.querySelector('#pp-rt-del'),
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
            tip,
            filters: overlay.querySelector('#pp-rt-filters'),
            fSp: overlay.querySelector('#pp-rt-f-sp'),
            fQ: overlay.querySelector('#pp-rt-f-q'),
            fIvMin: overlay.querySelector('#pp-rt-f-ivmin'),
            fIvMax: overlay.querySelector('#pp-rt-f-ivmax'),
            popSp: overlay.querySelector('#pp-rt-pop-sp'),
            popQ: overlay.querySelector('#pp-rt-pop-q'),
            fSold: overlay.querySelector('#pp-rt-f-sold'),
            fShiny: overlay.querySelector('#pp-rt-f-shiny'),
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
        [els.fIvMin, els.fIvMax, els.fShiny, els.fSold].forEach(el => {
            el.addEventListener('change', () => { logPage = 0; render(); });
            el.addEventListener('input', () => { logPage = 0; render(); });
        });

        // Filtros de múltipla escolha: botão abre o painel, caixa marca.
        ligarMulti(els.fSp, els.popSp, selSp, 'Todos');
        ligarMulti(els.fQ, els.popQ, selQ, 'Todas');
        // Um clique fora fecha os dois. No capture para pegar antes de
        // qualquer handler que pare a propagação.
        document.addEventListener('mousedown', ev => {
            for (const [b2, pop] of [[els.fSp, els.popSp], [els.fQ, els.popQ]]) {
                if (!pop.classList.contains('pp-on')) continue;
                if (b2.contains(ev.target) || pop.contains(ev.target)) continue;
                fecharPop(b2, pop);
            }
        }, true);
        overlay.addEventListener('keydown', ev => {
            if (ev.key !== 'Escape') return;
            fecharPop(els.fSp, els.popSp);
            fecharPop(els.fQ, els.popQ);
        });

        // Delegação: as linhas são recriadas a cada render, então o ouvinte
        // fica no contêiner, que é permanente.
        els.rows.addEventListener('mouseover', ev => {
            // Vale nas duas abas de registro: perdido também tem retrato
            // completo (veio do combat.started) e merece a mesma análise.
            if (view !== 'log' && view !== 'lost') return;
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

        // Confirmação de ação destrutiva SEM confirm() do navegador.
        //
        // O confirm() nativo falha em silêncio: depois de alguns diálogos, o
        // Chrome oferece "impedir que esta página crie mais diálogos", e quem
        // marca isso passa a receber false em toda chamada seguinte, para
        // sempre, sem erro nenhum. O botão simplesmente para de funcionar e
        // não há o que investigar. Também era intestável — o sandbox do
        // harness nem tinha confirm, então estes dois botões nunca rodaram em
        // teste apesar de serem as duas ações que apagam dados.
        //
        // A confirmação agora mora no painel: o primeiro clique arma o botão,
        // o segundo executa. Sai sozinho depois de alguns segundos.
        const ARMADO_MS = 5000;
        let armado = null;   // { btn, timer, textoOriginal }

        function desarmar() {
            if (!armado) return;
            clearTimeout(armado.timer);
            armado.btn.classList.remove('pp-rt-armado');
            armado.btn.textContent = armado.textoOriginal;
            armado = null;
        }

        // Devolve true quando a ação está confirmada (segundo clique).
        function confirmado(btn, aviso) {
            if (armado && armado.btn === btn) { desarmar(); return true; }
            desarmar();
            armado = { btn, textoOriginal: btn.textContent, timer: null };
            btn.classList.add('pp-rt-armado');
            btn.textContent = aviso;
            armado.timer = setTimeout(desarmar, ARMADO_MS);
            return false;
        }

        // Excluir: subtrai do total igual ao zerar, mas remove o perfil em vez
        // de recriá-lo vazio. Sem a subtração o total guardaria números que não
        // aparecem em perfil nenhum.
        els.del.addEventListener('click', () => {
            if (!state) return;
            const h = perfilAtivo && state.hunts[perfilAtivo];
            if (!h) return;
            if (!confirmado(els.del, 'Confirmar exclusão?')) return;

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
            state.perdidos = state.perdidos.filter(e => e.h !== perfilAtivo);

            delete state.hunts[perfilAtivo];
            if (huntKey === perfilAtivo) { huntKey = null; hunt = null; }
            perfilAtivo = '';

            logPage = 0;
            if (els.perfil) els.perfil.__pp = null;
            save();
            render();
        });

        els.reset.addEventListener('click', () => {
            if (!state) return;
            const h = perfilAtivo && state.hunts[perfilAtivo];

            if (h) {
                if (!confirmado(els.reset, `Zerar ${h.nome}?`)) return;

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
                state.perdidos = state.perdidos.filter(e => e.h !== perfilAtivo);

                const zerada = novaHunt(h.nome, h.sp, h.map);
                zerada.ultimo = h.ultimo;
                state.hunts[perfilAtivo] = zerada;
            } else {
                if (!confirmado(els.reset, 'Zerar TUDO? Confirmar')) return;
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

    // Rosto da Eevee em SVG, no mesmo encaixe de 14px das pokébolas: orelhas
    // grandes com miolo escuro, juba clara, focinho. Desenhado em vez de usar
    // o sprite do jogo para não depender de imagem externa nem de rede.
    const ICONE_EEVEE = `<span class="pp-rt-ball pp-rt-ball--art">`
        + `<svg viewBox="0 0 20 20" aria-hidden="true">`
        // Orelhas largas e bem separadas: no tamanho de 16px, triângulo fino
        // vira um risco. A silhueta é o que identifica a Eevee aqui.
        + `<path d="M1.2 0.6 8.2 6.4 3.4 9.6Z" fill="#b0722f"/>`
        + `<path d="M18.8 0.6 11.8 6.4 16.6 9.6Z" fill="#b0722f"/>`
        + `<path d="M3.0 3.0 7.0 6.4 4.4 8.2Z" fill="#4a2d12"/>`
        + `<path d="M17.0 3.0 13.0 6.4 15.6 8.2Z" fill="#4a2d12"/>`
        + `<ellipse cx="10" cy="12" rx="7" ry="6.4" fill="#c8853f"/>`
        + `<path d="M3.3 14.6q6.7 5.2 13.4 0 -1.3 4.2 -6.7 4.2 -5.4 0 -6.7-4.2Z" fill="#f2e2b4"/>`
        + `<ellipse cx="7.2" cy="11.2" rx="1.55" ry="1.8" fill="#241505"/>`
        + `<ellipse cx="12.8" cy="11.2" rx="1.55" ry="1.8" fill="#241505"/>`
        + `</svg></span>`;

    const iconeBola = b => (b.art === 'eevee' ? ICONE_EEVEE
        : `<span class="pp-rt-ball" style="--pp-band:${b.band};`
        + `background:linear-gradient(to bottom,${b.top} 0 44%,${b.band} 44% 56%,${b.bottom} 56% 100%)"></span>`);

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

    // Só as espécies presentes no perfil ativo, em ordem alfabética. Reconstrói
    // apenas quando o conjunto muda, para não perder a seleção nem o foco a
    // cada redesenho — o painel redesenha a cada evento de captura.
    // Nome de exibição da espécie: usa o catálogo quando conhecido, senão o id
    // legível. Mesma regra do resto do painel, para não divergir.
    function nomeEspecie(id) {
        const sp = id && speciesIndex.get(id);
        return (sp && sp.name) || prettify(id || '?');
    }

    /* ---------------------------------------------------------------
     * FILTROS DE MÚLTIPLA ESCOLHA
     *
     * Espécie e raridade aceitam várias marcações ao mesmo tempo. O
     * conjunto VAZIO quer dizer "todas" — é o que faz o filtro começar
     * sem esconder nada e evita o estado inútil de zero marcadas, em que
     * a lista ficaria vazia sem motivo aparente.
     * ------------------------------------------------------------- */
    const selSp = new Set();
    const selQ = new Set();

    function fecharPop(btn, pop) {
        if (!pop || !pop.classList.contains('pp-on')) return;
        pop.classList.remove('pp-on');
        btn.setAttribute('aria-expanded', 'false');
    }

    function ligarMulti(btn, pop, sel, rotuloTodos) {
        btn.addEventListener('click', () => {
            const abrir = !pop.classList.contains('pp-on');
            // Só um painel aberto por vez.
            fecharPop(els.fSp, els.popSp);
            fecharPop(els.fQ, els.popQ);
            if (!abrir) return;
            pop.classList.add('pp-on');
            btn.setAttribute('aria-expanded', 'true');
        });
        pop.addEventListener('change', ev => {
            const cb = ev.target;
            if (!cb || cb.type !== 'checkbox') return;
            if (cb.value === '') {          // "Todas": limpa a seleção
                sel.clear();
            } else if (cb.checked) {
                sel.add(cb.value);
            } else {
                sel.delete(cb.value);
            }
            logPage = 0;
            render();
        });
        btn.__ppRotulo = rotuloTodos;
    }

    // Texto do botão: o que está marcado, sem obrigar a abrir o painel.
    function rotuloMulti(btn, sel, nomeDe) {
        const n = sel.size;
        btn.classList.toggle('pp-ativo', n > 0);
        if (!n) { btn.textContent = btn.__ppRotulo || 'Todas'; return; }
        if (n === 1) { btn.textContent = nomeDe([...sel][0]); return; }
        btn.textContent = `${n} selecionadas`;
    }

    // Redesenha as caixas de um painel preservando o que está marcado.
    function montarCaixas(pop, itens, sel) {
        const assinatura = itens.map(i => i.v).join('|');
        if (pop.__ppSig !== assinatura) {
            pop.__ppSig = assinatura;
            pop.innerHTML = '';
            const todos = document.createElement('label');
            todos.innerHTML = '<input type="checkbox" value="">'
                + `<span>${escapeHtml(pop === els.popQ ? 'Todas' : 'Todos')}</span>`;
            pop.appendChild(todos);
            const sep = document.createElement('div');
            sep.className = 'pp-rt-pop-sep';
            pop.appendChild(sep);
            for (const it of itens) {
                const l = document.createElement('label');
                const cb = document.createElement('input');
                cb.type = 'checkbox';
                cb.value = it.v;
                const sp2 = document.createElement('span');
                sp2.textContent = it.nome;
                if (it.cor) sp2.style.color = it.cor;
                l.appendChild(cb);
                l.appendChild(sp2);
                pop.appendChild(l);
            }
        }
        // Marcações refletem o estado atual, inclusive depois de redesenhar.
        for (const cb of pop.querySelectorAll('input[type=checkbox]')) {
            cb.checked = cb.value === '' ? sel.size === 0 : sel.has(cb.value);
        }
    }

    function atualizarFiltroRaridade() {
        if (!els.popQ) return;
        montarCaixas(els.popQ,
            RARITIES.map(r => ({ v: r.key, nome: r.label, cor: r.color })), selQ);
        rotuloMulti(els.fQ, selQ, k => (RARITIES.find(r => r.key === k) || {}).label || k);
    }

    function atualizarFiltroEspecie(lista) {
        if (!els.fSp || !state) return;
        const vistos = new Set();
        for (const e of (lista || state.log)) {
            if (perfilAtivo && e.h !== perfilAtivo) continue;
            if (e.sp) vistos.add(e.sp);
        }
        const ids = [...vistos].sort((a, b) => nomeEspecie(a).localeCompare(nomeEspecie(b), 'pt-BR'));
        // Espécie que saiu da lista sai da seleção junto, senão o filtro
        // esconderia tudo por causa de uma escolha invisível.
        for (const id of [...selSp]) if (ids.indexOf(id) < 0) selSp.delete(id);
        montarCaixas(els.popSp, ids.map(id => ({ v: id, nome: nomeEspecie(id) })), selSp);
        rotuloMulti(els.fSp, selSp, nomeEspecie);
    }

    function renderLog(perdidos) {
        const lista0 = perdidos ? state.perdidos : state.log;
        const teto = perdidos ? LOST_CAP : LOG_CAP;
        els.hrow.style.display = '';
        els.hrow.classList.add('pp-rt-hrow--log');
        els.hrow.innerHTML = '<div>Pokémon</div><div>Raridade</div><div>IV</div>'
            + '<div>Natureza</div><div>Gênero</div><div>Pokébola</div><div>Chance</div>'
            + `<div style="text-align:right">${perdidos ? 'Nível' : 'Destino'}</div>`;
        esconderTip();

        // Filtros lidos na hora; os campos vivem no HTML fixo justamente para
        // não perderem o foco a cada redesenho.
        // O filtro de espécie é preenchido com o que existe no perfil ativo,
        // então ele acompanha a hunt selecionada em vez de listar as 251.
        atualizarFiltroEspecie(lista0);
        // Conjunto vazio = todas.
        atualizarFiltroRaridade();
        const min = els.fIvMin.value === '' ? 0 : Number(els.fIvMin.value);
        const max = els.fIvMax.value === '' ? IV_MAX : Number(els.fIvMax.value);
        const fs = els.fSold.value;
        const fsh = els.fShiny.value;

        const lista = lista0.filter(e =>
            (!perfilAtivo || e.h === perfilAtivo)
            && (!selSp.size || selSp.has(e.sp))
            && (!selQ.size || selQ.has(e.q))
            && e.iv >= (Number.isFinite(min) ? min : 0)
            && e.iv <= (Number.isFinite(max) ? max : IV_MAX)
            && (!fsh || (fsh === 'shiny' ? e.shiny : !e.shiny))
            && (perdidos || !fs || (fs === 'sold' ? e.sold : !e.sold)));

        const paginas = Math.max(1, Math.ceil(lista.length / LOG_PAGE));
        if (logPage > paginas - 1) logPage = paginas - 1;
        const inicio = logPage * LOG_PAGE;
        const pagina = lista.slice(inicio, inicio + LOG_PAGE);

        if (!lista.length) {
            els.rows.innerHTML = `<div class="pp-rt-empty">${lista0.length
                ? `Nenhum${perdidos ? ' perdido' : 'a captura'} corresponde aos filtros.`
                : `Nenhum${perdidos ? ' perdido registrado' : 'a captura registrada'} ainda.`}</div>`;
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
                    <span class="pp-rt-cap-chance">${(() => {
                        // Chance declarada pelo jogo para a espécie. Traço
                        // enquanto o jogo não tiver mandado os dados dela.
                        const ch = chanceDe(e);
                        // Duas casas sem zero à toa: o jogo declara 17,65, e
                        // arredondar para 17,6 perderia precisão sem ganhar nada.
                        if (ch === null) return '<i>—</i>';
                        // Casas suficientes para a Mítica não virar 0,00%:
                        // ela cai a milésimos de por cento.
                        const casas = ch >= 1 ? 2 : ch >= 0.01 ? 3 : 5;
                        // Sem zero à toa no fim: o piso é 0,01 e apareceria
                        // como "0,010%" com casas fixas.
                        const txt = String(Number(ch.toFixed(casas))).replace('.', ',');
                        return `${txt}<i>%</i>`;
                    })()}</span>
                    <span class="pp-rt-cap-dest" style="color:${perdidos ? '#8b8b95' : (e.sold ? '#8b8b95' : '#54d97c')}">
                        ${perdidos ? (e.lvl ? 'Nv. ' + fmt(e.lvl) : '—') : (e.sold ? 'Vendido' : 'Guardado')}
                    </span>
                </div>`;
            }).join('')
            + `<div class="pp-rt-row pp-rt-row--log pp-rt-spacer"></div>`
                .repeat(Math.max(0, LOG_PAGE - pagina.length));
        }

        const limite = perdidos
            ? `mostra os últimos ${fmt(LOST_CAP)} perdidos comuns; lendários, `
              + `míticos e shiny ficam guardados à parte`
            : `mostra as últimas ${fmt(teto)} capturas`;
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

    /* ---------------------------------------------------------------
     * ANALISADOR
     *
     * Nota = atributos do Pokémon ÷ atributos do melhor possível.
     * Dois denominadores: o topo do próprio tier, e o topo da espécie
     * (mítica). Shiny é comparado só com shiny, porque a tabela de
     * multiplicador é outra.
     *
     * Os pesos vêm do jogo, não de suposição: o move_catalog declara se
     * cada golpe é físico ou especial, com power e cooldown_ms. O
     * atributo ofensivo que a espécie não usa vale zero — 31 de Atq.
     * Especial num Machamp não ajuda em nada.
     *
     * Natureza e gênero ENTRAM na nota, seguindo o cálculo do PPTools
     * (qualificadora de Pokémon, fórmula cedida pelo autor): o piso e o
     * teto de cada tier buscam a pior e a melhor combinação possível de
     * natureza/gênero, não só o pior/melhor par qualidade+IV — ver
     * pisoNota()/tetoNota(). Isso NÃO usa o peso de perfil de ataque da
     * espécie (fis/esp) — esse continua só nas recomendações do cartão
     * (tetoDe()) e no texto de explicar().
     * ------------------------------------------------------------- */
    const QUAL_EXP = 1.15;
    const SHINY_STAT = Math.pow(1.15, 1.15);
    const NIVEL_REF = 100;      // capturas nascem nível 1; a nota projeta
    const ORDEM = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];

    function pesosDe(sp) {
        const b = sp && sp.base;
        if (!b) return null;
        let fis = 0, esp = 0, medido = false;
        for (const id of (sp.moves || [])) {
            const m = moveIndex.get(id);
            if (!m || m.p <= 1) continue;      // power 1 = golpe de status
            const dps = m.p / (m.cd / 1000);
            if (m.c === 'f') fis += dps; else esp += dps;
            medido = true;
        }
        if (!medido) { fis = b.atk; esp = b.spa; }   // sem catálogo, cai no base
        const tot = fis + esp || 1;
        const w = {};
        for (const k of ORDEM) w[k] = b[k] || 0;
        w.atk = b.atk * (fis / tot);
        w.spa = b.spa * (esp / tot);
        return { w, fis: fis / tot, esp: esp / tot, medido };
    }

    function attr(base, iv, natSobe, natDesce, gen, mult, shiny, chave) {
        let v = Math.floor((2 * base + iv) * NIVEL_REF / 100 + 5);
        if (chave === natSobe) v *= 1.1;
        if (chave === natDesce) v *= 0.9;
        if (gen === 'male' && (chave === 'atk' || chave === 'spa')) v *= 1.1;
        if (gen === 'female' && chave === 'hp') v *= 1.1;
        v *= Math.pow(mult, QUAL_EXP);
        if (shiny) v *= SHINY_STAT;
        return v;
    }

    function somaPesada(base, ivs, natSobe, natDesce, gen, mult, shiny, w) {
        let t = 0;
        for (const k of ORDEM) t += w[k] * attr(base[k], ivs[k], natSobe, natDesce, gen, mult, shiny, k);
        return t;
    }

    // Distribui um orçamento de IV total priorizando os atributos de maior peso.
    function alocar(w, total) {
        const ivs = {}; for (const k of ORDEM) ivs[k] = 1;
        let resta = Math.max(0, total - 6);
        for (const k of [...ORDEM].sort((a, b) => w[b] - w[a])) {
            const d = Math.min(30, resta); ivs[k] += d; resta -= d;
            if (!resta) break;
        }
        return ivs;
    }

    function melhorGenero(base, ivs, sb, ds, mult, shiny, w) {
        const m = somaPesada(base, ivs, sb, ds, 'male', mult, shiny, w);
        const f = somaPesada(base, ivs, sb, ds, 'female', mult, shiny, w);
        return m >= f ? 'male' : 'female';
    }

    // Melhor natureza: sobe o atributo de maior peso, derruba o de menor.
    function melhorNatureza(w) {
        const ord = [...ORDEM].sort((a, b) => w[b] - w[a]);
        return { sobe: ord[0], desce: ord[ord.length - 1] };
    }



    // Pares (sobe, desce) de todas as naturezas, sem repetição.
    // Pares DISTINTOS de natureza (sobe, desce), usados na busca do piso e do
    // teto da nota (pisoNota()/tetoNota()) e na recomendação do cartão (tetoDe()).
    const PARES_NAT = (() => {
        const vistos = new Set(), out = [[null, null]];
        for (const v of Object.values(NATUREZAS)) {
            if (!v || v[1] == null || v[2] == null) continue;
            const a = ORDEM[v[1]], b = ORDEM[v[2]], k = a + '>' + b;
            if (!vistos.has(k)) { vistos.add(k); out.push([a, b]); }
        }
        return out;
    })();

    // Distribuir IV é linear com teto por atributo: encher do maior ganho
    // marginal para o menor é ótimo. Serve só para a RECOMENDAÇÃO.
    function alocarOtimo(margem, total) {
        const ivs = {}; for (const k of ORDEM) ivs[k] = 1;
        let resta = Math.max(0, total - 6);
        for (const k of [...ORDEM].sort((a, b) => margem[b] - margem[a])) {
            const d = Math.min(IV_STAT_MAX - 1, resta); ivs[k] += d; resta -= d;
            if (!resta) break;
        }
        return ivs;
    }

    // Melhor combinação de natureza e gênero para a espécie, por busca
    // exaustiva. NÃO entra na nota — alimenta as dicas do cartão.
    function tetoDe(base, w, tier, shiny) {
        const banda = faixaDe(tier, shiny);
        const ivB = faixas.iv[tier];
        if (!banda || !ivB) return null;
        let melhor = null;
        for (const [sobe, desce] of PARES_NAT) {
            for (const gen of ['male', 'female']) {
                const margem = {};
                for (const k of ORDEM) {
                    let m = w[k];
                    if (k === sobe) m *= 1.1;
                    if (k === desce) m *= 0.9;
                    if (gen === 'male' && (k === 'atk' || k === 'spa')) m *= 1.1;
                    if (gen === 'female' && k === 'hp') m *= 1.1;
                    margem[k] = m;
                }
                const ivs = alocarOtimo(margem, ivB.max);
                const val = somaPesada(base, ivs, sobe, desce, gen, banda.max, shiny, w);
                if (!melhor || val > melhor.valor) {
                    melhor = { valor: val, nat: { sobe, desce }, gen };
                }
            }
        }
        return melhor;
    }

    // Distribui o orçamento de IV priorizando os atributos de MENOR margem —
    // espelho de alocarOtimo(), usado para achar o pior roll possível de um
    // tier (o excedente de IV desperdiçado onde menos rende).
    function alocarPior(margem, total) {
        const ivs = {}; for (const k of ORDEM) ivs[k] = 1;
        let resta = Math.max(0, total - 6);
        for (const k of [...ORDEM].sort((a, b) => margem[a] - margem[b])) {
            const d = Math.min(IV_STAT_MAX - 1, resta); ivs[k] += d; resta -= d;
            if (!resta) break;
        }
        return ivs;
    }

    // Soma dos seis atributos SEM peso de perfil de ataque da espécie — cada
    // atributo pesa o mesmo, igual à nota de antes. A diferença para a versão
    // anterior é só que natureza e gênero agora entram no cálculo de cada
    // atributo (via attr()), como no PPTools.
    function somaSimples(base, ivs, natSobe, natDesce, gen, mult, shiny) {
        let t = 0;
        for (const k of ORDEM) t += attr(base[k], ivs[k], natSobe, natDesce, gen, mult, shiny, k);
        return t;
    }

    // Quanto cada atributo vale para efeito de nature/gênero, sem peso de
    // espécie — usado só para decidir ONDE alocar o IV extra ao buscar o
    // piso/teto da nota (o excedente rende mais no atributo que a natureza
    // ou o gênero favorecem).
    function margemNota(sobe, desce, gen) {
        const m = {};
        for (const k of ORDEM) {
            let v = 1;
            if (k === sobe) v *= 1.1;
            if (k === desce) v *= 0.9;
            if (gen === 'male' && (k === 'atk' || k === 'spa')) v *= 1.1;
            if (gen === 'female' && k === 'hp') v *= 1.1;
            m[k] = v;
        }
        return m;
    }

    // Melhor e pior valor de nota possíveis num tier, buscando entre todas as
    // combinações de natureza e gênero (e a alocação de IV mais favorável ou
    // desfavorável para cada uma) — sem peso de espécie, igual à nota.
    function tetoNota(base, tier, shiny) {
        const banda = faixaDe(tier, shiny);
        const ivB = faixas.iv[tier];
        if (!banda || !ivB) return null;
        let melhor = null;
        for (const [sobe, desce] of PARES_NAT) {
            for (const gen of ['male', 'female']) {
                const ivs = alocarOtimo(margemNota(sobe, desce, gen), ivB.max);
                const val = somaSimples(base, ivs, sobe, desce, gen, banda.max, shiny);
                if (melhor == null || val > melhor) melhor = val;
            }
        }
        return melhor;
    }

    function pisoNota(base, tier, shiny) {
        const banda = faixaDe(tier, shiny);
        const ivB = faixas.iv[tier];
        if (!banda || !ivB) return null;
        let pior = null;
        for (const [sobe, desce] of PARES_NAT) {
            for (const gen of ['male', 'female']) {
                const ivs = alocarPior(margemNota(sobe, desce, gen), ivB.min);
                const val = somaSimples(base, ivs, sobe, desce, gen, banda.min, shiny);
                if (pior == null || val < pior) pior = val;
            }
        }
        return pior;
    }

    // Extremos de um tier: a pior e a melhor nota possíveis nele, já
    // considerando a melhor/pior natureza e gênero (não só qualidade e IV —
    // ver comentário do ANALISADOR acima).
    function extremosDoTier(base, tier, shiny) {
        const banda = faixaDe(tier, shiny);
        const ivB = faixas.iv[tier];
        if (!banda || !ivB) return null;
        const piso = pisoNota(base, tier, shiny);
        const teto = tetoNota(base, tier, shiny);
        if (piso == null || teto == null) return null;
        return { piso, teto, ivMin: ivB.min, ivMax: ivB.max, multMin: banda.min, multMax: banda.max };
    }

    // Menor e maior tier existentes na tabela em uso. A tabela shiny começa na
    // Épica, não na Fraca — por isso não dá para fixar 'weak' e 'mythical'.
    function tiersDaTabela(shiny) {
        const tem = TIER_ORDEM.filter(t => faixaDe(t, shiny) && faixas.iv[t]);
        return tem.length ? { menor: tem[0], maior: tem[tem.length - 1] } : null;
    }

    /* Normalização de faixa.
     *
     * A razão crua contra o teto comprimia tudo: o dobro dos base stats é ~78%
     * do material total, então TODA Mítica Butterfree cai entre 89,6% e 100%.
     * Medindo dentro da amplitude possível, a escala de 0 a 100 volta a ser
     * usada por inteiro e o número passa a distinguir os rolls.
     *
     *     % = (nota − pior possível) ÷ (melhor possível − pior possível)
     */
    const normaliza = (v, piso, teto) =>
        teto > piso ? Math.max(0, Math.min(100, 100 * (v - piso) / (teto - piso))) : 100;

    function analisar(e) {
        const sp = e.sp && speciesIndex.get(e.sp);
        const P = pesosDe(sp);
        if (!P || !e.q || !faixas.iv[e.q]) return null;
        const base = sp.base, w = P.w;
        const shiny = !!e.shiny;
        const mult = Number(e.mult) || 0;
        if (!mult) return null;

        const det = Array.isArray(e.det) && e.det.length === 6 ? e.det : null;
        if (!det) return null;
        const ivs = {}; ORDEM.forEach((k, i) => { ivs[k] = det[i]; });
        const ivTot = ORDEM.reduce((a, k) => a + ivs[k], 0);

        const nat = NATUREZAS[String(e.nat || '').toLowerCase()];
        const sobe = nat ? ORDEM[nat[1]] : null;
        const desce = nat ? ORDEM[nat[2]] : null;
        const gen = String(e.gen || '').toLowerCase();

        const atual = somaSimples(base, ivs, sobe, desce, gen, mult, shiny);
        const tTier = extremosDoTier(base, e.q, shiny);
        const tt = tiersDaTabela(shiny);
        if (!tTier || !tt) return null;
        const pior = extremosDoTier(base, tt.menor, shiny);
        const melhor = extremosDoTier(base, tt.maior, shiny);
        if (!pior || !melhor) return null;

        // Recomendações — mesma busca que já alimenta o teto da nota.
        const ideal = tetoDe(base, w, e.q, shiny);   // busca natureza/gênero ótimos

        return {
            // 1º: posição dentro da amplitude do próprio tier.
            pctTier: normaliza(atual, tTier.piso, tTier.teto),
            // 2º: posição dentro da amplitude da espécie inteira, do pior roll
            // do menor tier ao melhor do maior.
            pctEsp: normaliza(atual, pior.piso, melhor.teto),
            faixaTier: tTier, tierMenor: tt.menor, tierMaior: tt.maior, ideal,
            pesos: P, ivs, ivTot, base, sobe, desce, gen, mult, shiny, tier: e.q,
        };
    }

    function explicar(A) {
        const NOME = { hp: 'HP', atk: 'Ataque', def: 'Defesa', spa: 'Atq. Esp.', spd: 'Def. Esp.', spe: 'Velocidade' };
        const out = [];
        const rot = (RARITIES.find(r => r.key === A.tier) || {}).label || A.tier;
        const fis = Math.round(A.pesos.fis * 100), esp = 100 - fis;
        const fonte = A.pesos.medido ? 'pelos golpes que aprende' : 'pelos atributos base';
        const F = A.faixaTier;
        const n2 = x => x.toFixed(2).replace('.', ',');

        // --- qualidade e IV, com a faixa inteira à vista (natureza/gênero vêm depois) ---
        out.push(`IV total <b>${A.ivTot}</b> na faixa ${F.ivMin}–${F.ivMax} da ${rot}.`);
        out.push(`Qualidade <b>×${n2(A.mult)}</b> na faixa ×${n2(F.multMin)}–×${n2(F.multMax)}.`);

        // --- perfil de dano: vem do catálogo de golpes do jogo ---
        const morto = fis >= 85 ? 'spa' : (esp >= 85 ? 'atk' : null);
        if (morto) {
            out.push(`Ataca de <b>${morto === 'spa' ? 'físico' : 'especial'}</b> `
                + `(${morto === 'spa' ? fis : esp}% do dano, ${fonte}): IV em ${NOME[morto]} rende pouco.`);
        } else {
            out.push(`Ataca dos <b>dois lados</b> — ${fis}% físico e ${esp}% especial `
                + `(${fonte}): IV nos dois conta.`);
        }

        // --- natureza: só o que se apoia no perfil de dano acima ---
        const rec = [];
        if (!A.sobe) {
            rec.push('Natureza neutra: não altera atributo nenhum.');
        } else if (morto && A.desce === morto) {
            rec.push(`Natureza <b>sem custo</b>: o que ela derruba (${NOME[A.desce]}) essa espécie quase não usa.`);
        } else if (morto && A.sobe === (morto === 'spa' ? 'atk' : 'spa')) {
            rec.push(`Natureza sobe <b>${NOME[A.sobe]}</b>, que é como essa espécie ataca.`);
        } else if ((A.desce === 'atk' && fis >= 50) || (A.desce === 'spa' && esp >= 50)) {
            rec.push(`Natureza derruba <b>${NOME[A.desce]}</b>, que é o lado que essa espécie mais usa para atacar.`);
        } else {
            rec.push(`Natureza sobe ${NOME[A.sobe]} e derruba ${NOME[A.desce]}.`);
        }

        // --- gênero: o efeito, sem dizer qual é "o ideal" ---
        rec.push(A.gen === 'male'
            ? 'Macho: +10% em Ataque e Atq. Esp.'
            : 'Fêmea: +10% em HP.');

        for (const r of rec) out.push(`<span class="pp-rt-rec">${r}</span>`);
        return out;
    }

    const claro = (hex, f) => {
        const n = parseInt(String(hex).replace('#', ''), 16);
        const m = c => Math.round(c + (255 - c) * f);
        return '#' + [m(n >> 16 & 255), m(n >> 8 & 255), m(n & 255)]
            .map(x => x.toString(16).padStart(2, '0')).join('');
    };

    let gradSeq = 0;
    const PZ_R = 16;            // raio do anel
    const PZ_W = 5;             // espessura do traço
    // A ponta arredondada projeta meio traço ALÉM de cada extremidade do arco.
    // Com traço 5 e raio 16 isso soma ~5% da circunferência, então 95%
    // desenhava fechado como 100%. Aqui o desenho é encurtado exatamente
    // nessa sobra, e pathLength="100" faz o dasharray valer em porcentagem
    // real em vez de assumir circunferência 100 (que na verdade é 100,53).
    const PZ_CAP = 100 * PZ_W / (2 * Math.PI * PZ_R);

    function pizza(pct, paradas, rotulo) {
        const id = 'ppg' + (++gradSeq);
        const v = Math.max(0, Math.min(100, pct));
        // Piso pequeno para que valores baixos ainda apareçam como um ponto.
        const traco = v <= 0 ? 0 : Math.max(0.6, v - PZ_CAP);
        const stops = paradas.map((c, i) =>
            `<stop offset="${paradas.length === 1 ? 100 : (i / (paradas.length - 1) * 100).toFixed(0)}%" stop-color="${c}"/>`).join('');
        return `<div class="pp-rt-pz">
            <svg viewBox="0 0 42 42" width="118" height="118" role="img" aria-label="${escapeHtml(rotulo)} ${v.toFixed(0)}%">
              <defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">${stops}</linearGradient></defs>
              <circle cx="21" cy="21" r="${PZ_R}" fill="none" stroke="#26262e" stroke-width="${PZ_W}"
                      pathLength="100"/>
              <circle cx="21" cy="21" r="${PZ_R}" fill="none" stroke="url(#${id})" stroke-width="${PZ_W}"
                      pathLength="100" stroke-linecap="round"
                      stroke-dasharray="${traco.toFixed(2)} ${(100 - traco).toFixed(2)}"
                      stroke-dashoffset="25"/>
              <text x="21" y="23.4" text-anchor="middle" font-size="9.5" fill="#f2f2f5">${v.toFixed(0)}%</text>
            </svg>
            <span>${escapeHtml(rotulo)}</span>
        </div>`;
    }


    function motivoFalha(e, ctx) {
        if (!e) {
            if (ctx && ctx.tipo === 'time') {
                return equipe.length
                    ? 'não consegui casar o slot da equipe com a criatura'
                    : 'equipe ainda não carregada — recarregue com Ctrl+Shift+R';
            }
            if (ctx && ctx.tipo === 'mkt') {
                return anuncios.size
                    ? `anúncio ${String(ctx.id || '').slice(0, 8)}… não está entre os ${anuncios.size} carregados`
                    : 'nenhum anúncio carregado — reabra o mercado com a extensão já ativa';
            }
            return 'sem dados desta criatura';
        }
        const sp = e.sp && speciesIndex.get(e.sp);
        if (!sp) return `espécie ${e.sp || '?'} ainda não vista nesta sessão`;
        if (!sp.base) return `sem base stats de ${e.sp}`;
        if (!faixas.iv || !Object.keys(faixas.iv).length) return 'faixas de IV não carregadas — recarregue com Ctrl+Shift+R';
        if (!e.q || !faixas.iv[e.q]) return `tier "${e.q || '?'}" fora das faixas conhecidas`;
        if (!e.mult) return 'sem quality_multiplier';
        if (!Array.isArray(e.det) || e.det.length !== 6) return 'sem IVs por atributo';
        return 'não consegui calcular';
    }

    function analiseHtml(e, ctx) {
        const A = analisar(e);
        if (!A) return `<div class="pp-rt-tip-sec pp-rt-an">
            <p class="pp-rt-tip-head">Análise</p>
            <ul class="pp-rt-why"><li>Indisponível: ${escapeHtml(motivoFalha(e, ctx))}.</li></ul>
        </div>`;
        const r = RARITIES.find(x => x.key === A.tier) || RARITIES[0];
        const arcoTier = [r.color, claro(r.color, 0.55)];
        const arcoEsp = RARITIES.map(x => x.color);
        const alvo = A.shiny ? 'shinies da espécie' : 'toda a espécie';
        return `<div class="pp-rt-tip-sec pp-rt-an">
            <p class="pp-rt-tip-head">Análise <span class="pp-rt-fonte">— dados de acordo com o PPTools</span></p>
            <div class="pp-rt-pzs">
                ${pizza(A.pctTier, arcoTier,
                        'entre as ' + (r.label || '').toLowerCase() + 's' + (A.shiny ? ' shiny' : ''))}
                ${pizza(A.pctEsp, arcoEsp, 'entre ' + alvo)}
            </div>
            <p class="pp-rt-leg">
                <b>1º gráfico:</b> onde ele cai entre as
                ${escapeHtml((r.label || '').toLowerCase())}s${escapeHtml(A.shiny ? ' shiny' : '')}
                possíveis desta espécie. 0% é a pior rolagem que a
                ${escapeHtml((r.label || '').toLowerCase())} permite, 100% é a melhor.<br>
                <b>2º gráfico:</b> o mesmo, medido na espécie inteira — da pior
                ${escapeHtml(((RARITIES.find(x => x.key === A.tierMenor) || {}).label || '').toLowerCase())}
                à melhor ${escapeHtml(((RARITIES.find(x => x.key === A.tierMaior) || {}).label || '').toLowerCase())}
                ${escapeHtml(A.shiny ? 'shiny' : '')}.<br>
                Qualidade, IV, natureza e gênero entram na nota, como no cálculo do PPTools.
            </p>
            <ul class="pp-rt-why">${explicar(A).map(t => `<li>${t}</li>`).join('')}</ul>
        </div>`;
    }

    function tipHtml(e) {
        const r = RARITIES.find(x => x.key === e.q) || RARITIES[0];
        const sp = e.sp && speciesIndex.get(e.sp);
        const nome = e.nome && e.nome !== e.sp ? e.nome : ((sp && sp.name) || prettify(e.nome || e.sp || '?'));
        const img = spriteDe(e);

        const nat = NATUREZAS[String(e.nat || '').toLowerCase()];
        const sobe = nat ? nat[1] : null;
        const desce = nat ? nat[2] : null;

        // Cada atributo traz o valor efetivo e o IV que o gerou, como no card
        // do jogo. A seta marca o que a natureza favorece ou prejudica.
        // Perdido é projetado para o nível de captura, senão o cartão mostraria
        // um selvagem nível 133 ao lado de capturas nível 1.
        const batExibido = batDe(e);
        const projetado = !!(e.lvl && e.lvl > NIVEL_CAPTURA && batExibido !== e.bat);
        // Quando a criatura não está no nível de captura e a projeção foi
        // recusada, dizer isso na tela em vez de mostrar o número do nível
        // do mapa como se fosse comparável. Mesma lição do analisador:
        // falha silenciosa custa horas de investigação.
        const semProjetar = !!(e.lvl && e.lvl > NIVEL_CAPTURA && !projetado);
        const stat = i => {
            if (!batExibido) return '';
            const seta = i === sobe ? '<b class="pp-rt-up">▲</b>'
                : i === desce ? '<b class="pp-rt-down">▼</b>' : '';
            const iv = e.det ? `${e.det[i]}<span class="pp-rt-ivmax">/${IV_STAT_MAX}</span>` : '—';
            return `<div class="pp-rt-bat">
                <span>${BAT_STATS[i]}${seta}</span>
                <b>${fmt(batExibido[i])}</b><i>${iv}</i>
            </div>`;
        };

        const atributos = batExibido
            ? BAT_ORDEM.map(([a, b]) => stat(a) + stat(b)).join('')
            : '<p class="pp-rt-tip-vazio">Sem dados desta captura.</p>';

        // Natureza neutra não é omitida: o jogo escreve "Sem efeito".
        const ganho = !nat ? ''
            : sobe === null
                ? `<div class="pp-rt-stat"><span>Ganho/perda</span>
                     <b class="pp-rt-neutro">Sem efeito</b></div>`
                : `<div class="pp-rt-stat"><span>Ganho/perda</span>
                     <b><span class="pp-rt-up">▲</span> ${BAT_NOMES[sobe]}
                        <span class="pp-rt-down">▼</span> ${BAT_NOMES[desce]}</b></div>`;

        const pctIv = Math.min((e.iv / IV_MAX) * 100, 100);

        // Onde o multiplicador caiu dentro da faixa da própria raridade:
        // mostra se o Pokémon é bom ou fraco para o tier dele.
        const faixa = e.mult ? faixaDe(e.q, e.shiny) : null;
        const pctFaixa = faixa && faixa.max > faixa.min
            ? Math.max(0, Math.min(((e.mult - faixa.min) / (faixa.max - faixa.min)) * 100, 100))
            : 0;

        return `
            <div class="pp-rt-tip-top">
                ${img ? `<img class="pp-rt-tip-sprite" src="${escapeHtml(img)}" alt="" />` : ''}
                <div class="pp-rt-tip-id">
                    <h3>${escapeHtml(nome)}</h3>
                    <div class="pp-rt-tip-tags">
                        ${e.lvl ? `<span class="pp-rt-tip-lvl">Nível ${fmt(e.lvl)}</span>` : ''}
                        <span class="pp-rt-badge" style="color:${r.color};font-size:10.5px;padding:2px 9px;
                              box-shadow: 0 0 8px ${r.color}4d, inset 0 0 8px ${r.color}1a;
                              text-shadow: 0 0 6px ${r.color}80;">${r.label}${
                                  e.mult ? ` ×${e.mult.toFixed(2)}` : ''}</span>
                        ${e.shiny ? '<span class="pp-rt-tip-shiny">Shiny</span>' : ''}
                    </div>
                </div>
            </div>

            <div class="pp-rt-tip-caixas">
                <div class="pp-rt-caixa">
                    <p>Poder total</p><b>${fmt(poderDe(e))}</b>
                </div>
                <div class="pp-rt-caixa">
                    <p>IV total</p><b>${fmt(e.iv)}<i>/${IV_MAX}</i></b>
                    <span class="pp-rt-iv-barra"><span style="width:${pctIv}%;background:${r.color}"></span></span>
                </div>
            </div>

            ${faixa ? `
            <div class="pp-rt-tip-caixas pp-rt-uma">
                <div class="pp-rt-caixa pp-rt-caixa--rar" style="border-color:${r.color}66">
                    <p>Raridade</p>
                    <b>×${e.mult.toFixed(2)} <i>/ ×${faixa.max.toFixed(2)}</i></b>
                    <span class="pp-rt-iv-barra"><span
                        style="width:${pctFaixa}%;background:${r.color}"></span></span>
                    <em>${e.shiny ? 'Shiny' : 'Normal'} · ${r.label} · faixa
                        ${faixa.min.toFixed(2).replace('.', ',')} –
                        ${faixa.max.toFixed(2).replace('.', ',')}</em>
                </div>
            </div>` : ''}

            ${analiseHtml(e)}

            <div class="pp-rt-tip-sec">
                <p class="pp-rt-tip-head">Atributos de batalha${projetado
                    ? ' <span class="pp-rt-fonte">— como seriam capturado (Nv. 1)</span>'
                    : semProjetar
                        ? ` <span class="pp-rt-fonte">— no Nv. ${fmt(e.lvl)}; sem projeção: ${escapeHtml(motivoProjecao || 'motivo desconhecido')}</span>`
                        : ''}</p>
                <div class="pp-rt-bat-grid">${atributos}</div>
            </div>

            <div class="pp-rt-tip-sec pp-rt-tip-gen">
                <p class="pp-rt-tip-head">Genética</p>
                <div class="pp-rt-stat"><span>Natureza</span>
                    <b>${escapeHtml(nat ? nat[0] : (e.nat || '—'))}</b></div>
                ${ganho}
                <div class="pp-rt-stat"><span>Gênero</span>
                    <b>${GENERO_NOME[e.gen] || '—'}</b></div>
                ${BONUS_GENERO[e.gen]
                    ? `<div class="pp-rt-stat"><span>Ganho/perda</span>
                         <b>${BONUS_GENERO[e.gen]}</b></div>`
                    : ''}
            </div>`;
    }

    function mostrarTip(linha) {
        const e = paginaAtual[Number(linha.dataset.i)];
        if (!e) return;

        els.tip.innerHTML = tipHtml(e);
        els.tip.classList.add('pp-on');

        const r = linha.getBoundingClientRect();
        const painel = els.panel.getBoundingClientRect();
        const w = els.tip.offsetWidth;
        const h = els.tip.offsetHeight;
        const folga = 12;

        // Ao lado do painel, no lado que couber; sem espaço em nenhum,
        // encosta na borda e sobrepõe o painel.
        const cabeDireita = painel.right + folga + w <= window.innerWidth - 6;
        const cabeEsquerda = painel.left - folga - w >= 6;

        let esquerda, topo;
        if (cabeDireita || cabeEsquerda) {
            esquerda = cabeDireita ? painel.right + folga : painel.left - folga - w;
            const meio = r.top + r.height / 2 - h / 2;
            topo = Math.max(6, Math.min(meio, window.innerHeight - h - 6));
        } else {
            // Sem espaço lateral: empilha acima ou abaixo do painel, nunca por
            // cima dele. Sobrepor esconde exatamente a linha que gerou o cartão.
            esquerda = Math.max(6, Math.min(painel.left, window.innerWidth - w - 6));
            const abaixo = painel.bottom + folga;
            topo = abaixo + h <= window.innerHeight - 6
                ? abaixo
                : Math.max(6, painel.top - folga - h);
        }

        els.tip.style.left = esquerda + 'px';
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
            // Toda tentativa vira captura ou perda: o resumo sai da subtração,
            // não da lista de perdidos (que tem teto e cobre só as últimas).
            const perd = Math.max(0, att - cap);
            // Bola do catálogo que nunca foi usada aparece com traços, não com zeros.
            const vazio = o.dashWhenEmpty && att === 0;
            return `
            <div class="pp-rt-row${o.extraClass || ''}">
                <span class="pp-rt-badge" style="color:${color};
                      box-shadow: 0 0 9px ${color}59, inset 0 0 9px ${color}1f;
                      text-shadow: 0 0 7px ${color}8c;">${o.icon || ''}${escapeHtml(label)}</span>
                <div class="pp-rt-num ${att ? '' : 'pp-rt-muted'}">${vazio ? '—' : fmt(att)}</div>
                <div class="pp-rt-num ${cap ? '' : 'pp-rt-muted'}" style="${cap ? 'color:#54d97c' : ''}">${vazio ? '—' : fmt(cap)}</div>
                <div class="pp-rt-num ${perd ? '' : 'pp-rt-muted'}" style="${perd ? 'color:#d98080' : ''}">${vazio ? '—' : fmt(perd)}</div>
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
            : view === 'lost' ? 'Registro de perdidos'
            : 'Capturas por raridade';

        // Filtros e paginação existem nas duas abas de registro.
        const ehRegistro = view === 'log' || view === 'lost';
        els.filters.classList.toggle('pp-on', ehRegistro);
        // Perdido não tem destino: o Pokémon fugiu, não foi vendido nem
        // guardado. O campo some e as quatro colunas restantes se esticam.
        els.filters.classList.toggle('pp-sem-destino', view === 'lost');
        els.pager.classList.toggle('pp-on', ehRegistro);

        // Cabeçalho das duas abas de contagem. Só o primeiro rótulo muda.
        // Era reconstruído apenas no ramo da raridade: vindo de Capturas ou
        // Perdidos, a aba Por pokébola herdava as colunas do registro.
        const cabecalho = primeira => {
            els.hrow.style.display = '';
            els.hrow.classList.remove('pp-rt-hrow--log');
            els.hrow.innerHTML = `<div id="pp-rt-h1">${primeira}</div><div>Tentativas</div>`
                + '<div>Capturas</div><div>Perdidos</div><div>Taxa de captura</div>';
            els.head1 = els.hrow.querySelector('#pp-rt-h1');
        };

        if (ehRegistro) {
            renderLog(view === 'lost');
        } else if (view === 'ball') {
            cabecalho('Pokébola');

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
            cabecalho('Raridade');

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
        // Um botão armado não pode ter o texto reescrito: o render roda a cada
        // evento do jogo, e sobrescrever aqui apagaria o "Confirmar?" no meio
        // do caminho — o clique seguinte pareceria não fazer nada.
        const arm = el => el && el.classList.contains('pp-rt-armado');
        if (!arm(els.reset)) els.reset.textContent = huntSel ? `Zerar ${huntSel.nome}` : 'Zerar tudo';
        if (els.del) {
            els.del.disabled = !huntSel;
            if (!arm(els.del)) els.del.textContent = huntSel ? `Excluir ${huntSel.nome}` : 'Excluir perfil';
            els.del.title = huntSel ? '' : 'Selecione uma hunt para excluir o perfil dela';
        }

        const nHunts = Object.keys(state.hunts).length;
        const aviso = nHunts
            ? ` · guarda ${fmt(HUNTS_CAP)} hunts; passando disso, sai a menos usada`
            : '';
        els.note.textContent = (totalAtt === 0
            ? 'Nenhuma pokébola registrada ainda. A conta começa quando a primeira for jogada.'
            : `Contando desde ${since}${aviso}`) + ` · v${VERSAO}`;

        const parts = [];
        if (!diag.connected) parts.push('WebSocket não detectado — recarregue a página');
        if (diag.gaps) parts.push(`${fmt(diag.gaps)} eventos perdidos na conexão`);
        if (recon.perdidas) parts.push(`${fmt(recon.perdidas)} tentativas contadas pelo jogo e não pela extensão`);

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
