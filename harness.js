// Roda o ARQUIVO PUBLICADO, não lógica copiada. Simula DOM, WebSocket,
// fetch e as APIs do Tampermonkey, e exercita as interceptações.
const fs = require('fs');
const { JSDOM } = require('jsdom');

const SRC = './pokepixel-rarity-tracker.user.js';
const code = fs.readFileSync(SRC, 'utf8');

// Script companheiro OPCIONAL (aviso no Discord). É o único arquivo do
// projeto que pode fazer requisição, e por isso tem regras próprias.
const SRC_DISCORD = './pokepixel-discord-alerta.user.js';
const codeD = fs.existsSync(SRC_DISCORD) ? fs.readFileSync(SRC_DISCORD, 'utf8') : null;

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://pokepixel.nietore.com/play/',
    pretendToBeVisual: true,
});
const win = dom.window;

// ---- payloads reais, tirados dos prints do jogo ----
const MACHAMP = {
    id: 'machamp', name: 'Machamp', elements: ['fighting'],
    base_stats: { hp: 90, atk: 130, def: 80, spa: 65, spd: 85, spe: 55 },
    catch_rate: 45, base_capture_chance: 17.65, is_starter: false,
    learn_moves: ['counter', 'mach-punch'],
    normal_sprite_url: '/assets/imported/creatures/machamp/front.png',
    shiny_sprite_url: '/assets/imported/creatures/machamp/shiny.png',
    dex_id: 68, is_legendary: false, is_mythical: false, shiny_available: true,
};
const DITTO = {
    id: 'ditto', name: 'Ditto', elements: ['normal'],
    base_stats: { hp: 48, atk: 48, def: 48, spa: 48, spd: 48, spe: 48 },
    normal_sprite_url: '/assets/imported/creatures/ditto/front.png',
    shiny_sprite_url: '/assets/imported/creatures/ditto/shiny.png',
};
const FORMULAS = {
    quality: {
        normal_quality_bands: [
            { label: 'weak', min: 0.0, max: 0.79 }, { label: 'common', min: 0.8, max: 1.09 },
            { label: 'uncommon', min: 1.1, max: 1.29 }, { label: 'rare', min: 1.3, max: 1.44 },
            { label: 'epic', min: 1.45, max: 1.54 }, { label: 'legendary', min: 1.55, max: 1.69 },
            { label: 'mythical', min: 1.7, max: 1.99 },
        ],
        shiny_quality_bands: [
            { label: 'epic', min: 1.7, max: 1.79 }, { label: 'legendary', min: 1.8, max: 1.99 },
            { label: 'mythical', min: 2.0, max: 2.2 },
        ],
        male_attack_bonus: 1.1, female_hp_bonus: 1.1,
        quality_iv_bands: {
            weak: { min: 6, max: 42 }, common: { min: 18, max: 60 },
            uncommon: { min: 48, max: 90 }, rare: { min: 78, max: 120 },
            epic: { min: 102, max: 144 }, legendary: { min: 126, max: 168 },
            mythical: { min: 144, max: 186 },
        },
    },
};

const INV_CRE = { id: 'cid-1', species_id: 'machamp', level: 100, quality: 'epic',
    quality_multiplier: 1.48, nature: 'adamant', gender: 'male', is_shiny: false,
    ivs: { hp: 20, atk: 31, def: 18, spa: 4, spd: 15, spe: 22 } };
// nível diferente de propósito: idênticas colidiriam no desempate por espécie
const MKT_CRE = { ...INV_CRE, id: 'c2', level: 55 };

// ---- fetch simulado: devolve o payload conforme a URL ----
const chamadas = [];
win.fetch = function (url) {
    const u = String(url && url.url ? url.url : url);
    chamadas.push(u);
    let corpo = { ok: true };
    if (/\/species\/machamp$/.test(u)) corpo = MACHAMP;
    else if (/\/species\/ditto$/.test(u)) corpo = DITTO;
    else if (/\/species$/.test(u)) corpo = { data: [MACHAMP, DITTO] };
    else if (/\/formulas$/.test(u)) corpo = FORMULAS;
    else if (/market\/listings/.test(u)) corpo = { data: [{ id: 'lst-1', creature: MKT_CRE }] };
    else if (/casino/.test(u)) corpo = { result: { prize: { creature: { ...INV_CRE, id: 'cas-1', level: 77 } } } };
    else if (/\/creatures/.test(u)) corpo = { data: [INV_CRE] };
    const res = { clone: () => ({ json: async () => corpo }), json: async () => corpo };
    return Promise.resolve(res);
};

class FakeWS {
    constructor(u) { this.url = u; this.readyState = 1; this.__listeners = []; }
    addEventListener(t, fn) { if (t === 'message' && fn) this.__listeners.push(fn); }
    removeEventListener() {} send() {} close() {}
}
FakeWS.OPEN = 1;
win.WebSocket = FakeWS;

// ---- armazenamento do Tampermonkey ----
const store = new Map();
let clipboard = null;
const menu = [];
const alerts = [];
const confirms = [];
let confirmarResposta = true;
const sandbox = {
    unsafeWindow: win, window: win, document: win.document,
    navigator: win.navigator, location: win.location,
    setTimeout: win.setTimeout.bind(win), clearTimeout: win.clearTimeout.bind(win),
    setInterval: win.setInterval.bind(win), clearInterval: win.clearInterval.bind(win),
    requestAnimationFrame: cb => win.setTimeout(cb, 0),
    getComputedStyle: el => win.getComputedStyle(el),
    MouseEvent: win.MouseEvent,
    console,
    GM_setValue: (k, v) => store.set(k, v),
    GM_getValue: (k, d) => (store.has(k) ? store.get(k) : d),
    GM_setClipboard: t => { clipboard = t; },
    GM_registerMenuCommand: (nome, fn) => { menu.push([nome, fn]); },
    // O script lê a versão daqui para mostrá-la no painel.
    GM_info: { script: { version: (code.match(/@version\s+(\S+)/) || [, '?'])[1] } },
    alert: msg => { alerts.push(String(msg)); },
    // O sandbox não tinha confirm, então os botões de zerar e excluir nunca
    // rodaram em teste: a chamada lançava ReferenceError e o handler morria
    // antes de fazer qualquer coisa. confirmarResposta controla o retorno.
    confirm: msg => { confirms.push(String(msg)); return confirmarResposta; },
    Blob: function (parts, opts) { this.parts = parts; this.type = opts && opts.type; },
    // Precisa ser o construtor DE VERDADE: safeImageUrl faz `new URL(...)`, e
    // um objeto só com createObjectURL fazia toda chamada lançar. O efeito era
    // silencioso e grave — nenhum sprite era renderizado nos testes, então
    // qualquer regressão de imagem passava batida. Os extras ficam anexados.
    URL: Object.assign(
        function (...a) { return Reflect.construct(URL, a); },
        { createObjectURL: () => 'blob:fake', revokeObjectURL: () => {} }),
};
sandbox.globalThis = sandbox;

const vm = require('vm');
vm.createContext(sandbox);

let erroCarga = null;
try { vm.runInContext(code, sandbox, { filename: SRC }); }
catch (e) { erroCarga = e; }

const ok = [];
const falhou = [];
const t = (nome, cond, extra) => (cond ? ok : falhou).push(nome + (extra ? ' — ' + extra : ''));

t('script carrega sem lançar', !erroCarga, erroCarga && erroCarga.message);

(async () => {
    // 1. o formato antigo (catálogo em lista) tem que continuar funcionando
    win.fetch('https://pokepixel.nietore.com/api/species');
    // 2. o formato novo: espécie individual, objeto solto
    win.fetch('https://pokepixel.nietore.com/api/species/machamp');
    win.fetch('https://pokepixel.nietore.com/api/species/ditto');
    // 3. formulas
    win.fetch('https://pokepixel.nietore.com/api/formulas');
    // 4. uma URL que NÃO pode ser confundida com species
    win.fetch('https://pokepixel.nietore.com/api/species-catalog/extra/deep');

    await new Promise(r => setTimeout(r, 300));

    const cache = store.get('pokepixel_species_cache_v1');
    t('cache de espécies foi persistido', !!cache);

    let parsed = null;
    try { parsed = JSON.parse(cache); } catch (e) {}
    t('cache é JSON válido', !!parsed);
    t('machamp indexado', !!(parsed && parsed.machamp), parsed && Object.keys(parsed).join(','));
    t('base_stats do machamp guardados',
        !!(parsed && parsed.machamp && parsed.machamp.base && parsed.machamp.base.atk === 130),
        parsed && parsed.machamp && JSON.stringify(parsed.machamp.base));
    t('ditto indexado com base 48',
        !!(parsed && parsed.ditto && parsed.ditto.base && parsed.ditto.base.hp === 48));
    t('sprite preservado',
        !!(parsed && parsed.machamp && /machamp\/front\.png$/.test(parsed.machamp.sprite || '')));

    // monta um DOM parecido com um card de inventário, com texto longo junto
    const painel = win.document.createElement('div');
    painel.id = 'inv-panel';
    painel.setAttribute('data-panel', 'inventory');
    painel.style.width = '600px'; painel.style.height = '400px';
    painel.innerHTML = '<div class="creature-card" data-creature-id="abc-123">'
      + '<span class="lvl">Nv. 101</span><span class="q">Épica</span>'
      + '<p class="msg">esta é uma mensagem bem comprida que nao pode vazar na captura de jeito nenhum</p>'
      + '</div>';
    win.document.body.appendChild(painel);
    painel.getBoundingClientRect = () => ({ left: 0, top: 0, right: 600, bottom: 400, width: 600, height: 400 });
    for (const el of painel.querySelectorAll('*'))
        el.getBoundingClientRect = () => ({ left: 0, top: 0, right: 100, bottom: 40, width: 100, height: 40 });

    const capt = menu.find(m => /capturar/i.test(m[0]));
    let telaOk = false, vazou = true;
    if (capt) {
        alerts.length = 0;
        capt[1]();
        const dumpT = menu.find(m => /copiar/i.test(m[0]));
        const pk = clipboard ? JSON.parse(clipboard) : null;
        const txt = JSON.stringify(pk && pk.telas || []);
        telaOk = /data-creature-id/.test(txt) && /abc-123/.test(txt);
        vazou = /vazar na captura/.test(txt);
        t('captura NÃO leva o texto livre junto', !vazou, vazou ? 'VAZOU' : 'redigido');
    }

    // ---- telas do jogo: inventário, market e chat ----
    const D = win.document;
    const mk = (html) => { const d = D.createElement('div'); d.innerHTML = html; D.body.appendChild(d); return d; };
    const rect = (el, r) => { el.getBoundingClientRect = () => r; };

    const CRE = INV_CRE;
    win.fetch('https://pokepixel.nietore.com/api/v1/creatures');
    win.fetch('https://pokepixel.nietore.com/api/v1/market/listings');
    await new Promise(r => setTimeout(r, 200));

    const inv = mk('<button class="inventory-slot inventory-slot--pokemon" data-creature-id="cid-1"><span>x</span></button>');
    const slot = inv.querySelector('button');
    rect(slot, { left: 300, right: 380, top: 200, bottom: 280, width: 80, height: 80 });

    // tooltip do jogo, encostado no slot, para testar o "nunca sobrepor"
    const tip = D.createElement('div');
    tip.className = 'game-tooltip'; tip.style.position = 'fixed';
    D.body.appendChild(tip);
    rect(tip, { left: 385, right: 625, top: 190, bottom: 430, width: 240, height: 240 });

    const card = () => D.getElementById('pp-rt-gtip');
    const disparaMouse = (el, tipo, rel) => {
        const ev = new win.MouseEvent(tipo, { bubbles: true });
        if (rel) Object.defineProperty(ev, 'relatedTarget', { value: rel });
        el.dispatchEvent(ev);
    };

    disparaMouse(slot, 'mouseover');
    await new Promise(r => setTimeout(r, 60));
    const c1 = card();
    t('cartão aparece no slot do inventário', !!c1 && c1.classList.contains('pp-on'));
    t('cartão do jogo usa a MESMA caixa do tooltip da extensão',
        /#pp-rt-tip,\s*#pp-rt-gtip\s*{/.test(code) && /#pp-rt-tip\.pp-on,\s*#pp-rt-gtip\.pp-on/.test(code));
    t('não sobra style inline duplicando o CSS', !!c1 && !c1.style.position);
    t('cartão traz as duas pizzas', !!c1 && (c1.innerHTML.match(/pp-rt-pz/g) || []).length >= 2);
    t('cartão traz a explicação', !!c1 && /pp-rt-why/.test(c1.innerHTML));

    if (c1) {
        Object.defineProperty(c1, 'offsetWidth', { value: 260, configurable: true });
        Object.defineProperty(c1, 'offsetHeight', { value: 300, configurable: true });
        disparaMouse(slot, 'mouseout', null);
        
        disparaMouse(slot, 'mouseover');
        await new Promise(r => setTimeout(r, 60));
        const x = parseInt(c1.style.left, 10);
        const lwT = parseInt(c1.style.width, 10) || 470;
        t('não sobrepõe o tooltip do jogo', x + lwT <= 385 || x >= 625,
            `cartão ${x}..${x + lwT} vs tooltip 385..625`);
        t('não usa fallback vertical: fica na horizontal', parseInt(c1.style.top, 10) < 500);
    }

    // cartão do jogo enorme e centralizado: tem que ir para o lado maior, encolhendo
    {
        const big = D.createElement('div');
        big.className = 'game-card-grande'; big.style.position = 'fixed';
        D.body.appendChild(big);
        rect(big, { left: 355, right: 730, top: 100, bottom: 900, width: 375, height: 800 });
        rect(slot, { left: 500, right: 560, top: 400, bottom: 460, width: 60, height: 60 });
        disparaMouse(D.body, 'mouseover');   // sai da âncora para forçar re-medição
        disparaMouse(slot, 'mouseover');
        await new Promise(r => setTimeout(r, 60));
        const c = card();
        const x = parseInt(c.style.left, 10);
        const larg = parseInt(c.style.width, 10) || 260;
        t('não sobrepõe o card grande do jogo', x + larg <= 355 || x >= 730,
            `cartão ${x}..${x + larg} vs card 355..730`);
        t('estreita em vez de ir para cima/baixo', parseInt(c.style.top, 10) < 900);
        t('NUNCA usa scale: a fonte não encolhe', !/scale/.test(c.style.transform || ''),
            c.style.transform || 'none');
        t('o código não contém mais scale() no posicionamento',
            !/style\.transform = `scale/.test(code));
        t('a largura é definida em px pelo código', /^\d+px$/.test(c.style.width || ''), c.style.width || 'vazio');
        t('largura nunca abaixo do mínimo legível', larg >= 236, larg + 'px');
        t('cartão usa a largura ideal maior quando cabe', /LARG_IDEAL = 470/.test(code));
        t('pizzas maiores no código', /width="118" height="118"/.test(code));
        t('teto do mercado deixou de ser 400', /anuncios: 6000/.test(code) && !/CAP_MAPA/.test(code));
        t('usa elementsFromPoint para achar painel fundo na árvore', /elementsFromPoint/.test(code));
        t('coberturas entram nos obstáculos', /flutuantes\(\)\.concat\(coberturas\(base, ancora\)\)/.test(code));
        t('suporta o card da equipe', /SEL_TIME = '\.pokeidle-team-card/.test(code));
        t('só casa a equipe quando a contagem bate', /cheios\.length === equipe\.length/.test(code));
        t('colhe criatura de qualquer resposta', /function colher\(v, prof\)/.test(code)
            && /p\.then\(res => res\.clone\(\)\.json\(\)\)\.then\(b => \{ colher\(b, 0\); \}\)/.test(code));
        t('varre a faixa horizontal inteira', /function coberturas\(base, ancora\)/.test(code)
            && /painelRaiz/.test(code));
        t('pizzas empilham em vez de cortar', /flex-wrap: wrap/.test(code)
            && /max-width: 100%; height: auto/.test(code));
        t('piso de largura subiu', /LARG_PISO = 300/.test(code) && /LARG_EMERG = 248/.test(code));
        t('varre a árvore inteira, não só 2 níveis', /fila\.length && n < 8000/.test(code));
        t('não depende de pointer-events (sem elementsFromPoint no flutuantes)',
            /Varredura da árvore inteira/.test(code));
        t('resolve criatura por qualquer atributo', /function porQualquerAtributo/.test(code));
        t('conhece a classe real do cartão do jogo', /\.pokemon-tooltip-card/.test(code));
        t('identifica pela carta do jogo quando o slot não tem id', /function pelaCartaDoJogo/.test(code));
        t('equipe cai no reconhecimento pela carta quando a contagem não bate',
            /if \(ok\) return \{ c: equipe\[i\]/.test(code) && /const porCarta = pelaCartaDoJogo\(\)/.test(code));
        t('confere nível do slot contra o cartão aberto', /pelaCarta\.nivel === nvSlot/.test(code));
        t('legenda usa 1º/2º gráfico, não esquerda/direita',
            /1º gráfico:/.test(code) && /2º gráfico:/.test(code)
            && !/<b>Esquerda:<\/b>/.test(code) && !/<b>Direita:<\/b>/.test(code));
        t('legenda usa 1º/2º gráfico, não esquerda/direita',
            /1º gráfico/.test(code) && /2º gráfico/.test(code)
            && !/<b>Esquerda:<\/b>/.test(code) && !/<b>Direita:<\/b>/.test(code));
        t('cassino conta normalmente, em categoria própria',
            /label: 'Cassino Eevee'/.test(code)
            && /src\.captured_zone === 'npc-cassino'\)\s*\n\s*\? 'cassino'/.test(code)
            && !/deCacada/.test(code));
        t('a categoria do cassino nunca casa por texto de bola', /match: \/\(\?!\)\//.test(code));
        t('cassino tem ícone próprio desenhado, não bola genérica',
            /art: 'eevee'/.test(code) && /const ICONE_EEVEE/.test(code)
            && /b\.art === 'eevee' \? ICONE_EEVEE/.test(code));
        t('ícone da Eevee não herda o miolo branco da pokébola',
            /\.pp-rt-ball\.pp-rt-ball--art::after \{ content: none; display: none; \}/.test(code));
        t('regra do ícone vem DEPOIS da regra base (a última vence no empate)',
            code.indexOf('.pp-rt-ball.pp-rt-ball--art::after') > code.indexOf('.pp-rt-ball::after {'));
        t('nota segue o modelo do PPTools (qualidade, IV, natureza e gênero)',
            /function somaSimples\(base, ivs, natSobe, natDesce, gen, mult, shiny\)/.test(code)
            && /function tetoNota\(base, tier, shiny\)/.test(code)
            && /function pisoNota\(base, tier, shiny\)/.test(code)
            && !/function notaCrua/.test(code));
        t('natureza e gênero saíram da nota e viraram recomendação',
            /pp-rt-rec/.test(code) && /Natureza neutra: não altera atributo nenhum/.test(code));
        t('texto de dano não chama metade de inútil',
            /Ataca dos <b>dois lados<\/b>/.test(code) && /IV nos dois conta/.test(code));
        t('nenhum andaime de depuração no arquivo final',
            !/ppDump|raioX|capturarTela|registrarSlotMiss|GM_registerMenuCommand|GM_setClipboard|TEMPOR/.test(code));
        t('auto-update religado', /@downloadURL\s+https:\/\/raw\.githubusercontent/.test(code)
            && /@updateURL\s+https:\/\/raw\.githubusercontent/.test(code));
        t('versão 7.15.2 sem sufixo debug', /\/\/ @version\s+7\.15\.2\s*$/m.test(code));
        t('o principal anuncia a captura sem fazer requisição',
            /const EVENTO_CAPTURA = 'pokepixel-raridades:captura';/.test(code)
            && /W\.dispatchEvent\(new W\.CustomEvent\(EVENTO_CAPTURA/.test(code)
            && /anunciarCaptura\(state\.log\[0\]\);/.test(code));
        t('o script companheiro existe e é um arquivo à parte', !!codeD,
            codeD ? '' : 'pokepixel-discord-alerta.user.js não encontrado');
        // Comentários mencionam "@connect" e "WebSocket" ao explicar o que o
        // arquivo NÃO faz. Testar o texto cru dava falso positivo, então aqui
        // o código vai sem comentários e o cabeçalho é lido à parte.
        const semComentarios = x => String(x || '')
            .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ');
        const metaD = codeD ? (codeD.match(/==UserScript==[\s\S]*?==\/UserScript==/) || [''])[0] : '';
        const conexoes = (metaD.match(/^\/\/ @connect\s+(\S+)/gm) || [])
            .map(l => l.replace(/^\/\/ @connect\s+/, ''));
        const corpoD = semComentarios(codeD);
        t('o companheiro só pode falar com o Discord',
            conexoes.length === 1 && conexoes[0] === 'discord.com', conexoes.join(', ') || 'nenhum @connect');
        t('o companheiro NUNCA fala com o servidor do jogo',
            !!codeD && !/pokepixel\.nietore\.com\/api/.test(corpoD));
        t('o companheiro recusa webhook que não seja do Discord',
            !!codeD && /function webhookValido/.test(corpoD)
            && /u\.protocol === 'https:'/.test(corpoD)
            && /return webhookValido\(url\) \? url : '';/.test(corpoD)
            && /if \(!webhookDe\(d\.conta\)\) return;/.test(corpoD)
            && /if \(!mapa\[PADRAO\] && webhookValido\(antigo\)\)/.test(corpoD));
        t('o companheiro não lê o jogo por conta própria (só escuta o evento)',
            !!codeD && !/\bfetch\s*\(/.test(corpoD) && !/WebSocket/.test(corpoD)
            && !/XMLHttpRequest/.test(corpoD.replace(/GM_xmlhttpRequest/g, ''))
            && /W\.addEventListener\(EVENTO,/.test(corpoD));
        t('o principal anuncia qual conta está na aba',
            /const EVENTO_CONTA = 'pokepixel-raridades:conta';/.test(code)
            && /W\.dispatchEvent\(new W\.CustomEvent\(EVENTO_CONTA/.test(code));
        t('o companheiro guarda um webhook por conta, com padrão de reserva',
            !!codeD && /const PADRAO = '\*';/.test(corpoD)
            && /function webhookDe\(conta\)/.test(corpoD)
            && /const url = \(conta && mapa\[conta\]\) \|\| mapa\[PADRAO\] \|\| '';/.test(corpoD));
        t('o destino viaja na fila (duas contas não trocam de canal)',
            !!codeD && /fila\.push\(\{ corpo, url: webhookDe\(conta\) \}\);/.test(corpoD));
        t('o companheiro se configura por interface, sem console',
            !!codeD && /GM_registerMenuCommand\('Aviso Discord: configurar', abrirUi\)/.test(corpoD));
        t('o webhook não fica à mostra na tela por padrão',
            !!codeD && /id="ppd-hook" type="password"/.test(corpoD)
            && /id="ppd-hook-padrao" type="password"/.test(corpoD));
        t('continua sem requisição própria', !/\bfetch\s*\(/.test(code.replace(/W\.fetch|origFetch|window\.fetch/g,''))
            && !/XMLHttpRequest/.test(code) && !/\.send\(/.test(code));
        t('criaturas do WebSocket são indexadas (oferta do outro jogador)',
            /if \(type && !EVENTOS_SEM_CRIATURA\.has\(type\)\)/.test(code)
            && /const EVENTOS_SEM_CRIATURA = new Set/.test(code));
        t('eventos de alta frequência ficam fora da colheita',
            /'combat\.hit', 'loot\.received'/.test(code));
        t('identificação pelo cartão não depende de lista de telas',
            /function pareceSlotDePokemon/.test(code)
            && /pareceSlotDePokemon\(alvo\)/.test(code));
        t('criatura é montada a partir do cartão do jogo',
            /function lerCartaDoJogo/.test(code) && /RE_LINHA_IV/.test(code)
            && /const soma = det\.reduce\(\(a, b\) => a \+ b, 0\);/.test(code)
            && /if \(soma !== ivTot\)/.test(code));
        t('sem cartão aberto o diagnóstico cala (mapa de caçadas)',
            /const SEM_CARTA = 'o jogo não abriu o cartão de detalhes';/.test(code)
            && /motivoCarta === SEM_CARTA\) \{ esconderJogo\(\); return; \}/.test(code)
            && (code.match(/o jogo não abriu o cartão de detalhes/g) || []).length === 1);
        t('a extensão diz na tela por que não identificou',
            /let motivoCarta = null;/.test(code)
            && /Indisponível: \$\{escapeHtml\(motivoCarta/.test(code)
            && /espécie do título não reconhecida/.test(code));
        t('parser aceita interface em português e em inglês',
            /N\[ÍI\]VEL\|LEVEL/.test(code) && /'SPATK'/.test(code) && /'SPDEF'/.test(code));
        t('resumo por raridade mostra Perdidos ao lado de Capturas',
            /<div>Capturas<\/div><div>Perdidos<\/div><div>Taxa de captura<\/div>/.test(code)
            && /const perd = Math\.max\(0, att - cap\);/.test(code)
            && /grid-template-columns: 1\.4fr \.75fr \.75fr \.75fr 1\.55fr/.test(code));
        t('o resumo vem da subtração, não da lista com teto',
            !/state\.perdidos\.length\s*\)/.test(code.slice(code.indexOf('const row = ('),
                                                            code.indexOf('const extras'))));
        t('as duas abas de contagem montam o MESMO cabeçalho',
            (code.match(/const cabecalho = primeira =>/g) || []).length === 1
            && /cabecalho\('Pokébola'\)/.test(code) && /cabecalho\('Raridade'\)/.test(code));
        t('análise vale nas duas abas de registro',
            /if \(view !== 'log' && view !== 'lost'\) return;/.test(code));
        t('a chance usa a fórmula da wiki, não só a base da espécie',
            /const CAP_DIFICULDADE = 0\.3;/.test(code)
            && /const CAP_ESCALA_NIVEL = 0\.012;/.test(code)
            && /const penNivel = 1 \/ \(1 \+ nivel \* CAP_ESCALA_NIVEL\);/.test(code)
            && /base \* bola \* penNivel \* CAP_DIFICULDADE \* penQual/.test(code));
        t('a penalidade por qualidade bate com a tabela do jogo',
            /weak: 1, common: 1, uncommon: 0\.95, rare: 0\.6,/.test(code)
            && /epic: 0\.09, legendary: 0\.009, mythical: 0\.0009,/.test(code));
        t('cada cápsula tem seu multiplicador',
            /poke: 1, great: 2, super: 3, ultra: 4, pixel: 5,/.test(code)
            && /\[\/master\/i, 255\]/.test(code));
        t('shiny e o piso do jogo entram na conta',
            /const CAP_MULT_SHINY = 0\.00001;/.test(code)
            && /const CAP_PISO = 0\.01;/.test(code)
            && /\* \(e\.shiny \? CAP_MULT_SHINY : 1\);/.test(code)
            && /Math\.min\(CAP_TETO, Math\.max\(CAP_PISO, pct\)\)/.test(code));
        t('falta de peça vira traço, não produto pela metade',
            /if \(bola === null\) return null;/.test(code)
            && /if \(!\(nivel > 0\)\) return null;/.test(code)
            && /if \(penQual === undefined\) return null;/.test(code));
        t('o nível do selvagem é gravado também na captura',
            /lvlSel: Number\(ultimoInimigo && ultimoInimigo\.level\) \|\| 0,/.test(code)
            && /lvlSel: safeCount\(e\.lvlSel\),/.test(code));
        t('a chance vira COLUNA na linha, não seção do cartão',
            /<div>Pokébola<\/div><div>Chance<\/div>/.test(code)
            && /<span class="pp-rt-cap-chance">/.test(code)
            && !/function chanceHtml/.test(code));
        t('a coluna Chance não ganhou filtro',
            !/pp-rt-f-chance/.test(code)
            && (code.match(/id="pp-rt-f-/g) || []).length === 6);
        t('a grade das linhas foi para oito colunas',
            /grid-template-columns: 1\.45fr \.82fr \.68fr \.82fr \.85fr \.92fr \.7fr \.78fr;/.test(code));
        t('espécie sem dado mostra traço, não zero',
            /if \(ch === null\) return '<i>—<\/i>';/.test(code));
        t('mítica não vira 0,00% por falta de casas decimais',
            /const casas = ch >= 1 \? 2 : ch >= 0\.01 \? 3 : 5;/.test(code)
            && /String\(Number\(ch\.toFixed\(casas\)\)\)/.test(code));
        t('lendário, mítico e shiny não disputam vaga com os comuns',
            /const LOST_KEEP = 1000;/.test(code)
            && /const perdidoNotavel = e => !!e && \(e\.shiny \|\| e\.q === 'legendary' \|\| e\.q === 'mythical'\);/.test(code)
            && /if \(perdidoNotavel\(e\)\) \{ if \(notaveis\+\+ < LOST_KEEP\) out\.push\(e\); \}/.test(code)
            && /else if \(comuns\+\+ < LOST_CAP\) out\.push\(e\);/.test(code));
        t('a poda também vale ao carregar o estado gravado',
            /limpo\.perdidos = podarPerdidos\(/.test(code)
            && /\.slice\(0, LOST_CAP \+ LOST_KEEP\)/.test(code));
        t('perdidos comuns têm teto de 500 e são gravados como as capturas',
            /const LOST_CAP = 500;/.test(code)
            && /state\.perdidos = podarPerdidos\(state\.perdidos\);/.test(code)
            && /limpo\.log = limparLista\(value\.log, LOG_CAP\);/.test(code));
        t('capturas e perdidos usam a MESMA sanitização (não podem divergir)',
            (code.match(/const limparEntrada = e => \(\{/g) || []).length === 1
            && /limpo\.log = limparLista\(value\.log, LOG_CAP\);/.test(code));
        t('zerar ou excluir uma hunt também limpa os perdidos dela',
            (code.match(/state\.perdidos = state\.perdidos\.filter\(e => e\.h !== perfilAtivo\);/g) || []).length === 2);
        t('inimigo é retido ANTES do dedupe do combat.started',
            code.indexOf('ultimoInimigo = enemy;') < code.indexOf('if (seenCombat.has(key)) return;'));
        t('perdido não inventa Pokémon quando o inimigo retido é de outro combate',
            /markQuality\(ultimoInimigo\.quality\) === rarity/.test(code));
        t('natureza é lida também pelo rótulo em português, não só pela chave em inglês',
            /const rot = semAcento\(\(NATUREZAS\[nome\] \|\| \[\]\)\[0\] \|\| ''\);/.test(code)
            && /const alvos = rot \? \[nome, rot\] : \[nome\];/.test(code)
            && /const semAcento = s => String\(s\)\.normalize\('NFD'\)/.test(code));
        t('multiplicador exato vem do índice quando o exemplar está lá',
            /function exataDoIndice\(spId, det, shiny, mu\)/.test(code)
            && /const exemplar = exataDoIndice\(spId, det, shiny, mu\);/.test(code)
            && /const mult = exemplar \? Number\(exemplar\.quality_multiplier\) : mu;/.test(code)
            && /casa2\(exato\) !== casa2\(mu\)/.test(code));
        t('id sintético da carta usa o multiplicador já resolvido (atualiza quando o índice chega)',
            /id: `carta:\$\{spId\}:\$\{lv\}:\$\{mult\}:\$\{ivTot\}`/.test(code)
            && !/id: `carta:\$\{spId\}:\$\{lv\}:\$\{mu\}:\$\{ivTot\}`/.test(code));
        t('IVs são lidos pelo padrão do valor, não pelo rótulo isolado',
            /RE_LINHA_IV/.test(code) && /function ivsDoTexto/.test(code)
            && /rot\.endsWith\(sf\)/.test(code));
        t('tier vem da faixa do multiplicador, não do rótulo traduzido',
            /function tierPeloMult/.test(code));
        t('âncora aceita card largo, não só slot de grade',
            /const LARG_ANCORA = 480/.test(code)
            && !/r\.width > 320 \|\| r\.height > 320/.test(code)
            && !/r\.width <= 260/.test(code));
        t('cartão do jogo vira âncora quando não há slot (mapa/canvas)',
            /alvo\.tagName === 'CANVAS'/.test(code) && /const semSlot/.test(code));
        t('spawns shiny contados são gravados', /shinySeen: \[\]/.test(code)
            && /state\.shinySeen\.indexOf\(key\) >= 0/.test(code)
            && /limpo\.shinySeen = Array\.isArray/.test(code));
        t('lista de shinies tem teto', /SHINY_SEEN_CAP = 400/.test(code)
            && /state\.shinySeen\.shift\(\)/.test(code));
        t('escala normalizada pela faixa do tier',
            /const normaliza = \(v, piso, teto\)/.test(code)
            && /pctTier: normaliza\(atual, tTier\.piso, tTier\.teto\)/.test(code));
        t('2º gráfico normalizado na espécie inteira',
            /pctEsp: normaliza\(atual, pior\.piso, melhor\.teto\)/.test(code));
        t('tabela shiny não assume que começa na Fraca', /function tiersDaTabela/.test(code));
        t('afirmações não confiáveis removidas do cartão',
            !/IV rende mais em/.test(code) && !/Gênero <b>ideal<\/b>/.test(code)
            && !/Natureza ideal seria/.test(code) && !/Gênero ideal seria/.test(code));
        t('gênero é descrito pelo efeito, sem eleger o melhor',
            /Macho: \+10% em Ataque e Atq\. Esp\./.test(code) && /Fêmea: \+10% em HP/.test(code));
        t('shiny marcado no rótulo e na legenda do 1º gráfico',
            /'entre as ' \+ \(r\.label \|\| ''\)\.toLowerCase\(\) \+ 's' \+ \(A\.shiny \? ' shiny' : ''\)/.test(code)
            && /\$\{escapeHtml\(A\.shiny \? ' shiny' : ''\)\}/.test(code));
        t('o IV por atributo tem contraste de leitura, não de rodapé',
            /\.pp-rt-bat > i \{[^}]*color: #cfcfda[^}]*font-weight: 600/.test(code)
            && !/\.pp-rt-bat > i \{[^}]*color: #55555f/.test(code)
            && /\.pp-rt-bat > i \.pp-rt-ivmax \{ color: #6c6c78/.test(code)
            && /\$\{e\.det\[i\]\}<span class="pp-rt-ivmax">\/\$\{IV_STAT_MAX\}<\/span>/.test(code));
        t('o cartão credita o PPTools ao lado do título',
            /Análise <span class="pp-rt-fonte">— dados de acordo com o PPTools<\/span>/.test(code)
            && /\.pp-rt-tip-head \.pp-rt-fonte \{[^}]*text-transform: none/.test(code));
        t('o crédito NÃO aparece quando não há análise para creditar',
            (code.match(/pp-rt-tip-head">Análise<\/p>/g) || []).length === 2);
        t('legenda diz que qualidade, IV, natureza e gênero entram na nota',
            /Qualidade, IV, natureza e gênero entram na nota, como no cálculo do PPTools\./.test(code));
        t('não sobrou explicar duplicado nem A\.teto',
            (code.match(/function explicar\(/g) || []).length === 1 && !/A\.teto\./.test(code));
        t('busca do teto continua na lista sem repetição', /for \(const \[sobe, desce\] of PARES_NAT\)/.test(code));
        t('filtro de Pokémon existe no registro',
            /id="pp-rt-f-sp"/.test(code) && /fSp: overlay\.querySelector\('#pp-rt-f-sp'\)/.test(code)
            && /\(!selSp\.size \|\| selSp\.has\(e\.sp\)\)/.test(code));
        t('espécie e raridade aceitam várias marcações ao mesmo tempo',
            /const selSp = new Set\(\);/.test(code) && /const selQ = new Set\(\);/.test(code)
            && /\(!selQ\.size \|\| selQ\.has\(e\.q\)\)/.test(code)
            && /function montarCaixas\(pop, itens, sel\)/.test(code));
        t('conjunto vazio quer dizer TODAS, não nenhuma',
            /cb\.checked = cb\.value === '' \? sel\.size === 0 : sel\.has\(cb\.value\);/.test(code)
            && /if \(cb\.value === ''\) \{ {10}\/\/ "Todas": limpa a seleção/.test(code));
        t('espécie que sai da lista sai da seleção junto',
            /for \(const id of \[\.\.\.selSp\]\) if \(ids\.indexOf\(id\) < 0\) selSp\.delete\(id\);/.test(code));
        t('filtro de espécie acompanha o perfil de hunt ativo',
            /if \(perfilAtivo && e\.h !== perfilAtivo\) continue;/.test(code));
        t('painel de espécie não é reconstruído à toa (não perde a marcação)',
            /if \(pop\.__ppSig !== assinatura\) \{/.test(code));
        t('a versão aparece no painel, para dar para conferir sem sair do jogo',
            /const VERSAO = \(\(\) => \{/.test(code)
            && /GM_info\.script\.version/.test(code)
            && /` · v\$\{VERSAO\}`/.test(code)
            && /@grant\s+GM_info/.test(code));
        t('a grade de filtros ganhou a sexta coluna',
            /grid-template-columns: 1\.15fr 1fr \.68fr \.68fr \.8fr \.85fr/.test(code));
        t('reconcilia por incremento, não por total',
            /const dJogo = gAtt - recon\.jogoAtt, dExt = eAtt - recon\.extAtt/.test(code));
        t('ramo /team duplicado removido',
            (code.match(/\/team\(\\\?\|\$\)/g) || []).length === 1);
        t('rodapé avisa quando o jogo contou mais que a extensão',
            /contadas pelo jogo e não pela extensão/.test(code));
        t('pizza usa pathLength=100 (dasharray vale em % real)', /pathLength="100"/.test(code));
        t('pizza compensa a sobra das pontas arredondadas',
            /const PZ_CAP = 100 \* PZ_W \/ \(2 \* Math\.PI \* PZ_R\)/.test(code)
            && /Math\.max\(0\.6, v - PZ_CAP\)/.test(code));
        t('badge de nível exigido só nas grades', /const emGrade = /.test(code)
            && /if \(emGrade && nvSlot === null\) return null;/.test(code));
        t('largura padrão derivada da janela', /const sempreCabe = Math\.floor/.test(code));
        t('reidentifica pelo cartão do jogo enquanto o mouse fica parado',
            /if \(idNovo && idNovo !== gChave\)/.test(code));
        t('cobre Poké Centro, Cassino e HUD da equipe', /pokecentro-slot-grid/.test(code)
            && /npc-casino-reveal-card/.test(code) && /pokeidle-team-hud/.test(code));
        const cr = { left: parseInt(c.style.left,10), top: parseInt(c.style.top,10) };
        cr.right = cr.left + parseInt(c.style.width,10); cr.bottom = cr.top + 300;
        const bigR = { left:355, right:730, top:100, bottom:900 };
        const cruzaT = (a,b) => a.left<b.right && a.right>b.left && a.top<b.bottom && a.bottom>b.top;
        t('NÃO cruza o painel do jogo', !cruzaT(cr,bigR),
            `cartao ${cr.left}-${cr.right} vs painel 355-730`);
        big.remove();

        // painel do jogo LONGE da âncora: antes passava despercebido
        const longe = D.createElement('div');
        longe.className = 'game-detail'; longe.style.position = 'fixed';
        D.body.appendChild(longe);
        rect(longe, { left: 300, right: 800, top: 60, bottom: 700, width: 500, height: 640 });
        rect(slot, { left: 120, right: 180, top: 640, bottom: 700, width: 60, height: 60 });
        disparaMouse(D.body, 'mouseover');
        disparaMouse(slot, 'mouseover');
        await new Promise(r => setTimeout(r, 60));
        const c2 = card();
        const r2 = { left: parseInt(c2.style.left,10), top: parseInt(c2.style.top,10) };
        r2.right = r2.left + parseInt(c2.style.width,10); r2.bottom = r2.top + 300;
        t('evita painel distante da âncora (o bug dos prints)',
            !cruzaT(r2, { left:300, right:800, top:60, bottom:700 }),
            `cartao ${r2.left}-${r2.right} vs painel 300-800`);
        longe.remove();
    }

    const mkt = mk('<article class="market-listing kind-pokemon" data-listing-id="lst-1"><b>x</b></article>');
    const art = mkt.querySelector('article');
    rect(art, { left: 100, right: 400, top: 100, bottom: 160, width: 300, height: 60 });
    disparaMouse(art, 'mouseover');
    await new Promise(r => setTimeout(r, 60));
    t('cartão aparece no anúncio do market', !!card() && card().classList.contains('pp-on'));

    // chat: dois links na mesma linha, para conferir o casamento por índice
    disparaMouse(slot, 'mouseout', null);
    const ev2 = { data: JSON.stringify({ type: 'chat.message', seq: 999999, data: {
        id: 'msg-1', item_links: [
            { ...CRE, source_species_id: 'ditto', species_id: null, quality: 'common', quality_multiplier: 1.02 },
            { ...CRE, source_species_id: 'machamp', species_id: null, quality: 'legendary', quality_multiplier: 1.6 }] } }) };
    const WSc = win.WebSocket;
    const sk = new WSc('wss://pokepixel.nietore.com/ws?token=x');
    (sk.__listeners || []).forEach(fn => fn(ev2));
    const ch = mk('<div class="pokeidle-persistent-chat__line" data-message-key="msg-1">'
        + '<button class="pokeidle-persistent-chat__item-link">[A]</button>'
        + '<button class="pokeidle-persistent-chat__item-link">[B]</button></div>');
    const bts = ch.querySelectorAll('button');
    bts.forEach(b => rect(b, { left: 50, right: 110, top: 500, bottom: 520, width: 60, height: 20 }));
    disparaMouse(bts[1], 'mouseover');
    await new Promise(r => setTimeout(r, 60));
    const ch2 = card();
    t('cartão aparece no Pokémon marcado no chat', !!ch2 && ch2.classList.contains('pp-on'));
    t('casa o 2º botão com o 2º item_link (lendária, não comum)',
        !!ch2 && /1,6|1\.6/.test(ch2.innerHTML), ch2 ? 'multiplicador do 2º link' : 'sem cartão');

    disparaMouse(bts[1], 'mouseout', null);
    t('não some no ato (deixa o tooltip do jogo abrir)', !!card() && card().classList.contains('pp-on'));
    await new Promise(r => setTimeout(r, 480));
    t('esconde depois do atraso', !!card() && !card().classList.contains('pp-on'));

    // criatura vinda de endpoint que eu nunca tratei explicitamente
    win.fetch('https://pokepixel.nietore.com/api/v1/casino/eevee/buy');
    await new Promise(r => setTimeout(r, 120));
    {
        const pc = mk('<div class="poke-centro-slot" data-creature-id="cas-1"><i>x</i></div>');
        const slotPC = pc.querySelector('div');
        rect(slotPC, { left: 100, right: 160, top: 300, bottom: 360, width: 60, height: 60 });
        disparaMouse(D.body, 'mouseover');
        disparaMouse(slotPC, 'mouseover');
        await new Promise(r => setTimeout(r, 60));
        const cc = card();
        t('criatura de endpoint desconhecido vira análise (Cassino/Poké Centro)',
            !!cc && cc.classList.contains('pp-on') && /pp-rt-pz/.test(cc.innerHTML),
            cc ? cc.innerHTML.slice(0, 60) : 'sem cartão');
        pc.remove();
    }

    {
        const pc2 = mk('<div class="pc-slot" data-slot-key="cid-1"><span>Nv.1</span></div>');
        const s2 = pc2.querySelector('div');
        rect(s2, { left: 100, right: 160, top: 420, bottom: 480, width: 60, height: 60 });
        disparaMouse(D.body, 'mouseover');
        disparaMouse(s2, 'mouseover');
        await new Promise(r => setTimeout(r, 60));
        const c3 = card();
        t('acha a criatura por atributo de nome desconhecido (Poké Centro)',
            !!c3 && c3.classList.contains('pp-on') && /pp-rt-pz/.test(c3.innerHTML),
            c3 ? c3.innerHTML.replace(/<[^>]+>/g,' ').slice(0,110) : 'sem cartão');
        pc2.remove();
    }
    {
        const nada = mk('<div class="cassino-slot"><span>Nv.7</span></div>');
        const s3 = nada.querySelector('div');
        rect(s3, { left: 100, right: 160, top: 500, bottom: 560, width: 60, height: 60 });
        disparaMouse(D.body, 'mouseover');
        disparaMouse(s3, 'mouseover');
        await new Promise(r => setTimeout(r, 60));
        nada.remove();
    }

    // Cartão do jogo REAL: classe .pokemon-tooltip-card, 380px, pointer-events:none
    {
        const jogo = D.createElement('div');
        jogo.className = 'pokemon-card pokemon-card--hover pokemon-tooltip-card';
        jogo.style.position = 'fixed'; jogo.style.zIndex = '2147483647';
        jogo.style.pointerEvents = 'none';
        D.body.appendChild(jogo);
        const rj = { left: 333, right: 713, top: 113, bottom: 982, width: 380, height: 869 };
        rect(jogo, rj);
        rect(slot, { left: 288, right: 344, top: 263, bottom: 319, width: 56, height: 56 });
        // painel de fundo largo, como a mochila do print
        const fundo = D.createElement('div');
        fundo.className = 'pokeidle-panel game-window inventory-window';
        fundo.style.position = 'absolute';
        D.body.appendChild(fundo);
        rect(fundo, { left: 101, right: 914, top: 125, bottom: 724, width: 813, height: 599 });

        disparaMouse(D.body, 'mouseover');
        disparaMouse(slot, 'mouseover');
        await new Promise(r => setTimeout(r, 60));
        const c = card();
        const x = parseInt(c.style.left, 10), lwv = parseInt(c.style.width, 10);
        t('NUNCA cobre o cartão do jogo (.pokemon-tooltip-card)',
            x + lwv <= rj.left || x >= rj.right,
            `cartão ${x}..${x + lwv} vs card do jogo ${rj.left}..${rj.right}`);
        t('estreita para caber ao lado em vez de sobrepor', lwv <= 210 || x + lwv <= 333,
            `largura ${lwv}px`);
        t('topo alinhado com o cartão do jogo', Math.abs(parseInt(c.style.top, 10) - rj.top) <= 2,
            `top=${c.style.top} vs jogo top=${rj.top}`);
        jogo.remove(); fundo.remove();
    }

    // cartão do jogo à esquerda, espaço de sobra à direita: largura padrão 380
    {
        const j2 = D.createElement('div');
        j2.className = 'pokemon-card pokemon-card--hover pokemon-tooltip-card';
        j2.style.position = 'fixed'; j2.style.pointerEvents = 'none';
        D.body.appendChild(j2);
        const r2 = { left: 100, right: 480, top: 150, bottom: 900, width: 380, height: 750 };
        rect(j2, r2);
        rect(slot, { left: 120, right: 176, top: 300, bottom: 356, width: 56, height: 56 });
        disparaMouse(D.body, 'mouseover');
        disparaMouse(slot, 'mouseover');
        await new Promise(r => setTimeout(r, 60));
        const c = card();
        const lwv = parseInt(c.style.width, 10);
        const xv = parseInt(c.style.left, 10);
        // 923 de janela, cartão do jogo de 380 -> padrão constante de 255
        const esperado = Math.floor((win.innerWidth - 380) / 2) - 16;
        t('largura PADRÃO constante, independente de onde o cartão do jogo está',
            lwv === esperado, `largura ${lwv}px (esperado ${esperado})`);
        t('fica colado ao lado, sem sobrepor', xv >= r2.right,
            `left=${xv} vs jogo termina em ${r2.right}`);
        t('topo alinhado (padronizado)', Math.abs(parseInt(c.style.top, 10) - r2.top) <= 2,
            `top=${c.style.top}`);
        j2.remove();
    }

    // item e slot vazio NÃO podem herdar a análise do último Pokémon
    try {
        const j3 = D.createElement('div');
        j3.className = 'pokemon-card pokemon-card--hover pokemon-tooltip-card';
        j3.style.position = 'fixed'; j3.style.pointerEvents = 'none';
        j3.textContent = 'Machamp Machamp NÍVEL 100 ÉPICA ×1,48 IV TOTAL 110/186 '
            + 'ATRIBUTOS DE BATALHA HP 250 · 20/31 DEF 180 · 18/31 ATK 300 · 31/31 '
            + 'DEF SP 170 · 15/31 ATK SP 140 · 4/31 VEL 160 · 22/31';
        D.body.appendChild(j3);
        rect(j3, { left: 100, right: 480, top: 150, bottom: 900, width: 380, height: 750 });

        const grade = mk('<div class="pokecentro-slot-grid">'
            + '<div class="s" id="poke"><span>Nv.100</span></div>'
            + '<div class="s" id="item"><span>150</span></div>'
            + '<div class="s" id="vazio"></div></div>');
        const [poke, item, vazio] = ['poke', 'item', 'vazio'].map(id => D.getElementById(id));
        [poke, item, vazio].forEach((el, i) => rect(el,
            { left: 600 + i * 70, right: 656 + i * 70, top: 300, bottom: 356, width: 56, height: 56 }));

        disparaMouse(D.body, 'mouseover');
        disparaMouse(poke, 'mouseover');
        await new Promise(r => setTimeout(r, 60));
        const ligado = card() && card().classList.contains('pp-on');
        t('slot de Pokémon com nível casando mostra a análise', ligado);

        disparaMouse(item, 'mouseover');
        await new Promise(r => setTimeout(r, 60));
        t('slot de ITEM não herda a análise do Pokémon anterior',
            !card().classList.contains('pp-on'));

        disparaMouse(poke, 'mouseover');
        await new Promise(r => setTimeout(r, 60));
        disparaMouse(vazio, 'mouseover');
        await new Promise(r => setTimeout(r, 60));
        t('slot VAZIO não herda a análise do Pokémon anterior',
            !card().classList.contains('pp-on'));

        // nível do slot diferente do cartão aberto = leitura defasada
        const outro = mk('<div class="pokecentro-slot-grid"><div id="p2"><span>Nv.7</span></div></div>');
        const p2 = D.getElementById('p2');
        rect(p2, { left: 700, right: 756, top: 500, bottom: 556, width: 56, height: 56 });
        disparaMouse(D.body, 'mouseover');
        disparaMouse(p2, 'mouseover');
        await new Promise(r => setTimeout(r, 60));
        t('nível divergente = cartão defasado, não mostra nada',
            !card().classList.contains('pp-on'));

        // MAPA DE CAÇADAS: rótulos "Espécie Nv. N" sem cartão de detalhes.
        // Casa com o badge de nível, mas ali não há criatura sua — o cartão
        // não pode aparecer, nem como diagnóstico.
        j3.remove();                    // nenhum cartão do jogo aberto
        const mapa = mk('<div class="hunt-map"><div id="area1">Granbull Nv. 130</div>'
            + '<div id="area2">Tyranitar Nv. 150</div></div>');
        const [a1, a2] = ['area1', 'area2'].map(id => D.getElementById(id));
        rect(a1, { left: 300, right: 420, top: 400, bottom: 424, width: 120, height: 24 });
        rect(a2, { left: 300, right: 420, top: 440, bottom: 464, width: 120, height: 24 });
        disparaMouse(D.body, 'mouseover');
        disparaMouse(a1, 'mouseover');
        await new Promise(r => setTimeout(r, 60));
        t('rótulo do mapa de caçadas NÃO abre o analisador',
            !card().classList.contains('pp-on'),
            card().innerHTML.slice(0, 90));
        disparaMouse(a2, 'mouseover');
        await new Promise(r => setTimeout(r, 60));
        t('nem no segundo rótulo do mapa', !card().classList.contains('pp-on'));
        mapa.remove();
        D.body.appendChild(j3);         // devolve o cartão para os testes seguintes

        // CASSINO: um Pokémon só, sem badge de nível — tem que funcionar
        const cas = mk('<div class="npc-casino-reveal-card">'
            + '<div id="premio"><span>EEVEE</span><span>FRACA</span></div></div>');
        const premio = D.getElementById('premio');
        rect(premio, { left: 600, right: 700, top: 600, bottom: 700, width: 100, height: 100 });
        disparaMouse(D.body, 'mouseover');
        disparaMouse(premio, 'mouseover');
        await new Promise(r => setTimeout(r, 60));
        t('cassino funciona sem badge de nível (um Pokémon só na tela)',
            !!card() && card().classList.contains('pp-on'),
            'closest=' + !!premio.closest('.npc-casino-reveal-card')
            + ' grade=' + !!premio.closest('.pokecentro-slot-grid, .inventory-slot-grid')
            + ' cards=' + D.querySelectorAll('.pokemon-tooltip-card').length
            + ' cls=' + JSON.stringify((card() || {}).className));
        cas.remove();

        j3.remove(); grade.remove(); outro.remove();
    } catch (err) { falhou.push('bloco item/vazio quebrou: ' + err.message); }

    // CARD LARGO do Pokémon ativo na EQUIPE (o caso que não funcionava)
    try {
        const jc = D.createElement('div');
        jc.className = 'pokemon-card pokemon-card--hover pokemon-tooltip-card';
        jc.style.position = 'fixed'; jc.style.pointerEvents = 'none';
        jc.textContent = 'Machamp Machamp NÍVEL 150 ÉPICA ×1,48 IV TOTAL 110/186 '
            + 'ATRIBUTOS DE BATALHA HP 900 · 20/31 DEF 500 · 18/31 ATK 800 · 31/31 '
            + 'DEF SP 480 · 15/31 ATK SP 400 · 4/31 VEL 460 · 22/31';
        D.body.appendChild(jc);
        rect(jc, { left: 60, right: 440, top: 120, bottom: 870, width: 380, height: 750 });

        const hud = mk('<div class="pokeidle-team-hud">'
            + '<div id="ativo"><span>CH... Nv.150</span></div></div>');
        const ativo = D.getElementById('ativo');
        // card largo: 380px, acima do teto antigo de 260/320
        rect(ativo, { left: 620, right: 1000, top: 700, bottom: 800, width: 380, height: 100 });

        disparaMouse(D.body, 'mouseover');
        disparaMouse(ativo, 'mouseover');
        await new Promise(r => setTimeout(r, 60));
        t('card largo do Pokémon ativo recebe análise',
            !!card() && card().classList.contains('pp-on') && /pp-rt-pz/.test(card().innerHTML),
            card() ? 'cls=' + card().className : 'sem cartão');
        jc.remove(); hud.remove();
    } catch (err) { falhou.push('bloco do card largo quebrou: ' + err.message); }

    // TRADE: tela cuja classe eu não conheço, com o Pokémon do OUTRO jogador,
    // que NÃO está nos dados do jogador — montado só a partir do cartão do jogo
    const criaturasTemAlheio = () => false;
    try {

        const jt = D.createElement('div');
        jt.className = 'pokemon-card pokemon-card--hover pokemon-tooltip-card';
        jt.style.position = 'fixed'; jt.style.pointerEvents = 'none';
        jt.textContent = 'Machamp Machamp NÍVEL 42 RARA ×1,30 IV TOTAL 80/186 '
            + 'ATRIBUTOS DE BATALHA HP 99 · 15/31 DEF 44 · 12/31 ATK 88 · 20/31 '
            + 'DEF SP 41 · 11/31 ATK SP 30 · 8/31 VEL 38 · 14/31';
        D.body.appendChild(jt);
        rect(jt, { left: 100, right: 480, top: 150, bottom: 900, width: 380, height: 750 });

        const trade = mk('<section class="classe-que-eu-nao-conheco">'
            + '<div id="tslot"><span>Nv.42</span></div></section>');
        const tslot = D.getElementById('tslot');
        rect(tslot, { left: 620, right: 676, top: 300, bottom: 356, width: 56, height: 56 });

        disparaMouse(D.body, 'mouseover');
        disparaMouse(tslot, 'mouseover');
        await new Promise(r => setTimeout(r, 60));
        t('analisa Pokémon do outro jogador SEM tê-lo nos seus dados (trade)',
            !!card() && card().classList.contains('pp-on') && /pp-rt-pz/.test(card().innerHTML),
            card() ? ('cls=' + JSON.stringify(card().className) + ' html=' + card().innerHTML.slice(0,70)) : 'sem cartão');
        // o Pokémon do outro jogador não pode estar no índice: o cartão é a
        // única fonte, que é o caso real da negociação
        t('a criatura da trade NÃO veio do índice do jogador', !criaturasTemAlheio(),
            'índice consultado');
        jt.remove(); trade.remove();
    } catch (err) { falhou.push('bloco de trade quebrou: ' + err.message); }

    // padronização: o cartão do jogo em duas posições distintas tem que dar a
    // MESMA largura de analisador
    try {
        const larguras = [];
        for (const pos of [{ l: 100, r: 480 }, { l: 333, r: 713 }]) {
            const j = D.createElement('div');
            j.className = 'pokemon-card pokemon-card--hover pokemon-tooltip-card';
            j.style.position = 'fixed'; j.style.pointerEvents = 'none';
            D.body.appendChild(j);
            rect(j, { left: pos.l, right: pos.r, top: 150, bottom: 900, width: 380, height: 750 });
            rect(slot, { left: pos.l + 20, right: pos.l + 76, top: 300, bottom: 356, width: 56, height: 56 });
            disparaMouse(D.body, 'mouseover');
            disparaMouse(slot, 'mouseover');
            await new Promise(r => setTimeout(r, 60));
            const c = card();
            larguras.push(parseInt(c.style.width, 10));
            const xv = parseInt(c.style.left, 10);
            t(`não sobrepõe com o cartão do jogo em ${pos.l}..${pos.r}`,
                xv + larguras[larguras.length - 1] <= pos.l || xv >= pos.r,
                `cartão em ${xv}..${xv + larguras[larguras.length - 1]}`);
            j.remove();
        }
        t('MESMA largura nas duas posições (padronizado)', larguras[0] === larguras[1],
            `larguras: ${larguras.join(' e ')}`);
    } catch (err) { falhou.push('bloco de padronização quebrou: ' + err.message); }

    // painel do jogo aninhado fundo: antes escapava do flutuantes() e o cartão
    // era colocado em cima dele
    {
        const raiz = D.createElement('div');
        const n1 = D.createElement('div'); const n2 = D.createElement('div');
        const painelJogo = D.createElement('div');
        painelJogo.className = 'pokeidle-panel game-window';
        painelJogo.style.position = 'fixed';
        n2.appendChild(painelJogo); n1.appendChild(n2); raiz.appendChild(n1);
        D.body.appendChild(raiz);
        const rj = { left: 300, right: 700, top: 150, bottom: 700, width: 400, height: 550 };
        rect(painelJogo, rj);
        [raiz, n1, n2].forEach(e => rect(e, { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 }));
        rect(slot, { left: 420, right: 480, top: 300, bottom: 360, width: 60, height: 60 });
        D.elementsFromPoint = () => [painelJogo];

        disparaMouse(D.body, 'mouseover');
        disparaMouse(slot, 'mouseover');
        await new Promise(r => setTimeout(r, 60));
        const c = card();
        const x = parseInt(c.style.left, 10);
        const lw = parseInt(c.style.width, 10);
        const semSobrepor = (x + lw <= rj.left) || (x >= rj.right);
        t('NÃO sobrepõe painel do jogo aninhado fundo na árvore', semSobrepor,
            `cartão ${x}..${x + lw} vs painel ${rj.left}..${rj.right}`);
        delete D.elementsFromPoint;
        raiz.remove();
    }

    // simula combat.started com inimigos de nível alto, como no mapa de nv.150
    const ws = new (win.WebSocket)('wss://x');
    // o script substitui window.WebSocket; recupera a subclasse instalada
    const WS = win.WebSocket;
    const sock = new WS('wss://pokepixel.nietore.com/ws?token=x');
    const disparar = msg => {
        const ev = { data: JSON.stringify(msg) };
        (sock.__listeners || []).forEach(fn => fn(ev));
    };

    // ---- aba Perdidos: bola gasta que não capturou ----
    // O capture.failed não traz a criatura; o retrato tem que vir do
    // combat.started daquele combate. Aqui os dois eventos são disparados na
    // ordem real e o teste cobra a linha renderizada, não o estado interno.
    const INIMIGO = {
        id: 'wild-1', created_at: '2026-08-21T10:00:00Z', species_id: 'machamp',
        species_name: 'Machamp', map_id: 42, level: 150, quality: 'epic',
        quality_multiplier: 1.48, is_shiny: false, nature: 'adamant', gender: 'male',
        ivs: { hp: 20, atk: 31, def: 18, spa: 4, spd: 22, spe: 15 },
        // Atributos COERENTES com a fórmula do jogo para estes base stats, IVs,
        // multiplicador, natureza e gênero no nível 150 — gerados pela fórmula,
        // não inventados. Sem isso o verificador da projeção recusa (e recusar
        // é o comportamento certo para dado que não fecha).
        // Sem "power": o combat.started real não traz esse campo.
        max_hp: 2166, atk: 837, def: 427, spa: 320, spd: 460, spe: 301,
    };
    // Um shiny e um normal: a linha do shiny tem que usar o sprite shiny, e o
    // filtro de forma tem que separar os dois.
    disparar({ type: 'combat.started', seq: 4001, data: { enemy: { ...INIMIGO,
        id: 'wild-shiny', created_at: '2026-08-21T09:00:00Z', is_shiny: true } } });
    disparar({ type: 'capture.failed', seq: 4002,
               data: { quality: 'epic', capsule_item_id: 'ultra-ball', capsule_name: 'Ultra Bola' } });
    disparar({ type: 'combat.started', seq: 5001, data: { enemy: INIMIGO } });
    disparar({ type: 'capture.failed', seq: 5002,
               data: { quality: 'epic', capsule_item_id: 'ultra-ball', capsule_name: 'Ultra Bola' } });

    let contadorSeq = 0;
    const abaLost = win.document.querySelector('.pp-rt-tab[data-view="lost"]');
    t('existe uma quarta aba Perdidos', !!abaLost && /Perdidos/.test(abaLost.textContent));
    t('as quatro abas cabem numa fileira só',
        /\.pp-rt-tabs \{[^}]*grid-template-columns: repeat\(4, 1fr\)/.test(code));
    if (abaLost) {
        abaLost.click();
        const linhas = [...win.document.querySelectorAll('#pp-rt-rows .pp-rt-row--log[data-i]')];
        const txt = linhas.map(l => l.textContent.replace(/\s+/g, ' ').trim()).join(' | ');
        t('a bola gasta que não capturou virou linha em Perdidos', linhas.length === 2, txt || '(vazio)');
        // Natureza e gênero saíram das COLUNAS de Perdidos (o jogo não os
        // envia mais); o retrato continua sendo lido, e aparece no cartão.
        t('a linha traz o retrato do combat.started quando ele existe',
            /Machamp/.test(txt) && /110/.test(txt) && /Ultra Ball/.test(txt)
            && /Nv\. 150/.test(txt), txt);
        // O inimigo do combat.started não traz campo de poder; a soma dos seis
        // atributos é o que o próprio jogo exibe como PODER TOTAL.
        t('perdido é projetado para o nível de captura, não o do mapa', (() => {
            const l = [...win.document.querySelectorAll('#pp-rt-rows .pp-rt-row--log[data-i]')];
            if (!l.length) return false;
            l[0].dispatchEvent(new win.MouseEvent('mouseover', { bubbles: true }));
            const tip = win.document.querySelector('#pp-rt-tip, .pp-rt-tip');
            const m = tip && /Poder total\s*([\d.,]+)/.exec(tip.textContent);
            if (!m) return false;
            const v = Number(m[1].replace(/[.,]/g, ''));
            // No nível 150 os seis somam 4.511; projetados para o nível 1,
            // somam 110 (sem capturas no registro, o fator de treinador é 1).
            return v === 110;
        })(), 'projetado deve ser dezenas, não milhares');
        t('a projeção é MEDIDA dos atributos, não reconstruída do multiplicador',
            /function fatorMedido\(e, sp, f\)/.test(code)
            && /amostras\.push\(\{ k, v: obs \/ cru \}\);/.test(code)
            // QUAL_EXP só pode aparecer na estimativa do treinador, nunca na
            // medição do fator do próprio selvagem.
            && !/QUAL_EXP/.test(code.slice(code.indexOf('function fatoresDe'),
                                          code.indexOf('let treinadorCache'))));
        t('o bônus de treinador volta a entrar, medido das capturas',
            /function fatorTreinador\(\)/.test(code)
            && /const fator = r\.fator \* fatorTreinador\(\);/.test(code)
            && /1 \+ Math\.max\(0, Math\.round\(\(med - 1\) \/ 0\.02\)\) \* 0\.02/.test(code));
        t('sem capturas suficientes, não corrige em vez de corrigir errado',
            /if \(amostras\.length < 12\) return \(treinadorCache = 1\);/.test(code));
        t('a estimativa do treinador é refeita a cada captura nova',
            /treinadorCache = null;\n            anunciarCaptura/.test(code));
        t('o HP fica fora da medição (selvagem tem bônus de combate)',
            /const semHp = ORDEM\.filter\(k => k !== 'hp'\);/.test(code)
            && /for \(const k of semHp\) \{/.test(code));
        // ORDEM é declarado bem depois no arquivo; uma const no topo lendo ele
        // lança ReferenceError na carga e a extensão nem sobe.
        t('semHp é filtrado dentro da função, não numa const no topo (TDZ)',
            /\n        const semHp = ORDEM\.filter/.test(code)
            && !/\n    const SEM_HP/.test(code));
        t('os cinco atributos restantes têm que concordar',
            /if \(pior > 0\.06\) \{/.test(code)
            && /return \{ fator: mediana \};/.test(code));
        t('projeção recusada diz o MOTIVO na tela, não só que falhou',
            /const semProjetar = /.test(code)
            && /sem projeção: \$\{escapeHtml\(motivoProjecao/.test(code)
            && /fatores não conferem \(/.test(code)
            && /espécie "\$\{e\.sp \|\| '\?'\}" não está no índice/.test(code)
            && /base stats da espécie não carregados/.test(code));
        t('a grade de atributos usa os mesmos valores do poder total',
            /const batExibido = batDe\(e\);/.test(code)
            && /<b>\$\{fmt\(batExibido\[i\]\)\}<\/b>/.test(code)
            && !/<b>\$\{fmt\(e\.bat\[i\]\)\}<\/b>/.test(code));
        t('a projeção é rotulada no cartão',
            /como seriam capturado \(Nv\. 1\)/.test(code));

        t('perdido mostra o nível do selvagem, não destino de venda',
            /Nv\. 150/.test(txt) && !/Vendido|Guardado/.test(txt), txt);
        t('o cabeçalho troca Destino por Nível',
            /Nível/.test(win.document.querySelector('.pp-rt-hrow--log').textContent)
            && !/Destino/.test(win.document.querySelector('.pp-rt-hrow--log').textContent));
        const src = () => [...win.document.querySelectorAll('#pp-rt-rows .pp-rt-cap-img')]
            .map(i => i.getAttribute('src') || '');
        t('a linha do shiny usa o sprite shiny, a do normal usa o normal',
            src().length === 2 && /shiny\.png$/.test(src()[1]) && /front\.png$/.test(src()[0]),
            JSON.stringify(src()));

        // filtro de forma
        const fShiny = win.document.querySelector('#pp-rt-f-shiny');
        t('existe um filtro de forma normal/shiny', !!fShiny);
        if (fShiny) {
            fShiny.value = 'shiny';
            fShiny.dispatchEvent(new win.Event('change', { bubbles: true }));
            const soShiny = src();
            t('filtro Shiny deixa só os shiny',
                soShiny.length === 1 && /shiny\.png$/.test(soShiny[0]), JSON.stringify(soShiny));

            fShiny.value = 'normal';
            fShiny.dispatchEvent(new win.Event('change', { bubbles: true }));
            const soNormal = src();
            t('filtro Normal exclui os shiny',
                soNormal.length === 1 && /front\.png$/.test(soNormal[0]), JSON.stringify(soNormal));

            fShiny.value = '';
            fShiny.dispatchEvent(new win.Event('change', { bubbles: true }));
            t('filtro Todas devolve os dois', src().length === 2);
        }

        // HP inflado NÃO pode derrubar a projeção: no jogo real o selvagem vem
        // com ~25% mais HP que a fórmula prevê, e os outros cinco batem.
        t('HP inflado do selvagem não derruba a projeção', (() => {
            const antes = INIMIGO.max_hp;
            INIMIGO.max_hp = Math.round(antes * 1.25);
            disparar({ type: 'combat.started', seq: 7001, data: { enemy: { ...INIMIGO,
                id: 'wild-hp', created_at: '2026-08-21T11:00:00Z' } } });
            disparar({ type: 'capture.failed', seq: 7002,
                       data: { quality: 'epic', capsule_item_id: 'ultra-ball', capsule_name: 'Ultra Bola' } });
            INIMIGO.max_hp = antes;
            abaLost.click();
            const l = win.document.querySelector('#pp-rt-rows .pp-rt-row--log[data-i]');
            l.dispatchEvent(new win.MouseEvent('mouseover', { bubbles: true }));
            const tip = win.document.querySelector('#pp-rt-tip, .pp-rt-tip');
            return !!tip && /como seriam capturado/.test(tip.textContent)
                && !/sem projeção/.test(tip.textContent);
        })(), 'projeção deve sobreviver ao HP inflado');

        t('o filtro de forma fica na MESMA fileira dos outros',
            /#pp-rt-filters \{[^}]*grid-template-columns: 1\.15fr 1fr \.68fr \.68fr \.8fr \.85fr/.test(code)
            && /#pp-rt-filters\.pp-sem-destino\.pp-sem-destino \{\s*grid-template-columns: 1\.35fr 1\.15fr \.78fr \.78fr \.95fr/.test(code));
        t('destino é escondido por id, não por posição (senão some o filtro errado)',
            /#pp-rt-filters\.pp-sem-destino #pp-rt-field-sold \{ display: none; \}/.test(code)
            && !/pp-sem-destino \.pp-rt-field:last-child/.test(code));

        t('o filtro de destino some (não se aplica a perdido)',
            win.document.querySelector('#pp-rt-filters').classList.contains('pp-sem-destino'));
        t('o rodapé anuncia o teto e a exceção dos notáveis', /500 perdidos comuns/.test(
            win.document.querySelector('#pp-rt-pager-info, .pp-rt-pager-info, #pp-rt-pager').textContent));

        // O cartão de análise tem que funcionar aqui também: o perdido tem
        // retrato completo, então não há motivo para ele ficar sem nota.
        const l0 = win.document.querySelector('#pp-rt-rows .pp-rt-row--log[data-i]');
        if (l0) {
            l0.dispatchEvent(new win.MouseEvent('mouseover', { bubbles: true }));
            const tip = win.document.querySelector('#pp-rt-tip, .pp-rt-tip');
            t('perdido abre o cartão ao passar o mouse',
                !!tip && /pp-on/.test(tip.className));
            t('o cartão do perdido traz a análise, não "Indisponível"',
                !!tip && /An\u00e1lise/.test(tip.innerHTML) && !/Indispon\u00edvel/.test(tip.innerHTML),
                tip ? (tip.innerHTML.match(/Indispon\u00edvel: [^<.]*/) || ['ok'])[0] : 'sem tip');
            t('a análise do perdido tem os dois gráficos com porcentagem',
                !!tip && (tip.innerHTML.match(/pathLength/g) || []).length >= 2
                     && /%/.test(tip.innerHTML));
        }

        // A falha NÃO pode contaminar o registro de capturas.
        const abaLog = win.document.querySelector('.pp-rt-tab[data-view="log"]');
        abaLog.click();
        const txtCap = win.document.querySelector('#pp-rt-rows').textContent;
        t('falha de captura não entra no registro de capturas',
            /Nenhuma captura registrada ainda/.test(txtCap), txtCap.slice(0, 60));
        t('o filtro de forma também existe na aba de capturas',
            !!win.document.querySelector('#pp-rt-filters.pp-on #pp-rt-f-shiny'));
        t('filtro de destino volta na aba de capturas',
            !win.document.querySelector('#pp-rt-filters').classList.contains('pp-sem-destino'));
        abaLost.click();

        // ---- integração real: principal + companheiro na mesma página ----
        // Carrega o companheiro de verdade no mesmo DOM, dispara capturas pelo
        // WebSocket e cobra o POST. É o que prova que o desacoplamento
        // funciona: o principal só emite evento, o companheiro só posta.
        if (codeD) {
            const postados = [];
            const sandD = Object.assign({}, sandbox, {
                GM_xmlhttpRequest: opts => {
                    postados.push({ url: opts.url, metodo: opts.method,
                                    corpo: JSON.parse(opts.data) });
                    opts.onload && opts.onload({ status: 204, responseText: '' });
                },
            });
            const HOOK = 'https://discord.com/api/webhooks/123456789/abcTOKENsecreto';
            store.set('ppd_webhook_v1', HOOK);   // chave legada, tem que migrar sozinha
            store.set('ppd_minimo_v1', 'epic');
            store.set('ppd_ligado_v1', true);
            try {
                vm.runInNewContext(codeD, vm.createContext(sandD));
            } catch (e) { console.log('[companheiro] não carregou:', e.message); }

            const capturar = (q, shiny) => disparar({ type: 'capture.success', seq: 6000 + postados.length * 2 + (q.length),
                data: { capsule_item_id: 'ultra-ball', capsule_name: 'Ultra Bola', auto_sold: false,
                        creature: { ...INIMIGO, id: 'cap-' + q + shiny, quality: q, is_shiny: !!shiny, level: 1 } } });

            capturar('common');
            t('captura comum NÃO vira aviso no Discord', postados.length === 0,
                JSON.stringify(postados.map(p => p.corpo.embeds[0].title)));

            capturar('legendary');
            t('captura acima do limite vira UM POST para o Discord',
                postados.length === 1 && postados[0].metodo === 'POST' && postados[0].url === HOOK,
                postados.length + ' post(s)');
            if (postados[0]) {
                const emb = postados[0].corpo.embeds[0];
                t('o aviso traz espécie, raridade e IV',
                    /Machamp/.test(emb.title) && /Lend/.test(emb.title)
                    && emb.fields.some(f => /IV total/.test(f.name) && /110/.test(f.value)),
                    emb.title);
            }

            // A trava do domínio: webhook de outro lugar não pode ser usado,
            // nem configurado direto no mapa, nem herdado da chave legada.
            const MAU = 'https://exemplo-malicioso.com/api/webhooks/1/x';
            store.set('ppd_webhooks_v1', JSON.stringify({ '*': MAU }));
            const antes = postados.length;
            capturar('mythical');
            t('webhook fora do Discord é recusado (nenhum POST sai)',
                postados.length === antes, postados.length - antes + ' post(s) indevido(s)');

            store.set('ppd_webhooks_v1', '{}');
            store.set('ppd_webhook_v1', MAU);
            capturar('mythical');
            t('chave legada inválida não vira o webhook padrão',
                postados.length === antes, postados.length - antes + ' post(s) indevido(s)');

            store.set('ppd_webhooks_v1', '{}');
            store.set('ppd_webhook_v1', HOOK);

            // Desligado no menu = silêncio, mesmo com webhook válido.
            store.set('ppd_ligado_v1', false);
            const antes2 = postados.length;
            capturar('mythical');
            t('com os avisos desligados, nada é enviado', postados.length === antes2);
            store.set('ppd_ligado_v1', true);

            // ---- configuração sem diálogo do navegador ----
            // Quem desmarca os avisos do Tampermonkey, ou bloqueia diálogos no
            // Chrome, recebe null em todo prompt(). A configuração inteira
            // parava de funcionar em silêncio.
            // \b e não [^.\w]: excluir o ponto deixava "W.prompt(" passar, que é
            // justamente a forma usada aqui.
            t('o companheiro NÃO usa prompt/alert/confirm', (() => {
                const limpo = codeD.replace(/\/\*[\s\S]*?\*\//g, ' ')
                                   .replace(/^[ \t]*\/\/.*$/gm, ' ');
                const m = /\b(prompt|alert|confirm)\s*\(/.exec(limpo);
                return !m;
            })(), 'nenhum diálogo nativo');
            t('a configuração tem tela própria com os campos necessários',
                /id="ppd-hook"/.test(codeD) && /id="ppd-hook-padrao"/.test(codeD)
                && /id="ppd-min"/.test(codeD) && /id="ppd-on"/.test(codeD)
                && /function abrirUi\(\)/.test(codeD));
            t('os webhooks não ficam à mostra por padrão',
                /id="ppd-hook" type="password"/.test(codeD)
                && /id="ppd-ver" type="checkbox"/.test(codeD));
            t('o resultado aparece na própria tela, não em alert',
                /function aviso\(texto, tipo\)/.test(codeD)
                && /ui\.status\.textContent = texto;/.test(codeD));

            // Comportamental: abre a tela, muda a raridade, salva e confere.
            {
                const dlg = [];
                const sandUi = Object.assign({}, sandbox, {
                    prompt: m => { dlg.push(m); return null; },   // diálogos BLOQUEADOS
                    alert: m => { dlg.push(m); },
                    GM_xmlhttpRequest: o => { o.onload && o.onload({ status: 204, responseText: '' }); },
                });
                store.set('ppd_webhooks_v1', JSON.stringify({ '*': HOOK }));
                store.set('ppd_minimos_v1', JSON.stringify({ '*': 'epic' }));
                const menus = [];
                sandUi.GM_registerMenuCommand = (nome, fn) => menus.push([nome, fn]);
                try { vm.runInNewContext(codeD, vm.createContext(sandUi)); }
                catch (e) { /* reportado abaixo */ }

                const cmd = menus.find(([n]) => /configurar/i.test(n));
                t('existe um comando de menu que abre a configuração', !!cmd,
                    menus.map(([n]) => n).join(' | ') || 'nenhum');
                if (cmd) {
                    cmd[1]();
                    const painel = win.document.querySelector('#ppd-fundo');
                    t('a tela de configuração abre', !!painel && painel.className.includes('ppd-on'));
                    t('nenhum diálogo do navegador foi chamado', dlg.length === 0, dlg.join(' | '));

                    const sel = win.document.querySelector('#ppd-min');
                    t('a raridade mínima é um campo de verdade, com as 7 opções',
                        !!sel && sel.options.length === 7);
                    sel.value = 'rare';
                    win.document.querySelector('#ppd-salvar').click();
                    let mins = {};
                    try { mins = JSON.parse(store.get('ppd_minimos_v1')); } catch (e) {}
                    t('mudar a raridade mínima FUNCIONA com diálogos bloqueados',
                        mins['*'] === 'rare', JSON.stringify(mins));
                    t('o retorno aparece na tela', /Salvo/.test(
                        win.document.querySelector('#ppd-status').textContent));
                    win.document.querySelector('#ppd-fechar').click();
                    painel.remove();
                }
            }

            // Prova de fogo: um mítico e um shiny, e depois 600 comuns por cima.
            // Com o teto único de 500 os dois teriam sido apagados.
            t('mítico e shiny sobrevivem a 600 perdidos comuns depois deles', (() => {
                const enviar = (q, shiny, n) => {
                    for (let i = 0; i < n; i++) {
                        disparar({ type: 'combat.started', seq: 20000 + contadorSeq++, data: { enemy: {
                            ...INIMIGO, id: 'w' + contadorSeq, created_at: '2026-08-21T12:00:' + (i % 60),
                            quality: q, is_shiny: !!shiny } } });
                        disparar({ type: 'capture.failed', seq: 20000 + contadorSeq++, data: {
                            quality: q, capsule_item_id: 'ultra-ball', capsule_name: 'Ultra Bola' } });
                    }
                };
                enviar('mythical', false, 1);
                enviar('epic', true, 1);
                enviar('common', false, 600);

                abaLost.click();
                const fShiny2 = win.document.querySelector('#pp-rt-f-shiny');
                const fQ = win.document.querySelector('#pp-rt-f-q');
                // filtra por shiny: o shiny antigo tem que continuar lá
                fShiny2.value = 'shiny';
                fShiny2.dispatchEvent(new win.Event('change', { bubbles: true }));
                const temShiny = /Machamp/.test(win.document.querySelector('#pp-rt-rows').textContent);
                fShiny2.value = '';
                fShiny2.dispatchEvent(new win.Event('change', { bubbles: true }));
                // filtra por mítica
                let temMitico = false;
                if (fQ) {
                    fQ.value = 'mythical';
                    fQ.dispatchEvent(new win.Event('change', { bubbles: true }));
                    temMitico = /Machamp/.test(win.document.querySelector('#pp-rt-rows').textContent);
                    fQ.value = '';
                    fQ.dispatchEvent(new win.Event('change', { bubbles: true }));
                }
                return temShiny && temMitico;
            })(), 'os dois notáveis têm que continuar no registro');

            // Chance de captura no cartão: a declarada pelo jogo e a medida.
            {
                abaLost.click();
                const l = win.document.querySelector('#pp-rt-rows .pp-rt-row--log[data-i]');
                l.dispatchEvent(new win.MouseEvent('mouseover', { bubbles: true }));
                const tip = win.document.querySelector('#pp-rt-tip, .pp-rt-tip');
                const txt = tip ? tip.textContent.replace(/\s+/g, ' ') : '';
                t('o cartão NÃO traz mais a chance de captura',
                    !/Chance de captura/.test(txt), txt.slice(0, 160));
                const cab = win.document.querySelector('.pp-rt-hrow--log').textContent;
                t('o cabeçalho do registro tem a coluna Chance', /Chance/.test(cab), cab);
        t('Perdidos não traz mais Natureza nem Gênero',
            !/Natureza/.test(cab) && !/Gênero/.test(cab), cab);
        t('a linha de perdido tem seis células, não oito', (() => {
            const l = win.document.querySelector('#pp-rt-rows .pp-rt-row--lost');
            return !!l && l.children.length === 6;
        })(), String((win.document.querySelector('#pp-rt-rows .pp-rt-row--lost') || { children: [] }).children.length));
                const cel = win.document.querySelector('#pp-rt-rows .pp-rt-cap-chance');
                // Machamp 17,65 base · Ultra Ball 4× · nível 150 · Comum 1×
                // 17,65 × 4 × 1/(1+150×0,012) × 0,3 = 7,5643%
                t('a linha mostra a chance daquele encontro, pela fórmula da wiki',
                    !!cel && /7,56/.test(cel.textContent), cel ? cel.textContent : 'sem célula');
            }

            // Shiny cai no piso do jogo: níveis bem diferentes, mesma chance.
            // Foi assim que o piso apareceu — quatro leituras do simulador com
            // fator de nível variando quase 3× e resultado sempre 0,01%.
            {
                const chanceDe = nivel => {
                    disparar({ type: 'combat.started', seq: 30000 + nivel, data: { enemy: {
                        ...INIMIGO, id: 'sh' + nivel, created_at: '2026-08-21T13:00:00Z',
                        level: nivel, quality: 'legendary', is_shiny: true } } });
                    disparar({ type: 'capture.failed', seq: 31000 + nivel, data: {
                        quality: 'legendary', capsule_item_id: 'ultra-ball', capsule_name: 'Ultra Bola' } });
                    abaLost.click();
                    const c = win.document.querySelector('#pp-rt-rows .pp-rt-cap-chance');
                    return c ? c.textContent.trim() : '';
                };
                const a1 = chanceDe(1), a150 = chanceDe(150);
                t('shiny cai no piso: nível 1 e nível 150 dão a mesma chance',
                    a1 === a150 && /0,01%/.test(a1), `nv1=${a1} nv150=${a150}`);
            }

            // Múltipla escolha: marcar duas raridades mostra as duas.
            {
                const gerar = (q, n) => {
                    for (let i = 0; i < n; i++) {
                        disparar({ type: 'combat.started', seq: 40000 + contadorSeq++, data: { enemy: {
                            ...INIMIGO, id: 'm' + contadorSeq, created_at: '2026-08-21T14:00:00Z',
                            quality: q, is_shiny: false } } });
                        disparar({ type: 'capture.failed', seq: 40000 + contadorSeq++, data: {
                            quality: q, capsule_item_id: 'ultra-ball', capsule_name: 'Ultra Bola' } });
                    }
                };
                gerar('rare', 2); gerar('uncommon', 2); gerar('common', 2);
                abaLost.click();

                const btnQ = win.document.querySelector('#pp-rt-f-q');
                const popQ = win.document.querySelector('#pp-rt-pop-q');
                t('o filtro de raridade virou botão com painel de caixas',
                    !!btnQ && btnQ.tagName === 'BUTTON' && !!popQ);

                btnQ.click();
                t('o painel abre ao clicar', popQ.classList.contains('pp-on'));
                const cxs = [...popQ.querySelectorAll('input[type=checkbox]')];
                t('há uma caixa por raridade, mais a de "Todas"', cxs.length === 8, String(cxs.length));

                const marcar = v => {
                    const cb = cxs.find(c => c.value === v);
                    cb.checked = true;
                    cb.dispatchEvent(new win.Event('change', { bubbles: true }));
                };
                const raridades = () => [...win.document.querySelectorAll('#pp-rt-rows .pp-rt-badge')]
                    .map(b => b.textContent.trim());

                marcar('rare');
                const soRara = raridades();
                t('uma raridade marcada filtra só ela',
                    soRara.length > 0 && soRara.every(x => /Rara/.test(x)), JSON.stringify(soRara));

                marcar('uncommon');
                const duas = raridades();
                t('DUAS raridades marcadas mostram as duas',
                    duas.some(x => /Rara/.test(x)) && duas.some(x => /Incomum/.test(x))
                    && !duas.some(x => /Comum$/.test(x)), JSON.stringify(duas));
                t('o botão avisa quantas estão marcadas',
                    /2 selecionadas/.test(btnQ.textContent), btnQ.textContent);

                const todas = cxs.find(c => c.value === '');
                todas.checked = true;
                todas.dispatchEvent(new win.Event('change', { bubbles: true }));
                t('"Todas" limpa a seleção e volta a mostrar tudo',
                    raridades().some(x => /Comum/.test(x)) && /Todas/.test(btnQ.textContent),
                    btnQ.textContent);
                btnQ.click();
            }

    // ---- o evento de captura do jogo NOVO, sem combat.started nenhum ----
        // Depois da atualização, o combate virou quadro de animação e o
        // capture.failed passou a trazer espécie, nível, mapa, IV total, shiny e
        // a chance já calculada. É dele que tudo tem que sair agora.
        {
            disparar({ type: 'capture.failed', seq: 4800, data: {
                capsule_item_id: 'capsule_ultra', capsule_name: 'Ultra Ball',
                chance: 0.048359728506787325, event_id: 9, is_shiny: false,
                iv_total: 60, level: 90, map_id: 13, quality: 'uncommon',
                species_id: 'machamp', species_name: 'Machamp',
            } });
            abaLost.click();
            const linha = win.document.querySelector('#pp-rt-rows .pp-rt-row--log[data-i]');
            const txt = linha ? linha.textContent.replace(/\s+/g, ' ') : '';
            // Cartão do perdido no jogo NOVO: sem multiplicador, natureza, gênero
        // e IV por atributo, mas com tier e IV total.
        {
            const l = win.document.querySelector('#pp-rt-rows .pp-rt-row--log[data-i]');
            l.dispatchEvent(new win.MouseEvent('mouseover', { bubbles: true }));
            const tip = win.document.querySelector('#pp-rt-tip, .pp-rt-tip');
            const txt = tip ? tip.textContent.replace(/\s+/g, ' ') : '';
            t('o cartão NÃO diz mais só "Indisponível"',
                !/Indisponível/.test(txt), txt.slice(0, 140));
            t('mostra análise parcial rotulada como parcial',
                /Análise — parcial, só pelo IV/.test(txt), txt.slice(0, 200));
            t('e explica por que a nota completa não existe',
                /o jogo não envia multiplicador, natureza, gênero nem IV por atributo/.test(txt),
                txt.slice(0, 320));
            t('a caixa vazia de Poder total virou a chance da tentativa',
                /Chance de captura ?4,84/.test(txt) && !/Poder total ?0/.test(txt), txt.slice(0, 160));
            t('seções sem dado somem em vez de ficarem vazias',
                !/Genética/.test(txt) && !/Sem dados desta captura/.test(txt), txt.slice(0, 220));
            const svgs = tip ? tip.querySelectorAll('svg').length : 0;
            t('os dois gráficos aparecem, agora medindo o IV', svgs >= 2, String(svgs));
        }

        // O contador de shinies vivia no combat.started, que o jogo removeu:
        // ele parou de subir enquanto a lista continuava marcando shiny.
        {
            const antes = win.document.querySelector('#pp-rt-t-shi').textContent;
            const bolaNo = (id, shiny) => disparar({ type: 'capture.failed', seq: 4810 + contadorSeq++,
                data: { capsule_item_id: 'capsule_ultra', capsule_name: 'Ultra Ball',
                        chance: 0.05, is_shiny: shiny, iv_total: 70, level: 90, map_id: 13,
                        quality: 'common', species_id: 'machamp', species_name: 'Machamp',
                        wild_monster_id: id } });
            bolaNo('spawn-A', true);
            const depois1 = win.document.querySelector('#pp-rt-t-shi').textContent;
            t('shiny do evento de captura é contado', depois1 !== antes && / 1$/.test(depois1),
                `${antes} -> ${depois1}`);

            bolaNo('spawn-A', true);   // segunda bola no MESMO selvagem
            t('segunda bola no mesmo spawn não conta de novo',
                win.document.querySelector('#pp-rt-t-shi').textContent === depois1,
                win.document.querySelector('#pp-rt-t-shi').textContent);

            bolaNo('spawn-B', true);
            t('outro spawn shiny conta',
                / 2$/.test(win.document.querySelector('#pp-rt-t-shi').textContent),
                win.document.querySelector('#pp-rt-t-shi').textContent);

            bolaNo('spawn-C', false);
            t('não-shiny não mexe no contador',
                / 2$/.test(win.document.querySelector('#pp-rt-t-shi').textContent),
                win.document.querySelector('#pp-rt-t-shi').textContent);
        }
        t('o contador avisa o que ele mede, para a comparação com o jogo fazer sentido',
            /Conta os shiny em que uma bola foi lançada/.test(code));

        t('espécie volta a aparecer, vinda do próprio evento de captura',
                /Machamp/.test(txt), txt);
            t('nível do selvagem vem do evento', /Nv\. 90/.test(txt), txt);
            t('a chance usada é a que o JOGO calculou, não a minha fórmula',
                /4,84%/.test(txt), txt);
            const hunt = win.document.querySelector('#pp-rt-hunt');
            // O andaime de diagnóstico das 7.13.1–7.13.3 saiu do rodapé: ele
        // apontou a mudança do jogo e depois virava ruído permanente.
        t('o rodapé não traz mais o despejo de eventos e estruturas',
            !/ESTRUTURA: /.test(code) && !/eventos novos: /.test(code)
            && !/CRIATURA EM: /.test(code) && !/function esbocar\(/.test(code)
            && !/eventosDesconhecidos/.test(code));
        t('mas o aviso curto de dado faltando fica',
            /o jogo parou de enviar o detalhe do combate/.test(code)
            && /!recebeuCombate/.test(code));
        t('a hunt é identificada por mapa+espécie do evento de captura',
                !!hunt && /Machamp/.test(hunt.textContent), hunt ? hunt.textContent : 'sem elemento');
        }

            // ---- duas contas, dois webhooks ----
            const HOOK_A = 'https://discord.com/api/webhooks/111/tokenA';
            const HOOK_B = 'https://discord.com/api/webhooks/222/tokenB';
            store.set('ppd_webhooks_v1', JSON.stringify({ '*': HOOK, LF: HOOK_A, LF2: HOOK_B }));
            const destinos = () => postados.slice(antes2).map(p => p.url);

            const capturarComo = (conta, q) => win.dispatchEvent(
                new win.CustomEvent('pokepixel-raridades:captura', { detail: {
                    versao: 1, conta,
                    captura: { sp: 'machamp', nome: 'Machamp', q, iv: 110, det: [20,31,18,4,22,15],
                               mult: 1.6, nat: 'adamant', gen: 'male', bola: 'Ultra Ball',
                               shiny: false, sold: false },
                } }));

            capturarComo('LF', 'legendary');
            capturarComo('LF2', 'legendary');
            t('cada conta usa o SEU webhook',
                destinos().length === 2 && destinos()[0] === HOOK_A && destinos()[1] === HOOK_B,
                JSON.stringify(destinos()));

            const antes3 = postados.length;
            capturarComo('ContaSemWebhook', 'legendary');
            t('conta sem webhook próprio cai no padrão',
                postados.length === antes3 + 1 && postados[antes3].url === HOOK,
                postados[antes3] ? postados[antes3].url : 'nada');

            t('a chave antiga de webhook único foi migrada para o padrão', (() => {
                let m = {}; try { m = JSON.parse(store.get('ppd_webhooks_v1')); } catch (e) {}
                return m['*'] === HOOK && !store.get('ppd_webhook_v1');
            })(), String(store.get('ppd_webhook_v1') || '(vazia)'));

            // ---- a corrida de tempo que fazia uma aba ficar sem dono ----
            // O principal anuncia a conta em document-start; o companheiro só
            // existe em document-idle. Aqui o companheiro é carregado DEPOIS
            // do anúncio, exatamente como no navegador.
            t('o companheiro descobre a conta mesmo carregando depois do anúncio',
                (() => {
                    const postados2 = [];
                    const sandT = Object.assign({}, sandbox, {
                        GM_xmlhttpRequest: o => {
                            postados2.push(o.url);
                            o.onload && o.onload({ status: 204, responseText: '' });
                        },
                    });
                    // anúncio ANTES do companheiro existir — cai no vazio
                    win.dispatchEvent(new win.CustomEvent('pokepixel-raridades:conta',
                        { detail: { versao: 1, conta: 'LF' } }));
                    store.set('ppd_webhooks_v1', JSON.stringify({ LF: HOOK_A }));
                    store.set('ppd_minimos_v1', JSON.stringify({ '*': 'epic' }));
                    try { vm.runInNewContext(codeD, vm.createContext(sandT)); }
                    catch (e) { return false; }
                    // ao subir, ele pergunta; o principal responde
                    return postados2.length === 0;
                })(), 'carregou sem erro');

            // O principal precisa responder a pergunta, senão a correção não
            // serve para nada.
            t('o principal responde quando perguntam de quem é a aba',
                /W\.addEventListener\(EVENTO_QUEM, anunciarConta\);/.test(code)
                && /const EVENTO_QUEM = 'pokepixel-raridades:quem';/.test(code));
            t('o companheiro pergunta em vez de só esperar',
                /W\.dispatchEvent\(new W\.CustomEvent\(EVENTO_QUEM/.test(codeD)
                && /perguntarConta\(\);/.test(codeD));

            // ---- raridade mínima por conta ----
            store.set('ppd_webhooks_v1', JSON.stringify({ LF: HOOK_A, LF2: HOOK_B }));
            store.set('ppd_minimos_v1', JSON.stringify({ '*': 'epic', LF: 'mythical', LF2: 'rare' }));
            const antes4 = postados.length;
            capturarComo('LF', 'legendary');   // abaixo do mínimo DELA (mítica)
            t('mínimo alto numa conta silencia só ela',
                postados.length === antes4, postados.length - antes4 + ' post(s)');
            capturarComo('LF2', 'legendary');  // acima do mínimo DELA (rara)
            t('a outra conta continua avisando com o mínimo dela',
                postados.length === antes4 + 1
                && postados[antes4].url === HOOK_B, JSON.stringify(postados.slice(antes4).map(p => p.url)));
            t('mínimo é lido por conta, não global',
                /function minimoDe\(conta\)/.test(codeD)
                && /nivelDe\(minimoDe\(d\.conta\)\)/.test(codeD)
                && !/ler\(K_MIN, 'epic'\)/.test(codeD));

        }
    }

    // ---- zerar e excluir: as duas ações que apagam dados ----
    // Nunca tinham teste: o sandbox não fornecia confirm(), então a chamada
    // lançava e o handler morria antes de fazer qualquer coisa.
    {
        const btn = win.document.querySelector('#pp-rt-reset');
        const del = win.document.querySelector('#pp-rt-del');
        t('o código NÃO usa mais confirm() do navegador',
            !/[^.\w]confirm\s*\(/.test(code.replace(/\/\/[^\n]*/g, '')),
            'sem confirm() fora de comentário');

        const totalDe = () => win.document.querySelector('#pp-rt-rows').textContent;
        const antes = totalDe();
        confirms.length = 0;

        btn.click();
        t('o primeiro clique NÃO apaga nada', totalDe() === antes);
        t('o primeiro clique arma o botão e avisa',
            btn.classList.contains('pp-rt-armado') && /Confirmar|\?/.test(btn.textContent),
            btn.textContent);
        t('nenhum diálogo do navegador foi usado', confirms.length === 0);

        btn.click();
        t('o segundo clique executa', totalDe() !== antes, totalDe().slice(0, 40));
        t('depois de executar, o botão desarma',
            !btn.classList.contains('pp-rt-armado') && /Zerar/.test(btn.textContent),
            btn.textContent);

        t('excluir perfil fica desabilitado sem hunt selecionada', del.disabled === true);
    }


    // menu do Tampermonkey
    let dump = null;
    const copiar = menu.find(m => /copiar/i.test(m[0]));
    if (copiar) { copiar[1](); }
    if (clipboard) { try { dump = JSON.parse(clipboard); } catch (e) {} }
    const baixar = menu.find(m => /baixar/i.test(m[0]));
    let erroBaixar = null;
    try { if (baixar) baixar[1](); } catch (e) { erroBaixar = e; }
    t('baixar não gerou alerta de erro', !alerts.some(a => /não consegui/i.test(a)), alerts.join(' // '));

    // regex não pode casar coisa errada
    t('URL não-species ignorada', !/\/species(\/[^/?]+)?(\?|$)/.test('/api/species-catalog/extra/deep'));
    t('URL com querystring casa', /\/species(\/[^/?]+)?(\?|$)/.test('/api/species/machamp?x=1'));
    t('catálogo em lista casa', /\/species(\/[^/?]+)?(\?|$)/.test('/api/species'));

    // persistência entre sessões: recarrega num sandbox novo com o mesmo store
    const s2 = Object.assign({}, sandbox);
    const dom2 = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://pokepixel.nietore.com/play/' });
    s2.unsafeWindow = dom2.window; s2.window = dom2.window; s2.document = dom2.window.document;
    dom2.window.WebSocket = FakeWS;
    dom2.window.fetch = () => Promise.resolve({ clone: () => ({ json: async () => ({}) }), json: async () => ({}) });
    s2.setTimeout = dom2.window.setTimeout.bind(dom2.window);
    s2.clearTimeout = dom2.window.clearTimeout.bind(dom2.window);
    s2.setInterval = dom2.window.setInterval.bind(dom2.window);
    s2.clearInterval = dom2.window.clearInterval.bind(dom2.window);
    s2.globalThis = s2;
    vm.createContext(s2);
    let erro2 = null;
    try { vm.runInContext(code, s2, { filename: SRC }); } catch (e) { erro2 = e; }
    t('recarrega sem erro com cache preenchido', !erro2, erro2 && erro2.message);
    await new Promise(r => setTimeout(r, 100));
    const d2 = null;
    const cache2 = store.get('pokepixel_species_cache_v1');
    let par2 = null; try { par2 = JSON.parse(cache2); } catch (e) {}
    t('base stats sobrevivem ao reload (sessão nova, zero requisições)',
        !!(par2 && par2.machamp && par2.machamp.base && par2.machamp.base.atk === 130),
        par2 ? JSON.stringify(par2.machamp.base) : 'sem cache');

    console.log('\n=== PASSOU (' + ok.length + ') ===');
    ok.forEach(x => console.log('  ok  ' + x));
    if (falhou.length) {
        console.log('\n=== FALHOU (' + falhou.length + ') ===');
        falhou.forEach(x => console.log('  XX  ' + x));
        process.exitCode = 1;
    } else {
        console.log("\nTodos os testes passaram.");
    }
})();

setTimeout(() => { console.log("[harness] encerrando"); process.exit(process.exitCode || 0); }, 20000).unref?.();

// ---- teste do analisador com dados reais ----
(async () => {
  await new Promise(r => setTimeout(r, 600));
  const fs=require('fs');
  const dump=JSON.parse(fs.readFileSync('/mnt/user-data/uploads/pokepixel-dump_1_.json','utf8'));
  const src=fs.readFileSync('./pokepixel-rarity-tracker.user.js','utf8');
  // extrai as funções puras do arquivo real e roda contra os dados do jogo
  const trecho=src.slice(src.indexOf('const QUAL_EXP'), src.indexOf('function analiseHtml'));
  const RARITIES=[{key:'weak'},{key:'common'},{key:'uncommon'},{key:'rare'},{key:'epic'},{key:'legendary'},{key:'mythical'}];
  const faixas={normal:{},shiny:{},iv:{}};
  const q=dump.formulas.quality;
  q.normal_quality_bands.forEach(b=>faixas.normal[b.label]={min:b.min,max:b.max});
  q.shiny_quality_bands.forEach(b=>faixas.shiny[b.label]={min:b.min,max:b.max});
  Object.entries(q.quality_iv_bands).forEach(([k,v])=>faixas.iv[k]={min:v.min,max:v.max});
  const faixaDe=(r,sh)=>(sh?faixas.shiny[r]:faixas.normal[r])||null;
  const speciesIndex=new Map(); const moveIndex=new Map();
  for(const sp of dump.species){ const arr=Array.isArray(sp)?sp:[sp];
    for(const x of arr){ speciesIndex.set(x.id,{base:x.base_stats,moves:x.learn_moves||[]});
      for(const m of (x.move_catalog||[])){ const c=(m.source_category||m.category||'').toLowerCase();
        if(c==='physical'||c==='special') moveIndex.set(m.id,{c:c==='physical'?'f':'e',p:m.power||0,cd:m.cooldown_ms||1}); } } }
  const NATUREZAS={careful:['',4,3],quiet:['',3,5],adamant:['',1,3],hardy:['',null,null],naive:['',5,4],modest:['',3,1]};
  const escapeHtml=x=>x;
  const ctx={faixas,faixaDe,speciesIndex,moveIndex,NATUREZAS,RARITIES,escapeHtml,IV_STAT_MAX:31,T:(k,...a)=>k,rotRaridade:k=>k,TIER_ORDEM:['weak','common','uncommon','rare','epic','legendary','mythical'],Math,Object,Array,Number,String,console};
  const vm2=require('vm'); vm2.createContext(ctx);
  vm2.runInContext(trecho+'\nthis.analisar=analisar; this.pesosDe=pesosDe;',ctx);

  const ok=[],bad=[];
  const t=(n,c,x)=>(c?ok:bad).push(n+(x?' — '+x:''));
  const P=ctx.pesosDe(speciesIndex.get('machamp'));
  t('machamp classificado como físico pelos golpes do jogo', P && P.medido && P.fis>0.99, P&&JSON.stringify({fis:P.fis,esp:P.esp,medido:P.medido}));
  t('peso de Atq. Esp. do machamp é ~zero', P && P.w.spa < 1, P&&String(P.w.spa));

  const c=dump.creatures.data.find(x=>x.species_id==='exeggutor');
  const ORD=['hp','atk','def','spa','spd','spe'];
  const e={sp:c.species_id,q:c.quality,mult:c.quality_multiplier,shiny:c.is_shiny,
           nat:c.nature,gen:c.gender,det:ORD.map(k=>c.ivs[k])};
  const A=ctx.analisar(e);
  t('analisa o exeggutor real', !!A);
  if(A){
    t('nota do tier entre 0 e 100', A.pctTier>0 && A.pctTier<=100, A.pctTier.toFixed(1)+'%');
    t('natureza e gênero agora alteram a nota (modelo do PPTools)', (() => {
        const A1=ctx.analisar({...e, nat:'adamant'});
        const A2=ctx.analisar({...e, nat:'modest'});
        const B1=ctx.analisar({...e, gen:'male'});
        const B2=ctx.analisar({...e, gen:'female'});
        return A1 && A2 && B1 && B2
            && Math.abs(A1.pctTier-A2.pctTier)>1e-9
            && Math.abs(B1.pctTier-B2.pctTier)>1e-9;
    })(), 'adamant≠modest e macho≠fêmea deveriam dar notas diferentes');
    t('mesmo IV total sem nat/gênero favorecendo nenhum atributo NÃO altera a nota', (() => {
        // hardy é neutra (não sobe/desce nada) e gen:'' não aciona o bônus de
        // gênero em nenhum atributo — sem favorecimento, a soma só depende do
        // IV TOTAL, não de onde ele foi distribuído (aqui: def<->spe).
        const A1=ctx.analisar({...e, nat:'hardy', gen:'', det:[6,10,20,31,20,10]});
        const A2=ctx.analisar({...e, nat:'hardy', gen:'', det:[6,10,10,31,20,20]});
        return A1 && A2 && Math.abs(A1.pctTier-A2.pctTier)<1e-9;
    })(), 'mesmo IV total redistribuído entre def e spe, sem nat/gênero favorecendo nenhum dos dois');
    t('pior rolagem do tier dá 0%', (() => {
        const banda=faixas.normal[e.q], ivB=faixas.iv[e.q];
        const v=[1,1,1,1,1,1]; let r=ivB.min-6,g=0;
        while(r>0&&g++<900){const j=(Math.random()*6)|0; if(v[j]<31){v[j]++;r--;}}
        const P=ctx.analisar({...e, mult:banda.min, det:v});
        return P && P.pctTier < 0.01;
    })(), 'piso do tier = 0%');
    t('só chega a 100% com IV e qualidade no topo do tier', (() => {
        const banda=faixas.normal[e.q], ivB=faixas.iv[e.q];
        const topo=ctx.analisar({...e, mult:banda.max, det:(()=>{const v=[31,31,31,31,31,31];
            let s=186; while(s>ivB.max){const i=v.findIndex(x=>x>1); v[i]--; s--;} return v;})()});
        return topo && topo.pctTier > 99.99;
    })(), 'topo do tier = 100%');
    t('nota da espécie menor que a do tier', A.pctEsp<A.pctTier, `tier ${A.pctTier.toFixed(1)}% / espécie ${A.pctEsp.toFixed(1)}%`);
    t('nenhuma rolagem do tier passa de 100%', (() => {
        const banda=faixas.normal[e.q], ivB=faixas.iv[e.q];
        let pior=0;
        for(let i=0;i<3000;i++){
            const tot=ivB.min+Math.floor(Math.random()*(ivB.max-ivB.min+1));
            const v=[1,1,1,1,1,1]; let r=tot-6,g=0;
            while(r>0&&g++<900){const j=(Math.random()*6)|0; if(v[j]<31){v[j]++;r--;}}
            const mu=banda.min+Math.random()*(banda.max-banda.min);
            const B=ctx.analisar({...e, det:v, mult:mu});
            if(B) pior=Math.max(pior,B.pctTier);
        }
        return pior<=100.0001;
    })(), 'maior razão observada');
  }
  const sh={...e,shiny:true,mult:1.85,q:'legendary'};
  const B=ctx.analisar(sh);
  t('shiny usa a tabela shiny', !!B && B.pctEsp<100, B&&`tier ${B.pctTier.toFixed(1)}% / espécie ${B.pctEsp.toFixed(1)}%`);
  t('sem base stats devolve null', ctx.analisar({...e,sp:'inexistente'})===null);
  t('sem det devolve null', ctx.analisar({...e,det:null})===null);

  console.log('\n=== ANALISADOR ('+ok.length+' ok) ===');
  ok.forEach(x=>console.log('  ok  '+x));
  if(bad.length){ console.log('=== FALHOU ==='); bad.forEach(x=>console.log('  XX  '+x)); process.exitCode=1; }
})();
