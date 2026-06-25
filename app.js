// ============================================================
// MAPA DE CLIENTES — app.js
// Configure a URL da sua API do Apps Script abaixo:
// ============================================================

const API_URL = "https://script.google.com/macros/s/AKfycbzIU8OYm8bmHX3bDwnhA7p9j8AdSKp8rwsQoiU-aCqtpoaYFWYlbX5ONfYMdUDONz4Pnw/exec";
// Exemplo: "https://script.google.com/macros/s/AKfyc.../exec"

// ============================================================
// ESTADO GLOBAL
// ============================================================
let map, clusterClientes, clusterProspects;
let todosClientes = [];
let todosProspects = [];
let representantes = [];
let marcadoresRep = {};
let circulosRep = {};
let selecionandoLocRep = false;
let sidebarAberta = true;

// ============================================================
// INICIALIZAÇÃO
// ============================================================
document.addEventListener("DOMContentLoaded", () => {
  inicializarMapa();
  carregarTudo();
});

function inicializarMapa() {
  map = L.map("map", {
    center: [-15.78, -47.93],  // Brasil central
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
    maxClusterRadius: 50
  });

  map.addLayer(clusterClientes);
  map.addLayer(clusterProspects);

  // Clique no mapa para posicionar representante
  map.on("click", onMapClick);
}

async function carregarTudo() {
  mostrarLoading(true);
  try {
    await Promise.all([
      carregarClientes(),
      carregarRepresentantes()
    ]);
  } catch(e) {
    toast("Erro ao carregar dados: " + e.message, 5000);
  }
  mostrarLoading(false);
}

// ============================================================
// CLIENTES
// ============================================================
async function carregarClientes() {
  const dados = await chamarAPI({ action: "clientes" });
  if (dados.error) throw new Error(dados.error);

  todosClientes = dados.clientes || [];
  renderizarClientes(todosClientes);
  atualizarPills();
}

function renderizarClientes(lista) {
  clusterClientes.clearLayers();
  const listEl = document.getElementById("lista-clientes");
  listEl.innerHTML = "";

  let comCoordenadas = 0;

  lista.forEach(c => {
    // Marcador no mapa
    if (c.lat && c.lng) {
      comCoordenadas++;
      const marker = L.circleMarker([c.lat, c.lng], {
        radius: 7,
        fillColor: c.status === "ativo" ? "#22c55e" : "#ef4444",
        color: c.status === "ativo" ? "#16a34a" : "#dc2626",
        weight: 1.5,
        fillOpacity: 0.85
      });
      marker.bindPopup(popupCliente(c));
      clusterClientes.addLayer(marker);
    }

    // Item na lista
    const div = document.createElement("div");
    div.className = "cliente-item";
    div.innerHTML = `
      <div class="cliente-nome">${c.nome || c.cnpj}</div>
      <div class="cliente-info">
        <span class="badge ${c.status}">${c.status || "—"}</span>
        ${c.municipio ? " · " + c.municipio : ""}
        ${c.representante ? " · " + c.representante : ""}
      </div>
    `;
    div.onclick = () => {
      if (c.lat && c.lng) {
        map.flyTo([c.lat, c.lng], 14);
      } else {
        toast("Endereço sem coordenadas. Clique em 'Geocodificar'.");
      }
    };
    listEl.appendChild(div);
  });

  const semCoord = lista.length - comCoordenadas;
  if (semCoord > 0) {
    const aviso = document.createElement("div");
    aviso.style.cssText = "padding:10px 14px;font-size:12px;color:#888;text-align:center;border-top:1px solid #f0efe8";
    aviso.textContent = `⚠ ${semCoord} clientes sem coordenadas — clique em 'Geocodificar'`;
    listEl.appendChild(aviso);
  }
}

function filtrarClientes() {
  const municipio = document.getElementById("filtro-municipio").value.toLowerCase();
  const status = document.getElementById("filtro-status").value.toLowerCase();
  const rep = document.getElementById("filtro-rep").value.toLowerCase();
  const nome = document.getElementById("filtro-nome").value.toLowerCase();

  const filtrados = todosClientes.filter(c => {
    if (municipio && !c.municipio.toLowerCase().includes(municipio)) return false;
    if (status && c.status !== status) return false;
    if (rep && !c.representante.toLowerCase().includes(rep)) return false;
    if (nome && !c.nome.toLowerCase().includes(nome) && !c.cnpj.includes(nome)) return false;
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
      <b>Município:</b> ${c.municipio || "—"}<br>
      <b>CNAE:</b> ${c.cnae || "—"}<br>
      <b>Representante:</b> ${c.representante || "Sem representante"}
    </div>
  `;
}

// ============================================================
// PROSPECTS
// ============================================================
async function buscarProspects() {
  mostrarLoading(true, "Buscando prospects...");

  const cnae = document.getElementById("filtro-cnae").value;
  const municipio = document.getElementById("filtro-prospect-municipio").value;

  const dados = await chamarAPI({ action: "prospects", cnae, municipio });
  todosProspects = dados.prospects || [];
  renderizarProspects(todosProspects);
  mostrarLoading(false);
  atualizarPills();
}

function filtrarProspects() {
  buscarProspects();
}

function renderizarProspects(lista) {
  clusterProspects.clearLayers();
  const listEl = document.getElementById("lista-prospects");
  listEl.innerHTML = "";

  lista.forEach(p => {
    if (p.lat && p.lng) {
      const marker = L.circleMarker([p.lat, p.lng], {
        radius: 6,
        fillColor: "#3b82f6",
        color: "#1d4ed8",
        weight: 1.5,
        fillOpacity: 0.8
      });
      marker.bindPopup(`
        <div class="popup-nome">${p.nome || "Prospect"}</div>
        <div class="popup-info">
          <b>CNPJ:</b> ${p.cnpj}<br>
          <b>CNAE:</b> ${p.cnae}<br>
          <b>Município:</b> ${p.municipio}<br>
          <b>Endereço:</b> ${p.endereco}
        </div>
      `);
      clusterProspects.addLayer(marker);
    }

    const div = document.createElement("div");
    div.className = "cliente-item";
    div.innerHTML = `
      <div class="cliente-nome">${p.nome || p.cnpj}</div>
      <div class="cliente-info">
        <span class="badge prospect">Prospect</span>
        ${p.municipio ? " · " + p.municipio : ""}
        · ${p.cnae}
      </div>
    `;
    div.onclick = () => {
      if (p.lat && p.lng) map.flyTo([p.lat, p.lng], 14);
    };
    listEl.appendChild(div);
  });

  if (lista.length === 0) {
    listEl.innerHTML = `<div style="padding:20px;text-align:center;color:#888;font-size:13px">
      Nenhum prospect encontrado.<br>
      <small>Adicione dados na aba "Prospects" da planilha.</small>
    </div>`;
  }
}

// ============================================================
// REPRESENTANTES
// ============================================================
async function carregarRepresentantes() {
  const dados = await chamarAPI({ action: "representantes" });
  representantes = dados.representantes || [];
  renderizarRepresentantes();
}

function renderizarRepresentantes() {
  const listEl = document.getElementById("rep-lista");
  listEl.innerHTML = "";

  // Limpar marcadores anteriores
  Object.values(marcadoresRep).forEach(m => map.removeLayer(m));
  Object.values(circulosRep).forEach(c => map.removeLayer(c));
  marcadoresRep = {};
  circulosRep = {};

  representantes.forEach(rep => {
    // Marcador no mapa
    if (rep.lat && rep.lng) {
      const icone = L.divIcon({
        html: `<div style="
          background:${rep.cor};
          width:22px;height:22px;border-radius:50%;
          border:3px solid white;
          box-shadow:0 2px 6px rgba(0,0,0,0.3);
          display:flex;align-items:center;justify-content:center;
          font-size:10px;font-weight:700;color:white;
        ">${rep.nome.charAt(0)}</div>`,
        className: "",
        iconSize: [22, 22],
        iconAnchor: [11, 11]
      });

      const marker = L.marker([rep.lat, rep.lng], { icon: icone });
      marker.bindPopup(popupRepresentante(rep));
      marker.addTo(map);
      marcadoresRep[rep.id] = marker;

      // Círculo de raio
      const circulo = L.circle([rep.lat, rep.lng], {
        radius: rep.raioKm * 1000,
        fillColor: rep.cor,
        fillOpacity: 0.06,
        color: rep.cor,
        weight: 1.5,
        dashArray: "6 4"
      });
      circulo.addTo(map);
      circulosRep[rep.id] = circulo;
    }

    // Card na sidebar com estatísticas
    const stats = calcularEstatisticasRep(rep);
    const card = document.createElement("div");
    card.className = "rep-card";
    card.innerHTML = `
      <div class="rep-card-header">
        <div class="rep-dot" style="background:${rep.cor}"></div>
        <span class="rep-nome">${rep.nome}</span>
        <div class="rep-actions">
          <button class="btn-sm" onclick="editarRep('${rep.id}')">✏️</button>
          <button class="btn-sm danger" onclick="deletarRep('${rep.id}')">🗑</button>
        </div>
      </div>
      <div class="rep-info">
        ${rep.municipio ? "📍 " + rep.municipio + " · " : ""}⭕ ${rep.raioKm} km
        ${rep.telefone ? " · 📞 " + rep.telefone : ""}
      </div>
      <div class="rep-stats">
        <div class="rep-stat">
          <strong style="color:#22c55e">${stats.clientesAtivos}</strong>
          Ativos
        </div>
        <div class="rep-stat">
          <strong style="color:#ef4444">${stats.clientesInativos}</strong>
          Inativos
        </div>
        <div class="rep-stat">
          <strong style="color:#3b82f6">${stats.prospectsNoRaio}</strong>
          Prospects no raio
        </div>
      </div>
    `;
    card.onclick = (e) => {
      if (e.target.closest("button")) return;
      if (rep.lat && rep.lng) map.flyTo([rep.lat, rep.lng], 10);
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
  if (!rep.lat || !rep.lng) return { clientesAtivos: 0, clientesInativos: 0, prospectsNoRaio: 0 };

  const raioMetros = rep.raioKm * 1000;
  let ativos = 0, inativos = 0, prospects = 0;

  todosClientes.forEach(c => {
    if (!c.lat || !c.lng) return;
    const dist = distanciaKm(rep.lat, rep.lng, c.lat, c.lng) * 1000;
    if (dist <= raioMetros) {
      if (c.status === "ativo") ativos++;
      else inativos++;
    }
  });

  todosProspects.forEach(p => {
    if (!p.lat || !p.lng) return;
    const dist = distanciaKm(rep.lat, rep.lng, p.lat, p.lng) * 1000;
    if (dist <= raioMetros) prospects++;
  });

  return { clientesAtivos: ativos, clientesInativos: inativos, prospectsNoRaio: prospects };
}

function popupRepresentante(rep) {
  const stats = calcularEstatisticasRep(rep);
  return `
    <div class="popup-nome">${rep.nome}</div>
    <div class="popup-info">
      <b>Município:</b> ${rep.municipio || "—"}<br>
      <b>Raio:</b> ${rep.raioKm} km<br>
      <b>Telefone:</b> ${rep.telefone || "—"}<br>
      <b>E-mail:</b> ${rep.email || "—"}<br>
      <hr style="margin:6px 0;border:none;border-top:1px solid #eee">
      <b>Dentro do raio:</b><br>
      ✅ ${stats.clientesAtivos} clientes ativos<br>
      ❌ ${stats.clientesInativos} clientes inativos<br>
      🎯 ${stats.prospectsNoRaio} prospects potenciais
    </div>
  `;
}

function editarRep(id) {
  const rep = representantes.find(r => r.id === id);
  if (!rep) return;
  document.getElementById("rep-form-titulo").textContent = "Editar representante";
  document.getElementById("rep-id").value = rep.id;
  document.getElementById("rep-nome").value = rep.nome;
  document.getElementById("rep-tel").value = rep.telefone;
  document.getElementById("rep-email").value = rep.email;
  document.getElementById("rep-municipio").value = rep.municipio;
  document.getElementById("rep-raio").value = rep.raioKm;
  document.getElementById("rep-cor").value = rep.cor;
  toast("Clique no mapa para reposicionar, ou salve sem alterar localização.");
}

function cancelarFormRep() {
  document.getElementById("rep-id").value = "";
  document.getElementById("rep-nome").value = "";
  document.getElementById("rep-tel").value = "";
  document.getElementById("rep-email").value = "";
  document.getElementById("rep-municipio").value = "";
  document.getElementById("rep-raio").value = "50";
  document.getElementById("rep-cor").value = "#3B82F6";
  document.getElementById("rep-form-titulo").textContent = "+ Novo representante";
  selecionandoLocRep = false;
}

async function salvarRepresentante() {
  const nome = document.getElementById("rep-nome").value.trim();
  if (!nome) { toast("Digite o nome do representante."); return; }

  const payload = {
    action: "salvarRepresentante",
    id: document.getElementById("rep-id").value || String(Date.now()),
    nome,
    telefone: document.getElementById("rep-tel").value,
    email: document.getElementById("rep-email").value,
    municipio: document.getElementById("rep-municipio").value,
    raioKm: parseFloat(document.getElementById("rep-raio").value) || 50,
    cor: document.getElementById("rep-cor").value,
    lat: 0,
    lng: 0
  };

  // Pegar lat/lng do representante existente se não definiu novo ponto
  const existente = representantes.find(r => r.id === payload.id);
  if (existente) { payload.lat = existente.lat; payload.lng = existente.lng; }

  mostrarLoading(true, "Salvando...");
  const resp = await chamarAPIPost(payload);
  mostrarLoading(false);

  if (resp.ok) {
    toast(`Representante ${resp.acao === "criado" ? "cadastrado" : "atualizado"}!`);
    cancelarFormRep();
    await carregarRepresentantes();
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
    await carregarRepresentantes();
  }
}

// Clique no mapa define localização do representante
function onMapClick(e) {
  const tab = document.querySelector(".tab-btn.active");
  if (!tab || !tab.textContent.includes("Representantes")) return;

  const { lat, lng } = e.latlng;
  document.getElementById("rep-nome").focus();
  // Armazena temporariamente no campo oculto via geocodificação reversa
  reverseGeocode(lat, lng).then(municipio => {
    if (!document.getElementById("rep-municipio").value) {
      document.getElementById("rep-municipio").value = municipio;
    }
  });

  // Salvar lat/lng na instância temporária
  const id = document.getElementById("rep-id").value;
  if (id) {
    const rep = representantes.find(r => r.id === id);
    if (rep) { rep.lat = lat; rep.lng = lng; }
  } else {
    // Novo representante — guarda temporariamente
    window._tempRepLat = lat;
    window._tempRepLng = lng;
  }

  // Atualizar o payload antes de salvar
  const _orig = salvarRepresentante;
  window._pendingLat = lat;
  window._pendingLng = lng;
  toast(`📍 Localização definida: ${lat.toFixed(4)}, ${lng.toFixed(4)}`);
}

// Sobrescrever salvar para incluir lat/lng pendente
const _salvarOriginal = salvarRepresentante;
async function salvarRepresentante() {
  const nome = document.getElementById("rep-nome").value.trim();
  if (!nome) { toast("Digite o nome do representante."); return; }

  const id = document.getElementById("rep-id").value || String(Date.now());
  const existente = representantes.find(r => r.id === id);

  const payload = {
    action: "salvarRepresentante",
    id,
    nome,
    telefone: document.getElementById("rep-tel").value,
    email: document.getElementById("rep-email").value,
    municipio: document.getElementById("rep-municipio").value,
    raioKm: parseFloat(document.getElementById("rep-raio").value) || 50,
    cor: document.getElementById("rep-cor").value,
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
  } else {
    toast("Erro: " + (resp.error || "Falha ao salvar"));
  }
}

// ============================================================
// GEOCODIFICAÇÃO
// ============================================================
async function geocodificarPendentes() {
  if (!confirm("Isso vai geocodificar todos os endereços sem coordenadas. Pode demorar alguns minutos dependendo do volume. Continuar?")) return;
  mostrarLoading(true, "Geocodificando... aguarde");
  const resp = await chamarAPIPost({ action: "geocodificarPendentes" });
  mostrarLoading(false);
  if (resp.geocodificados !== undefined) {
    toast(`✅ ${resp.geocodificados} endereços geocodificados, ${resp.erros} erros.`, 5000);
    await carregarClientes();
  }
}

async function reverseGeocode(lat, lng) {
  try {
    const resp = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`,
      { headers: { "User-Agent": "MapaClientes/1.0" } }
    );
    const data = await resp.json();
    return data.address?.city || data.address?.town || data.address?.municipality || "";
  } catch(e) {
    return "";
  }
}

// ============================================================
// EXPORTAR CSV
// ============================================================
function exportarCSV() {
  const lista = todosClientes;
  if (!lista.length) { toast("Nenhum dado para exportar."); return; }

  const cabecalho = ["CNPJ","Nome","Município","Status","CNAE","Representante","Lat","Lng"];
  const linhas = lista.map(c =>
    [c.cnpj, c.nome, c.municipio, c.status, c.cnae, c.representante, c.lat, c.lng]
      .map(v => `"${String(v || "").replace(/"/g, '""')}"`)
      .join(",")
  );
  const csv = [cabecalho.join(","), ...linhas].join("\n");

  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "clientes_" + new Date().toISOString().slice(0,10) + ".csv";
  a.click();
  URL.revokeObjectURL(url);
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
  const btn = document.getElementById("btn-toggle-sidebar");
  sidebar.classList.toggle("collapsed", !sidebarAberta);
  btn.style.left = sidebarAberta ? "300px" : "0";
  btn.textContent = sidebarAberta ? "◀" : "▶";
}

function mostrarLoading(show, msg) {
  const el = document.getElementById("loading");
  el.classList.toggle("hidden", !show);
  if (msg) el.querySelector("p").textContent = msg;
}

function atualizarPills() {
  const ativos = todosClientes.filter(c => c.status === "ativo").length;
  const inativos = todosClientes.filter(c => c.status !== "ativo").length;
  document.getElementById("pill-total").textContent = `${todosClientes.length.toLocaleString("pt-BR")} clientes`;
  document.getElementById("pill-ativo").textContent = `${ativos.toLocaleString("pt-BR")} ativos`;
  document.getElementById("pill-inativo").textContent = `${inativos.toLocaleString("pt-BR")} inativos`;
  document.getElementById("pill-prospect").textContent = `${todosProspects.length.toLocaleString("pt-BR")} prospects`;
}

function toast(msg, duracao = 3000) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), duracao);
}

// Fórmula de Haversine — distância em km entre dois pontos lat/lng
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
  const size = count < 100 ? 34 : count < 500 ? 40 : 48;
  return L.divIcon({
    html: `<div style="
      background: rgba(30,30,28,0.85);
      color:#fff;
      width:${size}px;height:${size}px;
      border-radius:50%;
      display:flex;align-items:center;justify-content:center;
      font-size:${size < 40 ? 12 : 14}px;font-weight:600;
      border:2px solid rgba(255,255,255,0.4);
    ">${count > 999 ? Math.round(count/1000)+"k" : count}</div>`,
    className: "",
    iconSize: [size, size],
    iconAnchor: [size/2, size/2]
  });
}

// ============================================================
// COMUNICAÇÃO COM A API
// ============================================================
async function chamarAPI(params) {
  if (!API_URL || API_URL === "SUA_URL_DO_APPS_SCRIPT_AQUI") {
    // Modo demo — retorna dados de exemplo
    return dadosDemostracao(params.action);
  }

  const url = new URL(API_URL);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  const resp = await fetch(url.toString());
  return await resp.json();
}

async function chamarAPIPost(payload) {
  if (!API_URL || API_URL === "SUA_URL_DO_APPS_SCRIPT_AQUI") {
    return { ok: true, acao: "demo" };
  }

  const resp = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  return await resp.json();
}

// ============================================================
// DADOS DE DEMONSTRAÇÃO (remove quando conectar a API real)
// ============================================================
function dadosDemostracao(action) {
  if (action === "clientes") {
    return {
      total: 5,
      clientes: [
        { id:1, cnpj:"00.000.000/0001-00", nome:"Supermercado São Paulo LTDA", endereco:"Av. Paulista, 1000", municipio:"São Paulo", status:"ativo", cnae:"4711-3/02", representante:"Carlos Silva", lat:-23.5614, lng:-46.6560 },
        { id:2, cnpj:"00.000.000/0002-00", nome:"Mercado Gaúcho", endereco:"Rua da Praia, 200", municipio:"Porto Alegre", status:"ativo", cnae:"4711-3/02", representante:"Ana Souza", lat:-30.0346, lng:-51.2177 },
        { id:3, cnpj:"00.000.000/0003-00", nome:"Atacadão Centro-Oeste", endereco:"Setor Comercial Norte", municipio:"Brasília", status:"inativo", cnae:"4691-5/00", representante:"Carlos Silva", lat:-15.7942, lng:-47.8822 },
        { id:4, cnpj:"00.000.000/0004-00", nome:"Casa & Lar Curitiba", endereco:"Av. Batel, 500", municipio:"Curitiba", status:"ativo", cnae:"4759-8/99", representante:"", lat:-25.4284, lng:-49.2733 },
        { id:5, cnpj:"00.000.000/0005-00", nome:"Distribuidora Norte", endereco:"Av. Eduardo Ribeiro, 300", municipio:"Manaus", status:"inativo", cnae:"4691-5/00", representante:"Ana Souza", lat:-3.1019, lng:-60.0250 }
      ]
    };
  }
  if (action === "representantes") {
    return {
      representantes: [
        { id:"1", nome:"Carlos Silva", telefone:"(11) 99999-0001", email:"carlos@empresa.com", municipio:"São Paulo", lat:-23.5489, lng:-46.6388, raioKm:200, cor:"#3B82F6" },
        { id:"2", nome:"Ana Souza",   telefone:"(51) 99999-0002", email:"ana@empresa.com",   municipio:"Porto Alegre", lat:-30.0346, lng:-51.2177, raioKm:300, cor:"#a855f7" }
      ]
    };
  }
  if (action === "prospects") {
    return {
      total: 2,
      prospects: [
        { cnpj:"11.111.111/0001-00", nome:"Hiper Mercado Belo Horizonte", endereco:"Av. Afonso Pena, 1000", municipio:"Belo Horizonte", cnae:"4711-3/02", lat:-19.9167, lng:-43.9345 },
        { cnpj:"22.222.222/0001-00", nome:"Atacado Recife Distribuidora", endereco:"Av. Boa Viagem, 500", municipio:"Recife", cnae:"4691-5/00", lat:-8.1192, lng:-34.9003 }
      ]
    };
  }
  return {};
}
