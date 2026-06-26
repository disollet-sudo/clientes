// ============================================================
// MAPA DE CLIENTES — app.js (Versão Ultra-Resiliente)
// ============================================================

// Link da implantação do Apps Script
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
let sidebarAberta = false;
let limitesRegiaoAtual = null;

// INICIALIZAÇÃO
document.addEventListener("DOMContentLoaded", () => {
  inicializarMapa();
  mostrarLoading(false);
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

// POP-UP INICIAL DE BUSCA
async function iniciarBusca() {
  const cidadeInput = document.getElementById('input-busca-welcome');
  if (!cidadeInput) return;
  
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

      let zoomAlvo = 12; 
      const localidadeTipo = data[0].type || "";
      const classeTipo = data[0].class || "";
      const nomeBaixo = data[0].display_name.toLowerCase();

      if (localidadeTipo === "state" || nomeBaixo.includes("estado") || (classeTipo === "boundary" && data[0].importance > 0.65)) {
        zoomAlvo = 8; 
      } else if (localidadeTipo === "suburb" || localidadeTipo === "neighborhood") {
        zoomAlvo = 14; 
      }

      map.flyTo([lat, lon], zoomAlvo, { animate: true, duration: 1.5 });
      cidadeInput.blur();
      
      const nomeExibicao = data[0].display_name.split(',')[0];
      toast(`Focado em: ${nomeExibicao}`);

      document.getElementById("welcome-overlay")?.classList.add("hidden");
      document.getElementById("painel")?.classList.add("open");
      document.getElementById("btn-toggle")?.classList.add("visible");
      document.getElementById("btn-map-busca")?.classList.add("visible");
      
      if (document.getElementById("painel-regiao-nome")) {
        document.getElementById("painel-regiao-nome").textContent = nomeExibicao;
      }
      if (document.getElementById("regiao-label-top")) {
        document.getElementById("regiao-label-top").textContent = nomeExibicao;
      }

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
window.iniciarBusca = iniciarBusca;

function novaBusca() {
  document.getElementById("welcome-overlay")?.classList.remove("hidden");
  document.getElementById("painel")?.classList.remove("open");
  document.getElementById("btn-toggle")?.classList.remove("visible");
  document.getElementById("btn-map-busca")?.classList.remove("visible");
  fecharRepDetalhe();
  const inputWelcome = document.getElementById('input-busca-welcome');
  if (inputWelcome) {
    inputWelcome.value = "";
    inputWelcome.focus();
  }
}
window.novaBusca = novaBusca;

// FILTRAGEM E TRATAMENTO DE DADOS COM RESILIÊNCIA DE COLUNAS
async function carregarDadosDaRegiao(bounds) {
  mostrarLoading(true, "Acessando planilha e padronizando dados comerciais...");

  try {
    const [resClientes, resProspects, resRepresentantes] = await Promise.all([
      chamarAPI({ action: "clientes" }),
      chamarAPI({ action: "prospects" }), 
      chamarAPI({ action: "representantes" })
    ]);

    // 1. Normalização dos Clientes
    const brutoClientes = (resClientes.clientes || []).map(c => {
      c.lat = c.lat || c.latitude || c.Latitude || c.LAT;
      c.lng = c.lng || c.longitude || c.Longitude || c.lng || c.LNG || c.long;
      return c;
    });

    // 2. Normalização dos Prospects (Trata variações de cabeçalhos das planilhas)
    const brutoProspects = (resProspects.prospects || []).map(p => {
      let lat = p.lat || p.latitude || p.Latitude || p.LAT;
      let lng = p.lng || p.longitude || p.Longitude || p.lng || p.LNG || p.long;
      return {
        ...p,
        nome: p.nome || p.Nome || p["Razão Social"] || p.razaosocial || p.cnpj || "Sem nome",
        municipio: p.municipio || p.Municipio || p.Cidade || p.cidade || "—",
        endereco: p.endereco || p.Endereco || p.Logradouro || "—",
        cnae: p.cnae || p.Cnae || p.CNAE || "—",
        lat: lat ? parseFloat(lat) : null,
        lng: lng ? parseFloat(lng) : null
      };
    });

    // 3. Normalização dos Representantes (Trata variações de cabeçalhos das planilhas)
    representantes = (resRepresentantes.representantes || []).map(r => {
      let lat = r.lat || r.latitude || r.Latitude || r.LAT;
      let lng = r.lng || r.longitude || r.Longitude || r.lng || r.LNG || r.long;
      let raioKm = r.raioKm || r.raiokm || r.Raio || r["Raio (Km)"] || r["raio"] || 50;
      let nome = r.nome || r.Nome || "Representante Oculto";
      return {
        ...r,
        id: r.id || r.Id || nome,
        nome: nome,
        municipio: r.municipio || r.Municipio || r.Cidade || r.cidade || "—",
        cor: r.cor || r.Cor || "#7c3aed",
        raioKm: parseFloat(raioKm),
        lat: lat ? parseFloat(lat) : null,
        lng: lng ? parseFloat(lng) : null
      };
    });

    // Filtragem geométrica estrita baseada na área visual mapeada
    clientesFiltradosRegiao = brutoClientes.filter(c => c.lat && c.lng && bounds.contains(L.latLng(c.lat, c.lng)));
    prospectsFiltradosRegiao = brutoProspects.filter(p => p.lat && p.lng && bounds.contains(L.latLng(p.lat, p.lng)));

    renderizarClientes(clientesFiltradosRegiao);
    renderizarProspects(prospectsFiltradosRegiao);
    renderizarRepresentantes(); 
    atualizarPills();
    renderizarOportunidades();

  } catch (e) {
    console.error(e);
    toast("Erro ao carregar dados regionais: " + e.message);
  } catch {
    mostrarLoading(false);
  } finally {
    mostrarLoading(false);
  }
}

function renderizarClientes(lista) {
  clusterClientes.clearLayers();
  const listEl = document.getElementById("lista-clientes");
  if (!listEl) return;
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
    div.className = "item-lista";
    div.innerHTML = `
      <div class="item-icon" style="background:${c.status === 'ativo' ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)'}">🏢</div>
      <div class="item-dados">
        <div class="item-nome">${c.nome || c.cnpj}</div>
        <div class="item-info">
          <span class="badge ${c.status}">${c.status || "—"}</span>
          ${c.municipio ? " · " + c.municipio : ""}
          ${c.representante ? " · 💼 " + c.representante : ""}
        </div>
      </div>
    `;
    div.onclick = () => { if (c.lat && c.lng) map.flyTo([c.lat, c.lng], 15); };
    listEl.appendChild(div);
  });

  if (lista.length === 0) {
    listEl.innerHTML = `<div class="empty-msg">Nenhum cliente mapeado nesta área.</div>`;
  }
}

function renderizarProspects(lista) {
  clusterProspects.clearLayers();
  const listEl = document.getElementById("lista-prospects");
  if (!listEl) return;
  listEl.innerHTML = "";

  lista.forEach(p => {
    if (p.lat && p.lng) {
      const marker = L.circleMarker([p.lat, p.lng], {
        radius: 6,
        fillColor: "#f59e0b",
        color: "#d97706",
        weight: 1.5,
        fillOpacity: 0.8
      });
      marker.bindPopup(`
        <div class="popup-nome">${p.nome || "Prospect Potencial"}</div>
        <div class="popup-info">
          <b>CNPJ:</b> ${p.cnpj || "—"}<br>
          <b>CNAE:</b> ${p.cnae || "—"}<br>
          <b>Município:</b> ${p.municipio || "—"}<br>
          <b>Endereço:</b> ${p.endereco || "—"}
        </div>
      `);
      clusterProspects.addLayer(marker);
    }

    const div = document.createElement("div");
    div.className = "item-lista";
    div.innerHTML = `
      <div class="item-icon" style="background:rgba(245,158,11,0.15)">🎯</div>
      <div class="item-dados">
        <div class="item-nome">${p.nome}</div>
        <div class="item-info">
          <span class="badge prospect">Prospect</span>
          ${p.municipio ? " · " + p.municipio : ""}
          · 🏷️ ${p.cnae}
        </div>
      </div>
    `;
    div.onclick = () => { if (p.lat && p.lng) map.flyTo([p.lat, p.lng], 15); };
    listEl.appendChild(div);
  });

  if (lista.length === 0) {
    listEl.innerHTML = `<div class="empty-msg">Nenhum prospect mapeado nesta área.</div>`;
  }
}

function renderizarRepresentantes() {
  const listEl = document.getElementById("lista-reps");
  if (!listEl) return;
  listEl.innerHTML = "";

  Object.values(marcadoresRep).forEach(m => map.removeLayer(m));
  Object.values(circulosRep).forEach(c => map.removeLayer(c));
  marcadoresRep = {};
  circulosRep = {};

  // Filtra representantes que estão contidos na área atual ou cujo raio intercepta a visão
  const representantesNaRegiao = representantes.filter(r => {
    if (!limitesRegiaoAtual) return true;
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
    const div = document.createElement("div");
    div.className = "rep-item";
    div.innerHTML = `
      <div class="rep-item-header">
        <div class="rep-mini-dot" style="background:${rep.cor}"></div>
        <span class="rep-item-nome">${rep.nome}</span>
      </div>
      <div class="rep-item-info">${rep.municipio ? "📍 " + rep.municipio + " · " : ""}⭕ Raio: ${rep.raioKm} km</div>
      <div class="rep-item-stats">
        <div class="rep-mini-stat" style="color:var(--ativo)"><strong>${stats.clientesAtivos}</strong> Ativos</div>
        <div class="rep-mini-stat" style="color:var(--inativo)"><strong>${stats.clientesInativos}</strong> Inat.</div>
        <div class="rep-mini-stat" style="color:var(--prospect)"><strong>${stats.prospectsNoRaio}</strong> Pros.</div>
      </div>
    `;
    
    div.onclick = () => {
      if (rep.lat && rep.lng) map.flyTo([rep.lat, rep.lng], 11);
      abrirRepDetalhe(rep, stats);
    };
    listEl.appendChild(div);
  });

  if (representantesNaRegiao.length === 0) {
    listEl.innerHTML = `<div class="empty-msg">Nenhum representante baseado nesta área.</div>`;
  }
}

function abrirRepDetalhe(rep, stats) {
  document.getElementById("rep-detalhe").classList.add("open");
  document.getElementById("rep-det-nome").textContent = rep.nome;
  document.getElementById("rd-ativos").textContent = stats.clientesAtivos;
  document.getElementById("rd-inativos").textContent = stats.clientesInativos;
  document.getElementById("rd-prospects").textContent = stats.prospectsNoRaio;
  document.getElementById("rd-raio").textContent = `${rep.raioKm}km`;
  window._atualRepParaRota = rep;
}

function fecharRepDetalhe() {
  document.getElementById("rep-detalhe")?.classList.remove("open");
}
window.fecharRepDetalhe = fecharRepDetalhe;

function verRotaRep() {
  if (!window._atualRepParaRota) return;
  toast(`Gerando roteirização comercial otimizada para: ${window._atualRepParaRota.nome}`);
}
window.verRotaRep = verRotaRep;

// FILTROS EM TEMPO REAL
function filtrarClientes() {
  const termo = document.getElementById("filtro-cliente").value.toLowerCase();
  const filtrados = clientesFiltradosRegiao.filter(c => {
    return (c.nome || "").toLowerCase().includes(termo) || 
           (c.cnpj || "").includes(termo) || 
           (c.municipio || "").toLowerCase().includes(termo);
  });
  renderizarClientes(filtrados);
}
window.filtrarClientes = filtrarClientes;

function filtrarProspects() {
  const termo = document.getElementById("filtro-prospect").value.toLowerCase();
  const filtrados = prospectsFiltradosRegiao.filter(p => {
    return (p.nome || "").toLowerCase().includes(termo) || 
           (p.cnpj || "").includes(termo) || 
           (p.cnae || "").toLowerCase().includes(termo);
  });
  renderizarProspects(filtrados);
}
window.filtrarProspects = filtrarProspects;

function filtrarPorStatus(status) {
  const filtrados = clientesFiltradosRegiao.filter(c => c.status === status);
  renderizarClientes(filtrados);
  switchAba('clientes', document.querySelector('[data-aba=clientes]'));
  
  document.querySelectorAll('.stat-card').forEach(c => c.classList.remove('active-filter'));
  if(status === 'ativo') document.querySelectorAll('.stat-card')[0].classList.add('active-filter');
  if(status === 'inativo') document.querySelectorAll('.stat-card')[1].classList.add('active-filter');
}
window.filtrarPorStatus = filtrarPorStatus;

function atualizarPills() {
  const total = clientesFiltradosRegiao.length;
  const ativos = clientesFiltradosRegiao.filter(c => c.status === "ativo").length;
  const inativos = total - ativos;
  const prospects = prospectsFiltradosRegiao.length;
  const reps = Object.keys(marcadoresRep).length;

  if (document.getElementById("stat-ativos")) document.getElementById("stat-ativos").textContent = ativos;
  if (document.getElementById("stat-inativos")) document.getElementById("stat-inativos").textContent = inativos;
  if (document.getElementById("stat-prospects")) document.getElementById("stat-prospects").textContent = prospects;
  if (document.getElementById("stat-reps")) document.getElementById("stat-reps").textContent = reps;

  const pctAtivo = total > 0 ? Math.round((ativos / total) * 100) : 0;
  const pctInativo = total > 0 ? Math.round((inativos / total) * 100) : 0;

  if (document.getElementById("stat-ativos-pct")) document.getElementById("stat-ativos-pct").textContent = `${pctAtivo}% do total`;
  if (document.getElementById("stat-inativos-pct")) document.getElementById("stat-inativos-pct").textContent = `${pctInativo}% do total`;
}

function renderizarOportunidades() {
  const box = document.getElementById("oport-itens");
  if (!box) return;
  
  if (prospectsFiltradosRegiao.length > 0) {
    box.innerHTML = `
      <div class="oport-item">
        <span class="oport-emoji">🎯</span>
        <div>Existem <b>${prospectsFiltradosRegiao.length} novos prospects</b> na área visível mapeada aguardando prospecção ativa.</div>
      </div>
    `;
  } else {
    box.innerHTML = `<div class="oport-item">Nenhuma brecha de mercado pendente na seleção atual.</div>`;
  }
}

function switchAba(abaNome, btn) {
  document.querySelectorAll(".aba-conteudo").forEach(p => p.classList.remove("active"));
  document.querySelectorAll(".aba-btn").forEach(b => b.classList.remove("active"));
  
  const painelAlvo = document.getElementById("aba-" + abaNome);
  if (painelAlvo) painelAlvo.classList.add("active");
  if (btn) btn.classList.add("active");
}
window.switchAba = switchAba;

function togglePainel() {
  const painel = document.getElementById("painel");
  if (painel) {
    painel.classList.toggle("open");
    const aberto = painel.classList.contains("open");
    document.getElementById("toggle-icon").textContent = aberto ? "◀" : "☰";
  }
}
window.togglePainel = togglePainel;

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
  return `<div class="popup-nome">${c.nome}</div>
    <div class="popup-info">
      <b>CNPJ:</b> ${c.cnpj || "—"}<br><b>Status:</b> <span class="badge ${c.status}">${c.status}</span><br>
      <b>Endereço:</b> ${c.endereco || "—"} (${c.municipio || "—"})<br>
      <b>Representante:</b> ${c.representante || "Sem atribuição"}
    </div>`;
}

function popupRepresentante(rep) {
  const stats = calcularEstatisticasRep(rep);
  return `<div class="popup-nome">${rep.nome}</div>
    <div class="popup-info">
      <b>Base:</b> ${rep.municipio || "—"}<br><b>Área operacional:</b> ${rep.raioKm} km<br>
      <hr>
      <b>Resumo de Atuação:</b><br>
      ✅ Clientes Ativos no Raio: ${stats.clientesAtivos}<br>
      ❌ Clientes Inativos no Raio: ${stats.clientesInativos}<br>
      🎯 Prospects Mapeados: ${stats.prospectsNoRaio}
    </div>`;
}

function onMapClick(e) {
  const { lat, lng } = e.latlng;
  window._pendingLat = lat; window._pendingLng = lng;
}

function mostrarLoading(s, m) {
  const el = document.getElementById("loading");
  if (!el) return;
  el.classList.toggle("hidden", !s);
  if (m) el.querySelector("p").textContent = m;
}

function toast(m) {
  const el = document.getElementById("toast");
  if (!el) return;
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
  const a = document.createElement("a");
  a.href = url;
  a.download = "clientes_filtrados.csv";
  a.click();
}
window.exportarCSV = exportarCSV;

function criarIconeCluster(cluster) {
  const count = cluster.getChildCount();
  const size = count < 100 ? 34 : 44;
  return L.divIcon({
    html: `<div style="background:rgba(26,26,24,0.9);color:#fff;width:${size}px;height:${size}px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;border:2px solid #fff;">${count}</div>`,
    className: "", iconSize: [size, size]
  });
}

async function chamarAPI(params) {
  if (!API_URL) return { clientes:[], prospects:[], representantes:[] };
  const url = new URL(API_URL);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const r = await fetch(url.toString()); return await r.json();
}
