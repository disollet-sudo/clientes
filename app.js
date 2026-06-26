// ============================================================
// MAPA DE CLIENTES — app.js  (versão 2.0)
// ============================================================

const API_URL = "https://script.google.com/macros/s/AKfycbxh8ikW_2hvTdz2UVFm2ctxbE2iec5ICHYb3MgzFB_Cd3FnBOLA2JAsfgd2onU9FMD48g/exec";

// ============================================================
// ESTADO GLOBAL
// ============================================================
let map, clusterClientes, clusterProspects;
let todosClientes  = [];
let todosProspects = [];
let representantes = [];
let marcadoresRep  = {};
let circulosRep    = {};
let selecionandoLocRep = false;
let sidebarAberta  = true;
let dadosCarregados = false;
let repSelecionado  = null;
let rotaAtual       = [];
let rotaWazeCoords  = [];
let linhasRota      = [];

// ============================================================
// INICIALIZAÇÃO
// ============================================================
document.addEventListener("DOMContentLoaded", () => {
  inicializarMapa();
  // Não carrega dados aqui — espera a pesquisa do usuário
});

function inicializarMapa() {
  map = L.map("map", {
    center: [-15.78, -47.93],
    zoom: 5,
    zoomControl: true
  });

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '© <a href="https://openstreetmap.org">OpenStreetMap</a>',
    maxZoom: 19
  }).addTo(map);

  clusterClientes = L.markerClusterGroup({
    chunkedLoading: true,
    maxClusterRadius: 50,
    iconCreateFunction: criarIconeCluster
  });

  clusterProspects = L.markerClusterGroup({
    chunkedLoading: true,
    maxClusterRadius: 50,
    iconCreateFunction: criarIconeClusterProspect
  });

  map.addLayer(clusterClientes);
  map.addLayer(clusterProspects);

  map.on("click", onMapClick);
}

// ============================================================
// BUSCA INICIAL (welcome overlay)
// ============================================================
function setHint(texto) {
  document.getElementById("input-busca-welcome").value = texto;
  document.getElementById("input-busca-welcome").focus();
}

async function buscarECarregar() {
  const input = document.getElementById("input-busca-welcome");
  const query = input.value.trim();
  if (!query) { toast("Digite uma localização para buscar."); return; }

  const statusEl = document.getElementById("welcome-status");
  const btnGo = document.getElementById("btn-go");
  statusEl.textContent = "🔍 Localizando...";
  btnGo.disabled = true;

  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&countrycodes=br&limit=1&q=${encodeURIComponent(query)}`;
    const res = await fetch(url);
    const data = await res.json();

    if (!data || !data.length) {
      statusEl.textContent = "❌ Local não encontrado. Tente: 'Rio Grande do Sul' ou 'São Paulo, SP'";
      btnGo.disabled = false;
      return;
    }

    const lat = parseFloat(data[0].lat);
    const lon = parseFloat(data[0].lon);
    const nome = data[0].display_name.split(",")[0];
    const bbox = data[0].boundingbox; // [minlat, maxlat, minlng, maxlng]

    statusEl.textContent = "📦 Carregando dados...";

    // Fechar overlay e mostrar mapa
    document.getElementById("welcome-overlay").classList.add("hidden");
    document.getElementById("top-bar").classList.remove("hidden");
    document.getElementById("top-location-label").textContent = nome;
    document.getElementById("sb-location-label").textContent = "📍 " + nome;

    // Ajusta zoom pelo bounding box se disponível
    if (bbox) {
      const bounds = [[parseFloat(bbox[0]), parseFloat(bbox[2])], [parseFloat(bbox[1]), parseFloat(bbox[3])]];
      map.fitBounds(bounds, { padding: [40, 40] });
    } else {
      map.flyTo([lat, lon], 10, { animate: true, duration: 1.2 });
    }

    // Carrega dados (se ainda não carregou)
    if (!dadosCarregados) {
      await carregarTudo();
    }

    atualizarTopBar();
    atualizarPainelAnalise();

  } catch(e) {
    statusEl.textContent = "❌ Erro de conexão. Tente novamente.";
    console.error(e);
  }

  btnGo.disabled = false;
}

async function buscarMini() {
  const input = document.getElementById("input-busca-mini");
  const query = input.value.trim();
  if (!query) return;

  mostrarLoading(true, "Localizando...");
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&countrycodes=br&limit=1&q=${encodeURIComponent(query)}`;
    const res = await fetch(url);
    const data = await res.json();
    if (data && data.length) {
      const lat = parseFloat(data[0].lat);
      const lon = parseFloat(data[0].lon);
      const nome = data[0].display_name.split(",")[0];
      const bbox = data[0].boundingbox;

      document.getElementById("top-location-label").textContent = nome;
      document.getElementById("sb-location-label").textContent = "📍 " + nome;

      if (bbox) {
        const bounds = [[parseFloat(bbox[0]), parseFloat(bbox[2])], [parseFloat(bbox[1]), parseFloat(bbox[3])]];
        map.fitBounds(bounds, { padding: [40, 40] });
      } else {
        map.flyTo([lat, lon], 10);
      }
    } else {
      toast("Local não encontrado.");
    }
  } catch(e) {
    toast("Erro ao buscar local.");
  }
  mostrarLoading(false);
}

function novaBusca() {
  const overlay = document.getElementById("welcome-overlay");
  overlay.classList.remove("hidden");
  document.getElementById("input-busca-welcome").value = "";
  document.getElementById("welcome-status").textContent = "";
  document.getElementById("btn-go").disabled = false;
  setTimeout(() => document.getElementById("input-busca-welcome").focus(), 100);
}

// ============================================================
// CARREGAR DADOS
// ============================================================
async function carregarTudo() {
  mostrarLoading(true, "Carregando clientes e representantes...");
  try {
    await Promise.all([carregarClientes(), carregarRepresentantes()]);
    dadosCarregados = true;
  } catch(e) {
    toast("Erro ao carregar dados: " + e.message, 5000);
  }
  mostrarLoading(false);
}

// ============================================================
// CLIENTES — ícones diferenciados
// ============================================================
async function carregarClientes() {
  const dados = await chamarAPI({ action: "clientes" });
  if (dados.error) throw new Error(dados.error);
  todosClientes = dados.clientes || [];
  renderizarClientes(todosClientes);
  atualizarPills();
}

function criarIconeCliente(c) {
  const cor    = c.status === "ativo" ? "#22c55e" : "#ef4444";
  const borda  = c.status === "ativo" ? "#16a34a" : "#dc2626";
  return L.circleMarker([c.lat, c.lng], {
    radius: 7,
    fillColor: cor,
    color: borda,
    weight: 1.5,
    fillOpacity: 0.88
  });
}

function renderizarClientes(lista) {
  clusterClientes.clearLayers();
  const listEl = document.getElementById("lista-clientes");
  listEl.innerHTML = "";
  let semCoord = 0;

  lista.forEach(c => {
    if (c.lat && c.lng) {
      const m = criarIconeCliente(c);
      m.bindPopup(popupCliente(c));
      m.on("click", () => {});
      clusterClientes.addLayer(m);
    } else semCoord++;

    const div = document.createElement("div");
    div.className = "cliente-item";
    div.innerHTML = `
      <div class="cliente-nome">${c.nome || c.cnpj}</div>
      <div class="cliente-info">
        <span class="badge ${c.status}">${c.status || "—"}</span>
        ${c.municipio ? " · " + c.municipio : ""}
        ${c.representante ? " · " + c.representante : ""}
      </div>`;
    div.onclick = () => {
      if (c.lat && c.lng) map.flyTo([c.lat, c.lng], 15);
      else toast("Sem coordenadas — use 'Geocodificar'.");
    };
    listEl.appendChild(div);
  });

  if (semCoord > 0) {
    const aviso = document.createElement("div");
    aviso.style.cssText = "padding:10px 14px;font-size:11px;color:#888;text-align:center;border-top:1px solid #f0efe8";
    aviso.textContent = `⚠ ${semCoord} clientes sem coordenadas`;
    listEl.appendChild(aviso);
  }
}

function filtrarClientes() {
  const municipio = (document.getElementById("filtro-municipio").value || "").toLowerCase();
  const status    = (document.getElementById("filtro-status").value   || "").toLowerCase();
  const rep       = (document.getElementById("filtro-rep").value      || "").toLowerCase();
  const nome      = (document.getElementById("filtro-nome").value     || "").toLowerCase();

  const filtrados = todosClientes.filter(c => {
    if (municipio && !(c.municipio||"").toLowerCase().includes(municipio)) return false;
    if (status    && c.status !== status) return false;
    if (rep       && !(c.representante||"").toLowerCase().includes(rep)) return false;
    if (nome      && !(c.nome||"").toLowerCase().includes(nome) && !(c.cnpj||"").includes(nome)) return false;
    return true;
  });
  renderizarClientes(filtrados);
}

function popupCliente(c) {
  return `
    <div class="popup-nome">${c.nome || "Sem nome"}</div>
    <div class="popup-info">
      <b>CNPJ:</b> ${c.cnpj || "—"}<br>
      <b>Status:</b> <span class="badge ${c.status}">${c.status || "—"}</span><br>
      <b>Endereço:</b> ${c.endereco || "—"}<br>
      <b>Município:</b> ${c.municipio || "—"} ${c.uf ? "/ "+c.uf : ""}<br>
      <b>CNAE:</b> ${c.cnae || "—"}<br>
      <b>Representante:</b> ${c.representante || "Sem representante"}
      ${c.fone ? "<br><b>Fone:</b> " + c.fone : ""}
    </div>`;
}

// ============================================================
// PROSPECTS — ícone diamante azul
// ============================================================
async function buscarProspects() {
  mostrarLoading(true, "Buscando prospects...");
  const cnae      = document.getElementById("filtro-cnae").value;
  const municipio = document.getElementById("filtro-prospect-municipio").value;
  const dados     = await chamarAPI({ action: "prospects", cnae, municipio });
  todosProspects  = dados.prospects || [];
  renderizarProspects(todosProspects);
  mostrarLoading(false);
  atualizarPills();
  atualizarPainelAnalise();
}

function filtrarProspects() { buscarProspects(); }

function criarIconeProspect(p) {
  // Diamante via divIcon rotacionado
  return L.marker([p.lat, p.lng], {
    icon: L.divIcon({
      html: `<div style="
        width:11px;height:11px;
        background:#3b82f6;
        border:1.5px solid #1d4ed8;
        transform:rotate(45deg);
        border-radius:2px;
      "></div>`,
      className: "",
      iconSize: [11, 11],
      iconAnchor: [5.5, 5.5]
    })
  });
}

function renderizarProspects(lista) {
  clusterProspects.clearLayers();
  const listEl = document.getElementById("lista-prospects");
  listEl.innerHTML = "";

  lista.forEach(p => {
    if (p.lat && p.lng) {
      const m = criarIconeProspect(p);
      m.bindPopup(`
        <div class="popup-nome">${p.nome || "Prospect"}</div>
        <div class="popup-info">
          <b>CNPJ:</b> ${p.cnpj}<br>
          <b>CNAE:</b> ${p.cnae}<br>
          <b>Município:</b> ${p.municipio}<br>
          <b>Endereço:</b> ${p.endereco}
        </div>`);
      clusterProspects.addLayer(m);
    }
    const div = document.createElement("div");
    div.className = "cliente-item";
    div.innerHTML = `
      <div class="cliente-nome">${p.nome || p.cnpj}</div>
      <div class="cliente-info">
        <span class="badge prospect">Prospect</span>
        ${p.municipio ? " · " + p.municipio : ""}
        · ${p.cnae}
      </div>`;
    div.onclick = () => { if (p.lat && p.lng) map.flyTo([p.lat, p.lng], 15); };
    listEl.appendChild(div);
  });

  if (lista.length === 0) {
    listEl.innerHTML = `<div style="padding:20px;text-align:center;color:#888;font-size:13px">
      Nenhum prospect encontrado.<br><small>Adicione dados na aba "Prospects" da planilha.</small>
    </div>`;
  }
}

// ============================================================
// REPRESENTANTES — ícone boneco 👤
// ============================================================
async function carregarRepresentantes() {
  const dados = await chamarAPI({ action: "representantes" });
  representantes = dados.representantes || [];
  renderizarRepresentantes();
}

function criarIconeRep(rep) {
  return L.divIcon({
    html: `<div style="
      position:relative;
      width:36px; height:36px;
      display:flex; align-items:center; justify-content:center;
    ">
      <div style="
        position:absolute;
        width:36px; height:36px;
        border-radius:50%;
        background:${rep.cor}22;
        border:2px solid ${rep.cor};
      "></div>
      <span style="font-size:18px;line-height:1;position:relative;z-index:1">👤</span>
    </div>`,
    className: "",
    iconSize: [36, 36],
    iconAnchor: [18, 18]
  });
}

function renderizarRepresentantes() {
  const listEl = document.getElementById("rep-lista");
  listEl.innerHTML = "";

  // Limpar marcadores e círculos antigos
  Object.values(marcadoresRep).forEach(m => map.removeLayer(m));
  Object.values(circulosRep).forEach(c => map.removeLayer(c));
  marcadoresRep = {};
  circulosRep   = {};

  representantes.forEach(rep => {
    if (rep.lat && rep.lng) {
      const icone  = criarIconeRep(rep);
      const marker = L.marker([rep.lat, rep.lng], { icon: icone, zIndexOffset: 1000 });
      marker.bindPopup(popupRepresentante(rep));

      // Clique no marcador do rep → seleciona e mostra rota
      marker.on("click", () => selecionarRep(rep));
      marker.addTo(map);
      marcadoresRep[rep.id] = marker;

      const circulo = L.circle([rep.lat, rep.lng], {
        radius: rep.raioKm * 1000,
        fillColor: rep.cor,
        fillOpacity: 0.05,
        color: rep.cor,
        weight: 1.5,
        dashArray: "6 4"
      });
      circulo.addTo(map);
      circulosRep[rep.id] = circulo;
    }

    const stats = calcularEstatisticasRep(rep);
    const card  = document.createElement("div");
    card.className = "rep-card";
    card.id = "rep-card-" + rep.id;
    card.innerHTML = `
      <div class="rep-card-header">
        <div class="rep-dot" style="background:${rep.cor}"></div>
        <span class="rep-nome">${rep.nome}</span>
        <div class="rep-actions">
          <button class="btn-sm" onclick="event.stopPropagation();editarRep('${rep.id}')">✏️</button>
          <button class="btn-sm danger" onclick="event.stopPropagation();deletarRep('${rep.id}')">🗑</button>
        </div>
      </div>
      <div class="rep-info">
        ${rep.municipio ? "📍 " + rep.municipio + " · " : ""}⭕ ${rep.raioKm} km
        ${rep.telefone ? " · 📞 " + rep.telefone : ""}
      </div>
      <div class="rep-stats">
        <div class="rep-stat">
          <strong style="color:var(--green)">${stats.clientesAtivos}</strong>Ativos
        </div>
        <div class="rep-stat">
          <strong style="color:var(--red)">${stats.clientesInativos}</strong>Inativos
        </div>
        <div class="rep-stat">
          <strong style="color:var(--blue)">${stats.prospectsNoRaio}</strong>Prospects
        </div>
        <div class="rep-stat">
          <strong style="color:var(--amber)">${stats.taxaAtivacao}%</strong>Taxa ativ.
        </div>
      </div>`;
    card.onclick = (e) => {
      if (e.target.closest("button")) return;
      if (rep.lat && rep.lng) {
        map.flyTo([rep.lat, rep.lng], 10);
        selecionarRep(rep);
      }
    };
    listEl.appendChild(card);
  });

  if (representantes.length === 0) {
    listEl.innerHTML = `<div style="padding:20px;text-align:center;color:#888;font-size:13px">
      Nenhum representante cadastrado.<br>Preencha o formulário abaixo.
    </div>`;
  }
}

function calcularEstatisticasRep(rep) {
  if (!rep.lat || !rep.lng) return { clientesAtivos: 0, clientesInativos: 0, prospectsNoRaio: 0, taxaAtivacao: 0 };
  const raioM = rep.raioKm * 1000;
  let ativos = 0, inativos = 0, prospects = 0;

  todosClientes.forEach(c => {
    if (!c.lat || !c.lng) return;
    if (distanciaKm(rep.lat, rep.lng, c.lat, c.lng) * 1000 <= raioM) {
      c.status === "ativo" ? ativos++ : inativos++;
    }
  });
  todosProspects.forEach(p => {
    if (!p.lat || !p.lng) return;
    if (distanciaKm(rep.lat, rep.lng, p.lat, p.lng) * 1000 <= raioM) prospects++;
  });

  const total = ativos + inativos;
  const taxa  = total > 0 ? Math.round((ativos / total) * 100) : 0;
  return { clientesAtivos: ativos, clientesInativos: inativos, prospectsNoRaio: prospects, taxaAtivacao: taxa };
}

function popupRepresentante(rep) {
  const s = calcularEstatisticasRep(rep);
  return `
    <div class="popup-nome">👤 ${rep.nome}</div>
    <div class="popup-info">
      <b>Município:</b> ${rep.municipio || "—"}<br>
      <b>Raio:</b> ${rep.raioKm} km<br>
      <b>Tel:</b> ${rep.telefone || "—"} · <b>E-mail:</b> ${rep.email || "—"}<br>
      <hr style="margin:6px 0;border:none;border-top:1px solid #eee">
      ✅ ${s.clientesAtivos} ativos · ❌ ${s.clientesInativos} inativos · 🎯 ${s.prospectsNoRaio} prospects<br>
      Taxa de ativação: <b>${s.taxaAtivacao}%</b>
      <br><br>
      <button onclick="selecionarRepById('${rep.id}')" style="
        padding:5px 12px;background:#1a1a18;color:#fff;
        border:none;border-radius:6px;cursor:pointer;font-size:12px;width:100%
      ">📍 Ver rota deste representante</button>
    </div>`;
}

// ============================================================
// SELEÇÃO DE REP → ROTA + PAINEL
// ============================================================
function selecionarRepById(id) {
  const rep = representantes.find(r => r.id === id);
  if (rep) selecionarRep(rep);
}

function selecionarRep(rep) {
  // Highlight do card
  document.querySelectorAll(".rep-card").forEach(c => c.classList.remove("selected"));
  const card = document.getElementById("rep-card-" + rep.id);
  if (card) card.classList.add("selected");

  repSelecionado = rep;
  mostrarRotaRep(rep);
  atualizarPainelAnalise(rep);

  // Navegar para aba de análise
  document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
  document.getElementById("tab-analise").classList.add("active");
  document.querySelector(".tab-btn").classList.add("active");
}

function mostrarRotaRep(rep) {
  // Remove linhas anteriores
  linhasRota.forEach(l => map.removeLayer(l));
  linhasRota = [];

  if (!rep.lat || !rep.lng) return;

  // Coletar clientes ativos no raio
  const raioM = rep.raioKm * 1000;
  const ativosNoRaio = todosClientes
    .filter(c => c.lat && c.lng && c.status === "ativo"
      && distanciaKm(rep.lat, rep.lng, c.lat, c.lng) * 1000 <= raioM)
    .sort((a, b) =>
      distanciaKm(rep.lat, rep.lng, a.lat, a.lng) -
      distanciaKm(rep.lat, rep.lng, b.lat, b.lng)
    );

  const prospectsNoRaio = todosProspects
    .filter(p => p.lat && p.lng
      && distanciaKm(rep.lat, rep.lng, p.lat, p.lng) * 1000 <= raioM);

  // Desenhar linhas de rota: rep → cada ativo
  ativosNoRaio.forEach((c, i) => {
    const linha = L.polyline([
      [rep.lat, rep.lng],
      [c.lat, c.lng]
    ], {
      color: rep.cor,
      weight: 1.5,
      opacity: 0.5,
      dashArray: "4 4"
    }).addTo(map);
    linhasRota.push(linha);
  });

  // Salvar para Waze
  rotaWazeCoords = [
    { lat: rep.lat, lng: rep.lng, nome: rep.nome },
    ...ativosNoRaio.map(c => ({ lat: c.lat, lng: c.lng, nome: c.nome || c.cnpj }))
  ];

  // Montar painel de rota
  const panel = document.getElementById("rota-panel");
  const list  = document.getElementById("rota-list");
  document.getElementById("rota-titulo").textContent = `Rota de ${rep.nome}`;
  list.innerHTML = "";

  // Item 0: ponto de partida
  const li0 = document.createElement("div");
  li0.className = "rota-item";
  li0.innerHTML = `<div class="rota-num" style="background:${rep.cor}">👤</div>
    <div class="rota-nome"><strong>${rep.nome}</strong> (partida)</div>`;
  list.appendChild(li0);

  ativosNoRaio.forEach((c, i) => {
    const dist = distanciaKm(rep.lat, rep.lng, c.lat, c.lng).toFixed(1);
    const li = document.createElement("div");
    li.className = "rota-item";
    li.innerHTML = `
      <div class="rota-num">${i+1}</div>
      <div class="rota-nome">${c.nome || c.cnpj}</div>
      <div class="rota-dist">${dist} km</div>`;
    li.onclick = () => map.flyTo([c.lat, c.lng], 15);
    list.appendChild(li);
  });

  if (prospectsNoRaio.length > 0) {
    const sep = document.createElement("div");
    sep.style.cssText = "padding:6px 0;font-size:10px;font-weight:600;text-transform:uppercase;color:var(--blue);letter-spacing:.05em;margin-top:4px";
    sep.textContent = `🎯 ${prospectsNoRaio.length} prospects na área`;
    list.appendChild(sep);

    prospectsNoRaio.slice(0, 5).forEach(p => {
      const li = document.createElement("div");
      li.className = "rota-item";
      li.innerHTML = `
        <div class="rota-num" style="background:var(--blue)">P</div>
        <div class="rota-nome">${p.nome || p.cnpj}</div>`;
      li.onclick = () => map.flyTo([p.lat, p.lng], 15);
      list.appendChild(li);
    });
  }

  panel.classList.add("visible");
  rotaAtual = ativosNoRaio;
}

function fecharRota() {
  document.getElementById("rota-panel").classList.remove("visible");
  linhasRota.forEach(l => map.removeLayer(l));
  linhasRota = [];
  document.querySelectorAll(".rep-card").forEach(c => c.classList.remove("selected"));
  repSelecionado = null;
  atualizarPainelAnalise();
}

function abrirRotaWaze() {
  if (!rotaWazeCoords.length) { toast("Nenhuma rota calculada."); return; }
  // Waze suporta apenas destino único — abre para o primeiro cliente
  const dest = rotaWazeCoords[1] || rotaWazeCoords[0];
  const url  = `https://waze.com/ul?ll=${dest.lat},${dest.lng}&navigate=yes`;
  window.open(url, "_blank");
  if (rotaWazeCoords.length > 2) {
    toast(`💡 Waze aceita 1 destino por vez. Abrindo para ${dest.nome}.`);
  }
}

// ============================================================
// PAINEL DE ANÁLISE (sidebar aba Análise)
// ============================================================
function atualizarPainelAnalise(repFoco) {
  const painel = document.getElementById("painel-analise");
  const ativos   = todosClientes.filter(c => c.status === "ativo").length;
  const inativos = todosClientes.filter(c => c.status !== "ativo").length;
  const total    = todosClientes.length;
  const taxaAtiv = total > 0 ? Math.round((ativos / total) * 100) : 0;
  const nReps    = representantes.length;
  const nProsp   = todosProspects.length;

  // Clientes sem representante
  const semRep = todosClientes.filter(c => !c.representante || c.representante.trim() === "").length;

  // Oportunidades: prospects > 0 e rep com baixa taxa
  const repBaixaTaxa = representantes.filter(r => {
    const s = calcularEstatisticasRep(r);
    return s.taxaAtivacao < 50 && (s.clientesAtivos + s.clientesInativos) >= 2;
  });

  // Prospects não cobertos por nenhum rep
  const prospectsNaoCobertosPorRep = todosProspects.filter(p => {
    if (!p.lat || !p.lng) return false;
    return !representantes.some(r => {
      if (!r.lat || !r.lng) return false;
      return distanciaKm(r.lat, r.lng, p.lat, p.lng) * 1000 <= r.raioKm * 1000;
    });
  }).length;

  let html = "";

  // ── KPIs principais ──
  html += `<div class="analise-section">
    <div class="analise-titulo">Visão Geral</div>
    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-value" style="color:var(--text)">${total.toLocaleString("pt-BR")}</div>
        <div class="kpi-label">Total de clientes</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-value" style="color:var(--green)">${ativos.toLocaleString("pt-BR")}</div>
        <div class="kpi-label">Clientes ativos</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-value" style="color:var(--red)">${inativos.toLocaleString("pt-BR")}</div>
        <div class="kpi-label">Clientes inativos</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-value" style="color:var(--blue)">${nProsp.toLocaleString("pt-BR")}</div>
        <div class="kpi-label">Prospects</div>
      </div>
    </div>
    <div class="kpi-grid">
      <div class="kpi-card">
        <div class="kpi-value" style="color:var(--purple)">${nReps}</div>
        <div class="kpi-label">Representantes</div>
      </div>
      <div class="kpi-card">
        <div class="kpi-value" style="color:${taxaAtiv >= 60 ? 'var(--green)' : taxaAtiv >= 40 ? 'var(--amber)' : 'var(--red)'}">${taxaAtiv}%</div>
        <div class="kpi-label">Taxa de ativação</div>
      </div>
    </div>
  </div>`;

  // ── Barra de ativação ──
  html += `<div class="analise-section">
    <div class="analise-titulo">Taxa de Ativação da Carteira</div>
    <div class="conv-bar-wrap">
      <div class="conv-bar-label">
        <span><strong>${ativos}</strong> ativos de ${total}</span>
        <span>${taxaAtiv}%</span>
      </div>
      <div class="conv-bar-track">
        <div class="conv-bar-fill" style="width:${taxaAtiv}%;background:${taxaAtiv >= 60 ? 'var(--green)' : taxaAtiv >= 40 ? 'var(--amber)' : 'var(--red)'}"></div>
      </div>
    </div>
  </div>`;

  // ── Alertas e oportunidades ──
  html += `<div class="analise-section"><div class="analise-titulo">Alertas & Oportunidades</div>`;

  if (inativos > 0) {
    html += `<div class="alerta danger">
      <span class="alerta-icon">🔴</span>
      <div class="alerta-text">
        <strong>${inativos} clientes inativos</strong>
        <span>Potencial de reativação. Cada ativo perdido é receita que pode voltar.</span>
      </div>
    </div>`;
  }

  if (semRep > 0) {
    html += `<div class="alerta warn">
      <span class="alerta-icon">⚠️</span>
      <div class="alerta-text">
        <strong>${semRep} clientes sem representante</strong>
        <span>Esses clientes podem estar sem atendimento adequado.</span>
      </div>
    </div>`;
  }

  if (nReps === 0) {
    html += `<div class="alerta danger">
      <span class="alerta-icon">👤</span>
      <div class="alerta-text">
        <strong>Nenhum representante cadastrado</strong>
        <span>Cadastre representantes na aba "Reps" para visualizar cobertura e rotas.</span>
      </div>
    </div>`;
  } else if (nReps < 3 && total > 20) {
    html += `<div class="alerta warn">
      <span class="alerta-icon">👥</span>
      <div class="alerta-text">
        <strong>Poucos representantes (${nReps})</strong>
        <span>Com ${total} clientes, considere expandir a equipe de representação.</span>
      </div>
    </div>`;
  }

  if (nProsp > 0) {
    html += `<div class="alerta info">
      <span class="alerta-icon">🎯</span>
      <div class="alerta-text">
        <strong>${nProsp} prospects no mapa</strong>
        <span>Empresas com perfil de cliente que ainda não compram de você.</span>
      </div>
    </div>`;
  }

  if (prospectsNaoCobertosPorRep > 0) {
    html += `<div class="alerta warn">
      <span class="alerta-icon">📍</span>
      <div class="alerta-text">
        <strong>${prospectsNaoCobertosPorRep} prospects fora do raio de cobertura</strong>
        <span>Nenhum representante alcança esses prospects. Expanda o raio ou contrate novos reps.</span>
      </div>
    </div>`;
  }

  if (repBaixaTaxa.length > 0) {
    html += `<div class="alerta warn">
      <span class="alerta-icon">📉</span>
      <div class="alerta-text">
        <strong>${repBaixaTaxa.length} rep(s) com taxa de ativação < 50%</strong>
        <span>${repBaixaTaxa.map(r => r.nome).join(", ")}</span>
      </div>
    </div>`;
  }

  if (taxaAtiv >= 70 && nReps > 0) {
    html += `<div class="alerta success">
      <span class="alerta-icon">✅</span>
      <div class="alerta-text">
        <strong>Ótima taxa de ativação!</strong>
        <span>Foque em converter os ${nProsp} prospects para crescer ainda mais.</span>
      </div>
    </div>`;
  }

  html += `</div>`; // fim alertas

  // ── Seção por representante (se um está selecionado) ──
  if (repFoco && repFoco.lat && repFoco.lng) {
    const s = calcularEstatisticasRep(repFoco);
    const opp = s.prospectsNoRaio;
    const totalNoRaio = s.clientesAtivos + s.clientesInativos;

    html += `<div class="analise-section">
      <div class="analise-titulo">Representante Selecionado</div>
      <div class="rep-no-raio">
        <div class="rep-raio-header">
          <div class="rep-raio-dot" style="background:${repFoco.cor}"></div>
          <span class="rep-raio-nome">👤 ${repFoco.nome}</span>
          <button class="rep-raio-rota" onclick="mostrarRotaRep(repFoco)">Ver rota</button>
        </div>
        <div class="rep-raio-stats">
          <div class="rep-raio-stat">
            <strong style="color:var(--green)">${s.clientesAtivos}</strong>Ativos
          </div>
          <div class="rep-raio-stat">
            <strong style="color:var(--red)">${s.clientesInativos}</strong>Inativos
          </div>
          <div class="rep-raio-stat">
            <strong style="color:var(--blue)">${opp}</strong>Prospects
          </div>
          <div class="rep-raio-stat">
            <strong style="color:var(--amber)">${s.taxaAtivacao}%</strong>Ativação
          </div>
        </div>
        <div class="rep-raio-opp">
          ${opp > 0
            ? `🎯 <b>${opp} prospects</b> dentro do raio de ${repFoco.raioKm} km — oportunidade de conversão imediata!`
            : `Não há prospects mapeados no raio deste representante.`
          }
          ${s.clientesInativos > 0
            ? `<br>🔄 <b>${s.clientesInativos} clientes inativos</b> podem ser reativados nesta área.`
            : ""
          }
        </div>
      </div>
    </div>`;
  } else if (representantes.length > 0) {
    // Resumo de todos os reps
    html += `<div class="analise-section"><div class="analise-titulo">Cobertura por Representante</div>`;
    representantes.forEach(rep => {
      const s = calcularEstatisticasRep(rep);
      html += `<div class="rep-no-raio" onclick="selecionarRep(representantes.find(r=>r.id==='${rep.id}'))" style="cursor:pointer">
        <div class="rep-raio-header">
          <div class="rep-raio-dot" style="background:${rep.cor}"></div>
          <span class="rep-raio-nome">${rep.nome}</span>
        </div>
        <div class="rep-raio-stats">
          <div class="rep-raio-stat"><strong style="color:var(--green)">${s.clientesAtivos}</strong>Ativos</div>
          <div class="rep-raio-stat"><strong style="color:var(--red)">${s.clientesInativos}</strong>Inativos</div>
          <div class="rep-raio-stat"><strong style="color:var(--blue)">${s.prospectsNoRaio}</strong>Prospects</div>
          <div class="rep-raio-stat"><strong style="color:var(--amber)">${s.taxaAtivacao}%</strong>Ativação</div>
        </div>
      </div>`;
    });
    html += `</div>`;
  }

  painel.innerHTML = html;

  // Rebind da variável repFoco dentro do onclick inline
  if (repFoco) {
    window._repFocoAtual = repFoco;
    const btn = painel.querySelector(".rep-raio-rota");
    if (btn) btn.onclick = () => mostrarRotaRep(window._repFocoAtual);
  }
}

// ============================================================
// TOP BAR
// ============================================================
function atualizarTopBar() {
  const ativos   = todosClientes.filter(c => c.status === "ativo").length;
  const inativos = todosClientes.filter(c => c.status !== "ativo").length;
  document.getElementById("tb-ativos").textContent   = ativos + " ativos";
  document.getElementById("tb-inativos").textContent = inativos + " inativos";
  document.getElementById("tb-prospects").textContent = todosProspects.length + " prospects";
  document.getElementById("tb-reps").textContent     = representantes.length + " reps";
}

// ============================================================
// PILLS DO HEADER
// ============================================================
function atualizarPills() {
  atualizarTopBar();
}

// ============================================================
// REPRESENTANTES — CRUD
// ============================================================
function editarRep(id) {
  const rep = representantes.find(r => r.id === id);
  if (!rep) return;
  document.getElementById("rep-form-titulo").textContent = "Editar representante";
  document.getElementById("rep-id").value         = rep.id;
  document.getElementById("rep-nome").value       = rep.nome;
  document.getElementById("rep-tel").value        = rep.telefone;
  document.getElementById("rep-email").value      = rep.email;
  document.getElementById("rep-municipio").value  = rep.municipio;
  document.getElementById("rep-raio").value       = rep.raioKm;
  document.getElementById("rep-cor").value        = rep.cor;
  // Ir para aba reps
  document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
  document.getElementById("tab-representantes").classList.add("active");
  document.querySelectorAll(".tab-btn")[3].classList.add("active");
  toast("Edite os dados e clique em Salvar. Clique no mapa para mover a localização.");
}

function cancelarFormRep() {
  ["rep-id","rep-nome","rep-tel","rep-email","rep-municipio"].forEach(id => document.getElementById(id).value = "");
  document.getElementById("rep-raio").value = "50";
  document.getElementById("rep-cor").value  = "#3B82F6";
  document.getElementById("rep-form-titulo").textContent = "+ Novo representante";
  selecionandoLocRep = false;
  window._pendingLat = null;
  window._pendingLng = null;
}

async function salvarRepresentante() {
  const nome = document.getElementById("rep-nome").value.trim();
  if (!nome) { toast("Digite o nome do representante."); return; }

  const id       = document.getElementById("rep-id").value || String(Date.now());
  const existente = representantes.find(r => r.id === id);

  const payload = {
    action: "salvarRepresentante", id, nome,
    telefone:  document.getElementById("rep-tel").value,
    email:     document.getElementById("rep-email").value,
    municipio: document.getElementById("rep-municipio").value,
    raioKm:    parseFloat(document.getElementById("rep-raio").value) || 50,
    cor:       document.getElementById("rep-cor").value,
    lat: window._pendingLat || (existente ? existente.lat : 0),
    lng: window._pendingLng || (existente ? existente.lng : 0)
  };

  mostrarLoading(true, "Salvando...");
  const resp = await chamarAPIPost(payload);
  mostrarLoading(false);

  if (resp.ok) {
    toast(`Representante ${resp.acao === "criado" ? "cadastrado" : "atualizado"}!`);
    window._pendingLat = null;
    window._pendingLng = null;
    cancelarFormRep();
    await carregarRepresentantes();
    atualizarPainelAnalise();
    atualizarTopBar();
  } else {
    toast("Erro: " + (resp.error || "Falha ao salvar"));
  }
}

async function deletarRep(id) {
  if (!confirm("Remover este representante?")) return;
  mostrarLoading(true, "Removendo...");
  const resp = await chamarAPIPost({ action: "deletarRepresentante", id });
  mostrarLoading(false);
  if (resp.ok) {
    toast("Representante removido.");
    fecharRota();
    await carregarRepresentantes();
    atualizarPainelAnalise();
  }
}

function onMapClick(e) {
  const tab = document.querySelector(".tab-btn.active");
  if (!tab || !tab.textContent.includes("Reps")) return;

  const { lat, lng } = e.latlng;
  reverseGeocode(lat, lng).then(municipio => {
    if (!document.getElementById("rep-municipio").value) {
      document.getElementById("rep-municipio").value = municipio;
    }
  });

  const id = document.getElementById("rep-id").value;
  if (id) {
    const rep = representantes.find(r => r.id === id);
    if (rep) { rep.lat = lat; rep.lng = lng; }
  }

  window._pendingLat = lat;
  window._pendingLng = lng;
  toast(`📍 Localização definida: ${lat.toFixed(4)}, ${lng.toFixed(4)}`);
}

// ============================================================
// GEOCODIFICAÇÃO
// ============================================================
async function geocodificarPendentes() {
  if (!confirm("Geocodificar todos os endereços sem coordenadas? Pode demorar.")) return;
  mostrarLoading(true, "Geocodificando... aguarde");
  const resp = await chamarAPIPost({ action: "geocodificarPendentes" });
  mostrarLoading(false);
  if (resp.geocodificados !== undefined) {
    toast(`✅ ${resp.geocodificados} geocodificados, ${resp.erros} erros.`, 5000);
    await carregarClientes();
    atualizarPainelAnalise();
  }
}

async function reverseGeocode(lat, lng) {
  try {
    const resp = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`);
    const data = await resp.json();
    return data.address?.city || data.address?.town || data.address?.municipality || "";
  } catch(e) { return ""; }
}

// ============================================================
// EXPORTAR CSV
// ============================================================
function exportarCSV() {
  if (!todosClientes.length) { toast("Nenhum dado para exportar."); return; }
  const cab  = ["CNPJ","Nome","Município","Status","CNAE","Representante","Lat","Lng"];
  const rows = todosClientes.map(c =>
    [c.cnpj, c.nome, c.municipio, c.status, c.cnae, c.representante, c.lat, c.lng]
      .map(v => `"${String(v||"").replace(/"/g,'""')}"`)
      .join(",")
  );
  const csv  = [cab.join(","), ...rows].join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = "clientes_" + new Date().toISOString().slice(0,10) + ".csv";
  a.click(); URL.revokeObjectURL(url);
}

// ============================================================
// UTILITÁRIOS
// ============================================================
function switchTab(nome, btn) {
  document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
  document.getElementById("tab-" + nome).classList.add("active");
  btn.classList.add("active");
}

function toggleSidebar() {
  sidebarAberta = !sidebarAberta;
  const sidebar = document.getElementById("sidebar");
  const btn     = document.getElementById("btn-toggle-sidebar");
  sidebar.classList.toggle("collapsed", !sidebarAberta);
  btn.textContent = sidebarAberta ? "◀" : "▶";
}

function mostrarLoading(show, msg) {
  document.getElementById("loading").classList.toggle("hidden", !show);
  if (msg) document.getElementById("loading-msg").textContent = msg;
}

function toast(msg, duracao = 3200) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove("show"), duracao);
}

function distanciaKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 +
    Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) * Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function criarIconeCluster(cluster) {
  const count = cluster.getChildCount();
  const size  = count < 100 ? 34 : count < 500 ? 40 : 48;
  return L.divIcon({
    html: `<div style="
      background:rgba(26,26,24,0.85);color:#fff;
      width:${size}px;height:${size}px;border-radius:50%;
      display:flex;align-items:center;justify-content:center;
      font-size:${size < 40 ? 12 : 14}px;font-weight:600;
      border:2px solid rgba(255,255,255,0.4);
    ">${count > 999 ? Math.round(count/1000)+"k" : count}</div>`,
    className: "",
    iconSize: [size, size],
    iconAnchor: [size/2, size/2]
  });
}

function criarIconeClusterProspect(cluster) {
  const count = cluster.getChildCount();
  const size  = 32;
  return L.divIcon({
    html: `<div style="
      background:rgba(59,130,246,0.85);color:#fff;
      width:${size}px;height:${size}px;border-radius:4px;
      transform:rotate(45deg);
      display:flex;align-items:center;justify-content:center;
      font-size:11px;font-weight:600;
      border:2px solid rgba(255,255,255,0.4);
    "><span style="transform:rotate(-45deg)">${count > 999 ? Math.round(count/1000)+"k" : count}</span></div>`,
    className: "",
    iconSize: [size, size],
    iconAnchor: [size/2, size/2]
  });
}

// ============================================================
// COMUNICAÇÃO COM A API
// ============================================================
async function chamarAPI(params) {
  if (!API_URL || API_URL.includes("SUA_URL")) return dadosDemostracao(params.action);
  const url = new URL(API_URL);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  try {
    const resp = await fetch(url.toString());
    return await resp.json();
  } catch(e) {
    console.warn("API offline, usando demo.", e);
    return dadosDemostracao(params.action);
  }
}

async function chamarAPIPost(payload) {
  if (!API_URL || API_URL.includes("SUA_URL")) return { ok: true, acao: "demo" };
  try {
    const resp = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    return await resp.json();
  } catch(e) {
    return { ok: true, acao: "demo" };
  }
}

// ============================================================
// DADOS DE DEMONSTRAÇÃO
// ============================================================
function dadosDemostracao(action) {
  if (action === "clientes") {
    return {
      total: 8,
      clientes: [
        { id:1, cnpj:"00.000.000/0001-00", nome:"Supermercado São Paulo LTDA", endereco:"Av. Paulista, 1000", municipio:"São Paulo", uf:"SP", status:"ativo",   cnae:"4711-3/02", representante:"Carlos Silva", fone:"(11)3333-1111", lat:-23.5614, lng:-46.6560 },
        { id:2, cnpj:"00.000.000/0002-00", nome:"Mercado Gaúcho",              endereco:"Rua da Praia, 200",   municipio:"Porto Alegre", uf:"RS", status:"ativo",   cnae:"4711-3/02", representante:"Ana Souza",   fone:"(51)3333-2222", lat:-30.0346, lng:-51.2177 },
        { id:3, cnpj:"00.000.000/0003-00", nome:"Atacadão Centro-Oeste",       endereco:"Setor Comercial Norte", municipio:"Brasília", uf:"DF",   status:"inativo", cnae:"4691-5/00", representante:"Carlos Silva", fone:"",              lat:-15.7942, lng:-47.8822 },
        { id:4, cnpj:"00.000.000/0004-00", nome:"Casa & Lar Curitiba",         endereco:"Av. Batel, 500",       municipio:"Curitiba", uf:"PR",   status:"ativo",   cnae:"4759-8/99", representante:"",            fone:"(41)3333-4444", lat:-25.4284, lng:-49.2733 },
        { id:5, cnpj:"00.000.000/0005-00", nome:"Distribuidora Norte",         endereco:"Av. Eduardo Ribeiro, 300", municipio:"Manaus", uf:"AM", status:"inativo", cnae:"4691-5/00", representante:"Ana Souza",   fone:"",              lat:-3.1019,  lng:-60.0250 },
        { id:6, cnpj:"00.000.000/0006-00", nome:"Mini Mercado Belém",          endereco:"Trav. Padre Eutíquio, 100", municipio:"Belém", uf:"PA", status:"ativo",  cnae:"4711-3/02", representante:"Ana Souza",   fone:"",              lat:-1.4558,  lng:-48.4902 },
        { id:7, cnpj:"00.000.000/0007-00", nome:"Atacado Recife",              endereco:"Av. Conde da Boa Vista, 200", municipio:"Recife", uf:"PE", status:"inativo", cnae:"4691-5/00", representante:"",         fone:"",              lat:-8.0539,  lng:-34.8811 },
        { id:8, cnpj:"00.000.000/0008-00", nome:"Hiper Belo Horizonte",        endereco:"Av. Afonso Pena, 2000", municipio:"Belo Horizonte", uf:"MG", status:"ativo", cnae:"4711-3/02", representante:"Carlos Silva", fone:"",           lat:-19.9167, lng:-43.9345 }
      ]
    };
  }
  if (action === "representantes") {
    return {
      representantes: [
        { id:"1", nome:"Carlos Silva", telefone:"(11) 99999-0001", email:"carlos@empresa.com", municipio:"São Paulo", lat:-23.5489, lng:-46.6388, raioKm:500, cor:"#3B82F6" },
        { id:"2", nome:"Ana Souza",    telefone:"(51) 99999-0002", email:"ana@empresa.com",    municipio:"Porto Alegre", lat:-30.0346, lng:-51.2177, raioKm:600, cor:"#a855f7" }
      ]
    };
  }
  if (action === "prospects") {
    return {
      total: 3,
      prospects: [
        { cnpj:"11.111.111/0001-00", nome:"Hiper Mercado BH",          endereco:"Av. Afonso Pena, 1000", municipio:"Belo Horizonte", cnae:"4711-3/02", lat:-19.9200, lng:-43.9400 },
        { cnpj:"22.222.222/0001-00", nome:"Atacado Recife Distribuição", endereco:"Av. Boa Viagem, 500",  municipio:"Recife",         cnae:"4691-5/00", lat:-8.1192,  lng:-34.9003 },
        { cnpj:"33.333.333/0001-00", nome:"Supermercado Sul RS",         endereco:"Rua Flores, 300",       municipio:"Porto Alegre",   cnae:"4711-3/02", lat:-30.0500, lng:-51.2300 }
      ]
    };
  }
  return {};
}
