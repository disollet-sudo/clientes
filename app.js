// ============================================================
// MAPA DE CLIENTES — app.js (Versão Corrigida e Atualizada)
// ============================================================

// ⚠️ ATENÇÃO: Cole aqui o link da sua NOVA IMPLANTAÇÃO do Apps Script
const API_URL = "https://script.google.com/macros/s/AKfycbxh8ikW_2hvTdz2UVFm2ctxbE2iec5ICHYb3MgzFB_Cd3FnBOLA2JAsfgd2onU9FMD48g/exec";

// ESTADO GLOBAL
let map, clusterClientes, clusterProspects;
let todosClientes = [];    
let todosProspects = [];   
let representantes = [];   

let clientesFiltradosRegiao = [];  
let prospectsFiltradosRegiao = []; 

let marcadoresRep = {};
let circulosRep = {};
let sidebarAberta = true;
let limitesRegiaoAtual = null;

// INICIALIZAÇÃO
document.addEventListener("DOMContentLoaded", () => {
  inicializarMapa();
  mostrarLoading(false); // Aguarda o comando de busca no topo
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
    maxClusterRadius: 45,
    iconCreateFunction: criarIconeCluster
  });

  clusterProspects = L.markerClusterGroup({
    chunkedLoading: true,
    maxClusterRadius: 45
  });

  map.addLayer(clusterClientes);
  map.addLayer(clusterProspects);

  map.on("click", onMapClick);
}

// BUSCA E AJUSTE DE DISTÂNCIA DINÂMICO
async function buscarEIrParaCidade() {
  const cidadeInput = document.getElementById('input-busca-cidade');
  const cidadeNome = cidadeInput.value.trim();

  if (!cidadeNome) {
    toast("Por favor, digite uma cidade, bairro ou estado.");
    return;
  }

  mostrarLoading(true, `Buscando dados geográficos de "${cidadeNome}"...`);

  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&countrycodes=br&limit=1&addressdetails=1&q=${encodeURIComponent(cidadeNome)}`;
    const response = await fetch(url);
    const data = await response.json();

    if (data && data.length > 0) {
      const lat = parseFloat(data[0].lat);
      const lon = parseFloat(data[0].lon);
      
      const bbox = data[0].boundingbox;
      limitesRegiaoAtual = L.latLngBounds(
        L.latLng(parseFloat(bbox[0]), parseFloat(bbox[2])),
        L.latLng(parseFloat(bbox[1]), parseFloat(bbox[3]))
      );

      // CORREÇÃO DE DISTÂNCIA ("Ficou um pouco longe"):
      let zoomAlvo = 12; 
      const localidadeTipo = data[0].type || "";
      const classeTipo = data[0].class || "";
      const nomeBaixo = data[0].display_name.toLowerCase();

      // Se for um estado completo (Ex: Rio Grande do Sul), usa zoom 8 (ideal para ver o RS de perto e inteiro)
      if (localidadeTipo === "state" || nomeBaixo.includes("estado") || (classeTipo === "boundary" && data[0].importance > 0.65)) {
        zoomAlvo = 8; 
      } else if (localidadeTipo === "suburb" || localidadeTipo === "neighborhood") {
        zoomAlvo = 14; 
      }

      map.flyTo([lat, lon], zoomAlvo, { animate: true, duration: 1.5 });
      cidadeInput.blur();
      
      toast(`Focado em: ${data[0].display_name.split(',')[0]}`);

      // Executa a carga puxando EXCLUSIVAMENTE os dados de dentro desse quadrado geométrico
      await carregarDadosDaRegiao(limitesRegiaoAtual);

    } else {
      mostrarLoading(false);
      toast("Região não encontrada. Tente detalhar melhor.");
    }
  } catch (error) {
    console.error(error);
    mostrarLoading(false);
    toast("Falha na conexão com o servidor de mapas.");
  }
}

// FILTRAGEM GEOGRÁFICA EXCLUSIVA (Clientes + Prospects)
async function carregarDadosDaRegiao(bounds) {
  mostrarLoading(true, "Acessando planilha e cruzando dados de Clientes e Prospects...");

  try {
    const [resClientes, resProspects, resRepresentantes] = await Promise.all([
      chamarAPI({ action: "clientes" }),
      chamarAPI({ action: "prospects" }), 
      chamarAPI({ action: "representantes" })
    ]);

    const brutoClientes = resClientes.clientes || [];
    const brutoProspects = resProspects.prospects || [];
    representantes = resRepresentantes.representantes || [];

    // Limita estritamente ao quadrado geográfico selecionado
    clientesFiltradosRegiao = brutoClientes.filter(c => c.lat && c.lng && bounds.contains(L.latLng(c.lat, c.lng)));
    prospectsFiltradosRegiao = brutoProspects.filter(p => p.lat && p.lng && bounds.contains(L.latLng(p.lat, p.lng)));

    renderizarClientes(clientesFiltradosRegiao);
    renderizarProspects(prospectsFiltradosRegiao);
    renderizarRepresentantes(); 
    
    atualizarPills();

  } catch (e) {
    console.error(e);
    toast("Erro ao carregar dados regionais: " + e.message);
  } finally {
    mostrarLoading(false);
  }
}

function renderizarClientes(lista) {
  clusterClientes.clearLayers();
  const listEl = document.getElementById("lista-clientes");
  listEl.innerHTML = "";

  lista.forEach(c => {
    if (c.lat && c.lng) {
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

    const div = document.createElement("div");
    div.className = "cliente-item";
    div.innerHTML = `
      <div class="cliente-nome">${c.nome || c.cnpj}</div>
      <div class="cliente-info">
        <span class="badge ${c.status}">${c.status || "—"}</span>
        ${c.municipio ? " · " + c.municipio : ""}
        ${c.representante ? " · 💼 " + c.representante : ""}
      </div>
    `;
    div.onclick = () => { if (c.lat && c.lng) map.flyTo([c.lat, c.lng], 15); };
    listEl.appendChild(div);
  });

  if(lista.length === 0) {
    listEl.innerHTML = `<div style="padding:20px;text-align:center;color:#888;font-size:12px;">Nenhum cliente mapeado nesta área.</div>`;
  }
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
        <div class="popup-nome">${p.nome || "Prospect Potencial"}</div>
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
        · 🏷️ ${p.cnae}
      </div>
    `;
    div.onclick = () => { if (p.lat && p.lng) map.flyTo([p.lat, p.lng], 15); };
    listEl.appendChild(div);
  });

  if (lista.length === 0) {
    listEl.innerHTML = `<div style="padding:20px;text-align:center;color:#888;font-size:12px">Nenhum prospect mapeado nesta área.</div>`;
  }
}

function renderizarRepresentantes() {
  const listEl = document.getElementById("rep-lista");
  listEl.innerHTML = "";

  Object.values(marcadoresRep).forEach(m => map.removeLayer(m));
  Object.values(circulosRep).forEach(c => map.removeLayer(c));
  marcadoresRep = {};
  circulosRep = {};

  const representantesNaRegiao = representantes.filter(r => {
    if(!limitesRegiaoAtual) return true;
    return r.lat && r.lng ? limitesRegiaoAtual.contains(L.latLng(r.lat, r.lng)) : false;
  });

  representantesNaRegiao.forEach(rep => {
    if (rep.lat && rep.lng) {
      const icone = L.divIcon({
        html: `<div style="background:${rep.cor};width:22px;height:22px;border-radius:50%;border:3px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:white;">${rep.nome.charAt(0)}</div>`,
        className: "", iconSize: [22, 22], iconAnchor: [11, 11]
      });

      const marker = L.marker([rep.lat, rep.lng], { icon: icone });
      marker.bindPopup(popupRepresentante(rep));
      marker.addTo(map);
      marcadoresRep[rep.id] = marker;

      const circulo = L.circle([rep.lat, rep.lng], {
        radius: rep.raioKm * 1000,
        fillColor: rep.cor, fillOpacity: 0.05, color: rep.cor, weight: 1.2, dashArray: "5 4"
      });
      circulo.addTo(map);
      circulosRep[rep.id] = circulo;
    }

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
      <div class="rep-info">${rep.municipio ? "📍 " + rep.municipio + " · " : ""}⭕ Raio: ${rep.raioKm} km</div>
      <div class="rep-stats">
        <div class="rep-stat"><strong style="color:#22c55e">${stats.clientesAtivos}</strong>Ativos</div>
        <div class="rep-stat"><strong style="color:#ef4444">${stats.clientesInativos}</strong>Inativos</div>
        <div class="rep-stat"><strong style="color:#3b82f6">${stats.prospectsNoRaio}</strong>Prospects</div>
      </div>
    `;
    listEl.appendChild(card);
  });
}

function filtrarClientesLocal() {
  const municipio = document.getElementById("filtro-municipio").value.toLowerCase();
  const status = document.getElementById("filtro-status").value.toLowerCase();
  const rep = document.getElementById("filtro-rep").value.toLowerCase();
  const nome = document.getElementById("filtro-nome").value.toLowerCase();

  const filtrados = clientesFiltradosRegiao.filter(c => {
    if (municipio && !c.municipio.toLowerCase().includes(municipio)) return false;
    if (status && c.status !== status) return false;
    if (rep && !c.representante.toLowerCase().includes(rep)) return false;
    if (nome && !c.nome.toLowerCase().includes(nome) && !c.cnpj.includes(nome)) return false;
    return true;
  });
  renderizarClientes(filtrados);
}

function filtrarProspectsLocal() {
  const cnae = document.getElementById("filtro-cnae").value;
  const textoNome = document.getElementById("filtro-prospect-nome").value.toLowerCase();

  const filtrados = prospectsFiltradosRegiao.filter(p => {
    if (cnae && !p.cnae.replace(/\D/g, '').includes(cnae)) return false;
    if (textoNome && !p.nome.toLowerCase().includes(textoNome) && !p.cnpj.includes(textoNome)) return false;
    return true;
  });
  renderizarProspects(filtrados);
}

function calcularEstatisticasRep(rep) {
  if (!rep.lat || !rep.lng) return { clientesAtivos: 0, clientesInativos: 0, prospectsNoRaio: 0 };
  const raioMetros = rep.raioKm * 1000;
  let ativos = 0, inativos = 0, prospects = 0;

  clientesFiltradosRegiao.forEach(c => {
    if (!c.lat || !c.lng) return;
    if (distanciaKm(rep.lat, rep.lng, c.lat, c.lng) * 1000 <= raioMetros) {
      if (c.status === "ativo") ativos++; else inativos++;
    }
  });
  prospectsFiltradosRegiao.forEach(p => {
    if (!p.lat || !p.lng) return;
    if (distanciaKm(rep.lat, rep.lng, p.lat, p.lng) * 1000 <= raioMetros) prospects++;
  });
  return { clientesAtivos: ativos, clientesInativos: inativos, prospectsNoRaio: prospects };
}

function popupCliente(c) {
  return `<div class="popup-nome">${c.nome || "Sem nome"}</div>
    <div class="popup-info">
      <b>CNPJ:</b> ${c.cnpj || "—"}<br><b>Status:</b> <span class="badge ${c.status}">${c.status}</span><br>
      <b>Endereço:</b> ${c.endereco || "—"}<br><b>Município:</b> ${c.municipio || "—"}<br>
      <b>Representante:</b> ${c.representante || "Sem atribuição"}
    </div>`;
}

function popupRepresentante(rep) {
  const stats = calcularEstatisticasRep(rep);
  return `<div class="popup-nome">${rep.nome}</div>
    <div class="popup-info">
      <b>Base:</b> ${rep.municipio || "—"}<br><b>Raio operacional:</b> ${rep.raioKm} km<br>
      <hr style="margin:5px 0; border:none; border-top:1px solid #ddd;">
      <b>Resumo de Atuação Local:</b><br>
      ✅ Ativos: ${stats.clientesAtivos} | ❌ Inativos: ${stats.clientesInativos}<br>
      🎯 Prospects no Raio: ${stats.prospectsNoRaio}
    </div>`;
}

function onMapClick(e) {
  const tab = document.querySelector(".tab-btn.active");
  if (!tab || !tab.textContent.includes("Representantes")) return;
  const { lat, lng } = e.latlng;
  window._pendingLat = lat; window._pendingLng = lng;
  reverseGeocode(lat, lng).then(m => {
    if(!document.getElementById("rep-municipio").value) document.getElementById("rep-municipio").value = m;
  });
  toast(`📍 Posição do representante definida!`);
}

async function reverseGeocode(lat, lng) {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`);
    const d = await r.json(); return d.address?.city || d.address?.town || "";
  } catch { return ""; }
}

async function salvarRepresentante() {
  const nome = document.getElementById("rep-nome").value.trim();
  if (!nome) { toast("Digite o nome."); return; }
  const id = document.getElementById("rep-id").value || String(Date.now());

  const payload = {
    action: "salvarRepresentante", id, nome,
    telefone: document.getElementById("rep-tel").value,
    email: document.getElementById("rep-email").value,
    municipio: document.getElementById("rep-municipio").value,
    raioKm: parseFloat(document.getElementById("rep-raio").value) || 50,
    cor: document.getElementById("rep-cor").value,
    lat: window._pendingLat || 0, lng: window._pendingLng || 0
  };

  mostrarLoading(true, "Gravando dados...");
  const r = await chamarAPIPost(payload);
  mostrarLoading(false);
  if(r.ok) {
    toast("Representante salvo!"); cancelarFormRep();
    if(limitesRegiaoAtual) await carregarDadosDaRegiao(limitesRegiaoAtual);
  }
}

function editarRep(id) {
  const realRep = representantes.find(r => r.id === id);
  if (!realRep) return;
  document.getElementById("rep-form-titulo").textContent = "Editar representante";
  document.getElementById("rep-id").value = realRep.id;
  document.getElementById("rep-nome").value = realRep.nome;
  document.getElementById("rep-tel").value = realRep.telefone;
  document.getElementById("rep-email").value = realRep.email;
  document.getElementById("rep-municipio").value = realRep.municipio;
  document.getElementById("rep-raio").value = realRep.raioKm;
  document.getElementById("rep-cor").value = realRep.cor;
  window._pendingLat = realRep.lat; window._pendingLng = realRep.lng;
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
  window._pendingLat = null; window._pendingLng = null;
}

async function deletarRep(id) {
  if (!confirm("Remover este representante?")) return;
  mostrarLoading(true, "Excluindo...");
  const r = await chamarAPIPost({ action: "deletarRepresentante", id });
  if(r.ok) { toast("Removido."); if(limitesRegiaoAtual) await carregarDadosDaRegiao(limitesRegiaoAtual); }
  mostrarLoading(false);
}

async function geocodificarPendentes() {
  if (!confirm("Mapear endereços sem lat/lng do banco?")) return;
  mostrarLoading(true, "Geocodificando novos registros...");
  const r = await chamarAPIPost({ action: "geocodificarPendentes" });
  mostrarLoading(false);
  toast(`Processado: ${r.geocodificados} com sucesso.`);
  if(limitesRegiaoAtual) await carregarDadosDaRegiao(limitesRegiaoAtual);
}

async function chamarAPI(params) {
  if (!API_URL) return { clientes:[], prospects:[], representantes:[] };
  const url = new URL(API_URL);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const r = await fetch(url.toString()); return await r.json();
}

async function chamarAPIPost(payload) {
  if (!API_URL) return { ok: true };
  const r = await fetch(API_URL, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload)
  });
  return await r.json();
}

function atualizarPills() {
  const atv = clientesFiltradosRegiao.filter(c => c.status === "ativo").length;
  const inat = clientesFiltradosRegiao.length - atv;
  document.getElementById("pill-total").textContent = `${clientesFiltradosRegiao.length} clientes`;
  document.getElementById("pill-ativo").textContent = `${atv} ativos`;
  document.getElementById("pill-inativo").textContent = `${inat} inativos`;
  document.getElementById("pill-prospect").textContent = `${prospectsFiltradosRegiao.length} prospects`;
}

function switchTab(n, b) {
  document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
  document.querySelectorAll(".tab-btn").forEach(btn => btn.classList.remove("active"));
  document.getElementById("tab-" + n).classList.add("active");
  b.classList.add("active");
}

function toggleSidebar() {
  sidebarAberta = !sidebarAberta;
  const s = document.getElementById("sidebar");
  const b = document.getElementById("btn-toggle-sidebar");
  s.classList.toggle("collapsed", !sidebarAberta);
  b.style.left = sidebarAberta ? "300px" : "0";
  b.textContent = sidebarAberta ? "◀" : "▶";
}

function mostrarLoading(s, m) {
  const el = document.getElementById("loading");
  el.classList.toggle("hidden", !s);
  if (m) el.querySelector("p").textContent = m;
}

function toast(m) {
  const el = document.getElementById("toast");
  el.textContent = m; el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 3000);
}

function distanciaKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) * Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function exportarCSV() {
  if (!clientesFiltradosRegiao.length) { toast("Nenhum dado filtrado."); return; }
  const cabecalho = ["CNPJ","Nome","Município","Status","CNAE","Representante"];
  const linhas = clientesFiltradosRegiao.map(c => [c.cnpj, c.nome, c.municipio, c.status, c.cnae, c.representante].map(v => `"${String(v || "").replace(/"/g, '""')}"`).join(","));
  const csv = [cabecalho.join(","), ...linhas].join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = "clientes_regiao.csv"; a.click();
}

function criarIconeCluster(cluster) {
  const count = cluster.getChildCount();
  const size = count < 100 ? 34 : 44;
  return L.divIcon({
    html: `<div style="background:rgba(26,26,24,0.9);color:#fff;width:${size}px;height:${size}px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;border:2px solid #fff;">${count}</div>`,
    className: "", iconSize: [size, size]
  });
}
