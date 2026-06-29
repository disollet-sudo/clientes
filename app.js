// ============================================================
// MAPA DE CLIENTES — app.js  v2
// Geocodificação feita 100% no backend (api.gs).
// Aqui só consumimos { lat, lng } já prontos.
// ============================================================

const API_URL = "https://script.google.com/macros/s/AKfycbx3DrAZ84HwKT4dppt-0l0rWsZq9creDpWFyMtFKojIPFUsJdaJAtY0siMLA8FXwFr0sw/exec";

let map, clusterClientes, clusterProspects;
let cacheClientes = [], cacheProspects = [], cacheRepresentantes = [];
let dadosCarregadosGlobais = false;
let clientesFiltradosRegiao = [], prospectsFiltradosRegiao = [], repsFiltradosRegiao = [];
let marcadoresRep = {}, circulosRep = {};
let limitesRegiaoAtual = null;

let modoFocoRep = null;
let rotaLayer   = null;

// ============================================================
// INIT
// ============================================================
document.addEventListener("DOMContentLoaded", () => {
  inicializarMapa();
  mostrarLoading(false);
});

function inicializarMapa() {
  map = L.map("map", { center: [-15.78, -47.93], zoom: 5, zoomControl: true });
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '© <a href="https://openstreetmap.org">OpenStreetMap</a>', maxZoom: 19
  }).addTo(map);

  clusterClientes  = L.markerClusterGroup({ chunkedLoading: true, maxClusterRadius: 45, iconCreateFunction: criarIconeCluster });
  clusterProspects = L.markerClusterGroup({ chunkedLoading: true, maxClusterRadius: 45, iconCreateFunction: criarIconeClusterProspect });
  map.addLayer(clusterClientes);
  map.addLayer(clusterProspects);
}

// ============================================================
// BUSCA DE REGIÃO (Nominatim)
// ============================================================
async function iniciarBusca() {
  const input = document.getElementById("input-busca-welcome");
  if (!input) return;
  const termo = input.value.trim();
  if (!termo) { toast("Por favor, digite uma cidade, bairro ou estado."); return; }

  mostrarLoading(true, `Buscando "${termo}"...`);
  try {
    const url  = `https://nominatim.openstreetmap.org/search?format=json&countrycodes=br&limit=1&addressdetails=1&q=${encodeURIComponent(termo)}`;
    const data = await (await fetch(url)).json();

    if (!data || data.length === 0) {
      mostrarLoading(false);
      toast("Região não encontrada. Tente detalhar melhor.");
      return;
    }

    const res  = data[0];
    const lat  = parseFloat(res.lat);
    const lon  = parseFloat(res.lon);
    const bbox = res.boundingbox;

    limitesRegiaoAtual = L.latLngBounds(
      L.latLng(parseFloat(bbox[0]), parseFloat(bbox[2])),
      L.latLng(parseFloat(bbox[1]), parseFloat(bbox[3]))
    );

    // Zoom adaptativo por tipo de lugar
    let zoom = 12;
    if (res.type === "state" || (res.class === "boundary" && res.importance > 0.65)) zoom = 7;
    else if (res.type === "suburb" || res.type === "neighborhood") zoom = 14;

    map.flyTo([lat, lon], zoom, { animate: true, duration: 1.5 });

    const nomeExibicao = res.display_name.split(",")[0];
    toast(`Focado em: ${nomeExibicao}`);

    // Mostra interface principal
    document.getElementById("welcome-overlay")?.classList.add("hidden");
    document.getElementById("painel")?.classList.add("open");
    document.getElementById("btn-toggle")?.classList.add("visible");
    document.getElementById("btn-map-busca")?.classList.add("visible");
    document.getElementById("painel-regiao-nome").textContent  = nomeExibicao;
    document.getElementById("regiao-label-top").textContent    = nomeExibicao;

    // Carrega dados (só uma vez — cache global)
    if (!dadosCarregadosGlobais) {
      mostrarLoading(true, "Carregando e geocodificando dados (pode levar alguns segundos na primeira vez)...");
      await carregarAPIGlobal();
    }

    sairModoFocoRep();
    aplicarFiltroGeografico(limitesRegiaoAtual);
    mostrarLoading(false);

  } catch (err) {
    console.error(err);
    mostrarLoading(false);
    toast("Falha ao buscar a região. Verifique sua conexão.");
  }
}
window.iniciarBusca = iniciarBusca;

function novaBusca() {
  document.getElementById("welcome-overlay")?.classList.remove("hidden");
  document.getElementById("painel")?.classList.remove("open");
  document.getElementById("btn-toggle")?.classList.remove("visible");
  document.getElementById("btn-map-busca")?.classList.remove("visible");
  fecharRepDetalhe();
  sairModoFocoRep();
  const input = document.getElementById("input-busca-welcome");
  if (input) { input.value = ""; input.focus(); }
}
window.novaBusca = novaBusca;

// ============================================================
// CARREGA API (tudo de uma vez, sem lógica de coords aqui)
// ============================================================
async function carregarAPIGlobal() {
  try {
    const [resC, resP, resR] = await Promise.all([
      chamarAPI({ action: "clientes" }),
      chamarAPI({ action: "prospects" }),
      chamarAPI({ action: "representantes" })
    ]);

    // ── Clientes ─────────────────────────────────────────────
    const arrC = Array.isArray(resC) ? resC : (resC.clientes || []);
    cacheClientes = arrC.map(c => ({
      ...c,
      // Garante que lat/lng sejam números (backend já entrega certo, mas por segurança)
      lat: parseFloat(c.lat) || 0,
      lng: parseFloat(c.lng) || 0
    }));

    // ── Prospects ────────────────────────────────────────────
    const arrP = Array.isArray(resP) ? resP : (resP.prospects || []);
    cacheProspects = arrP.map(p => ({
      cnpj:      p.cnpj      || "—",
      nome:      p.nome      || "Sem nome",
      municipio: p.municipio || "—",
      uf:        p.uf        || "",
      endereco:  p.endereco  || "—",
      cnae:      p.cnae      || "—",
      telefone1: p.telefone1 || "",
      telefone2: p.telefone2 || "",
      email:     p.email     || "",
      lat:       parseFloat(p.lat) || 0,
      lng:       parseFloat(p.lng) || 0
    }));

    // ── Representantes ───────────────────────────────────────
    const CORES = ["#f59e0b","#3b82f6","#ec4899","#10b981","#8b5cf6","#f97316","#06b6d4","#84cc16"];
    const arrR  = Array.isArray(resR) ? resR : (resR.representantes || []);
    cacheRepresentantes = arrR.map((r, idx) => ({
      ...r,
      id:       r.id || r.cdRepresentante || r.cdEmpresa || String(idx),
      nome:     r.nomeExibicao || r.fantasia || r.nome || "Representante",
      cor:      r.cor || CORES[idx % CORES.length],
      raioKm:   parseFloat(String(r.raioKm || 80).replace(",",".")) || 80,
      lat:      parseFloat(r.lat) || 0,
      lng:      parseFloat(r.lng) || 0
    }));

    const comCoordsC = cacheClientes.filter(c => c.lat && c.lng).length;
    const comCoordsP = cacheProspects.filter(p => p.lat && p.lng).length;
    const comCoordsR = cacheRepresentantes.filter(r => r.lat && r.lng).length;
    console.log(`Clientes: ${cacheClientes.length} total, ${comCoordsC} com coords`);
    console.log(`Prospects: ${cacheProspects.length} total, ${comCoordsP} com coords`);
    console.log(`Representantes: ${cacheRepresentantes.length} total, ${comCoordsR} com coords`);

    if (comCoordsC === 0 && cacheClientes.length > 0) {
      toast("⚠️ Nenhum cliente foi geocodificado ainda. Aguarde — o backend está processando.");
    }

    dadosCarregadosGlobais = true;
  } catch (e) {
    console.error(e);
    toast("Erro ao carregar dados. Verifique o console.");
    throw e;
  }
}

// ============================================================
// FILTRO GEOGRÁFICO
// ============================================================
function aplicarFiltroGeografico(bounds) {
  const exp = bounds.pad(0.2);

  clientesFiltradosRegiao  = cacheClientes.filter(c =>
    c.lat && c.lng && exp.contains(L.latLng(c.lat, c.lng))
  );
  prospectsFiltradosRegiao = cacheProspects.filter(p =>
    p.lat && p.lng && exp.contains(L.latLng(p.lat, p.lng))
  );
  repsFiltradosRegiao = cacheRepresentantes.filter(r => {
    if (!r.lat || !r.lng) return false;
    return exp.contains(L.latLng(r.lat, r.lng)) ||
           distanciaKm(r.lat, r.lng, bounds.getCenter().lat, bounds.getCenter().lng) <= r.raioKm;
  });

  renderizarClientes(clientesFiltradosRegiao);
  renderizarProspects(prospectsFiltradosRegiao);
  renderizarRepresentantes();
  atualizarPills();
  renderizarOportunidades();
}

// ============================================================
// RENDERIZAÇÃO — CLIENTES
// ============================================================
function renderizarClientes(lista) {
  clusterClientes.clearLayers();
  const listEl = document.getElementById("lista-clientes");
  if (!listEl) return;
  listEl.innerHTML = "";

  lista.forEach(c => {
    if (c.lat && c.lng) {
      const cor    = c.status === "ativo" ? "#22c55e" : "#ef4444";
      const marker = L.circleMarker([c.lat, c.lng], {
        radius: 8, fillColor: cor, color: cor === "#22c55e" ? "#16a34a" : "#dc2626",
        weight: 2, fillOpacity: 0.85
      });
      marker.bindPopup(popupCliente(c));
      clusterClientes.addLayer(marker);
    }

    const div = document.createElement("div");
    div.className = "item-lista";
    div.innerHTML = `
      <div class="item-icon" style="background:rgba(${c.status==='ativo'?'34,197,94':'239,68,68'},0.15)">
        ${c.status === "ativo" ? "✅" : "⛔"}
      </div>
      <div class="item-dados">
        <div class="item-nome">${c.nome || "Sem nome"}</div>
        <div class="item-info">
          <span class="badge ${c.status}">${c.status}</span>
          ${c.municipio ? " · " + c.municipio : ""}
          ${c.fone ? " · 📞 " + c.fone : ""}
          ${c.cnpj ? " · " + c.cnpj : ""}
          ${!c.lat || !c.lng ? ' <span style="color:#f59e0b">⚠️ sem mapa</span>' : ""}
        </div>
      </div>`;
    div.onclick = () => {
      if (c.lat && c.lng) map.flyTo([c.lat, c.lng], 16);
      else toast(`${c.nome} ainda não foi geocodificado.`);
    };
    listEl.appendChild(div);
  });

  if (lista.length === 0) listEl.innerHTML = `<div class="empty-msg">Nenhum cliente nesta área.</div>`;
}

// ============================================================
// RENDERIZAÇÃO — PROSPECTS
// ============================================================
function renderizarProspects(lista) {
  clusterProspects.clearLayers();
  const listEl = document.getElementById("lista-prospects");
  if (!listEl) return;
  listEl.innerHTML = "";

  lista.forEach(p => {
    if (p.lat && p.lng) {
      const marker = L.circleMarker([p.lat, p.lng], {
        radius: 8, fillColor: "#2563eb", color: "#1d4ed8", weight: 2, fillOpacity: 0.85
      });
      marker.bindPopup(`
        <div class="popup-nome">${p.nome}</div>
        <div class="popup-info">
          <b>CNPJ:</b> ${p.cnpj}<br>
          <b>Atividade:</b> ${p.cnae}<br>
          <b>Município:</b> ${p.municipio}${p.uf ? " — " + p.uf : ""}<br>
          <b>Endereço:</b> ${p.endereco}
          ${p.telefone1 ? `<br><b>📞</b> <a href="tel:${p.telefone1}" style="color:#2563eb">${p.telefone1}</a>` : ""}
          ${p.telefone2 ? ` / <a href="tel:${p.telefone2}" style="color:#2563eb">${p.telefone2}</a>` : ""}
          ${p.email     ? `<br><b>✉️</b> <a href="mailto:${p.email}" style="color:#2563eb">${p.email}</a>` : ""}
        </div>`);
      clusterProspects.addLayer(marker);
    }

    const div = document.createElement("div");
    div.className = "item-lista";
    div.innerHTML = `
      <div class="item-icon" style="background:rgba(37,99,235,0.15)">🎯</div>
      <div class="item-dados">
        <div class="item-nome">${p.nome}</div>
        <div class="item-info">
          <span class="badge prospect">Prospect</span>
          ${p.municipio ? " · " + p.municipio : ""}
          ${p.telefone1 ? " · 📞 " + p.telefone1 : ""}
          · ${p.cnpj}
          ${!p.lat || !p.lng ? ' <span style="color:#f59e0b">⚠️ sem mapa</span>' : ""}
        </div>
      </div>`;
    div.onclick = () => {
      if (p.lat && p.lng) map.flyTo([p.lat, p.lng], 15);
      else toast(`${p.nome} ainda não foi geocodificado.`);
    };
    listEl.appendChild(div);
  });

  if (lista.length === 0) listEl.innerHTML = `<div class="empty-msg">Nenhum prospect mapeado nesta área.</div>`;
}

// ============================================================
// RENDERIZAÇÃO — REPRESENTANTES
// ============================================================
function renderizarRepresentantes() {
  const listEl = document.getElementById("lista-reps");
  if (!listEl) return;
  listEl.innerHTML = "";

  Object.values(marcadoresRep).forEach(m => map.removeLayer(m));
  Object.values(circulosRep).forEach(c => map.removeLayer(c));
  marcadoresRep = {}; circulosRep = {};

  repsFiltradosRegiao.forEach(rep => {
    if (rep.lat && rep.lng) {
      const repIcon = L.divIcon({
        className: "",
        iconSize: [40, 50], iconAnchor: [20, 50], popupAnchor: [0, -50],
        html: `<div style="position:relative;width:40px;height:50px;filter:drop-shadow(0 3px 6px rgba(0,0,0,0.6));">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 50" width="40" height="50">
            <path d="M20 0C9 0 0 9 0 20c0 15 20 30 20 30S40 35 40 20C40 9 31 0 20 0z" fill="#f59e0b" stroke="#fff" stroke-width="2.5"/>
            <circle cx="20" cy="15" r="6" fill="#1a1a18"/>
            <path d="M8 33c0-6.6 5.4-12 12-12s12 5.4 12 12" fill="#1a1a18"/>
          </svg>
        </div>`
      });

      const marker = L.marker([rep.lat, rep.lng], { icon: repIcon, zIndexOffset: 1000 });
      marker.on("click", () => ativarModoFocoRep(rep));
      marker.addTo(map);
      marcadoresRep[rep.id] = marker;

      const circulo = L.circle([rep.lat, rep.lng], {
        radius: rep.raioKm * 1000,
        fillColor: "#f59e0b", fillOpacity: 0.04,
        color: "#f59e0b", weight: 1.5, dashArray: "6 5"
      });
      circulo.addTo(map);
      circulosRep[rep.id] = circulo;
    }

    const stats     = calcularEstatisticasRep(rep);
    const temCoords = !!(rep.lat && rep.lng);
    const avisoGeo  = !temCoords
      ? `<span style="color:#f59e0b;font-size:11px;">⚠️ Geocodificando endereço...</span>`
      : `<span style="color:#f59e0b;font-size:11px;">⭕ Raio: ${rep.raioKm} km</span>`;

    const div = document.createElement("div");
    div.className = "rep-item";
    div.innerHTML = `
      <div class="rep-item-header">
        <div class="rep-mini-dot" style="background:#f59e0b"></div>
        <span class="rep-item-nome">${rep.nome}</span>
      </div>
      <div class="rep-item-info">
        ${rep.municipio ? "📍 " + rep.municipio + (rep.uf ? " — " + rep.uf : "") + " · " : ""}
        ${avisoGeo}
      </div>
      <div class="rep-item-stats">
        <div class="rep-mini-stat" style="color:#22c55e"><strong>${stats.clientesAtivos}</strong> Ativos</div>
        <div class="rep-mini-stat" style="color:#ef4444"><strong>${stats.clientesInativos}</strong> Inat.</div>
        <div class="rep-mini-stat" style="color:#2563eb"><strong>${stats.prospectsNoRaio}</strong> Prospects</div>
      </div>
      ${temCoords
        ? `<div style="margin-top:6px;"><button class="btn-foco-rep" onclick="ativarModoFocoRep(window._reps['${rep.id}'])">🔍 Ver raio de atuação</button></div>`
        : ""}`;

    div.onclick = (e) => {
      if (e.target.classList.contains("btn-foco-rep")) return;
      if (temCoords) { map.flyTo([rep.lat, rep.lng], 11); abrirRepDetalhe(rep, stats); }
      else toast(`${rep.nome}: endereço ainda sendo geocodificado.`);
    };
    listEl.appendChild(div);
  });

  window._reps = {};
  repsFiltradosRegiao.forEach(r => { window._reps[r.id] = r; });

  if (repsFiltradosRegiao.length === 0) {
    listEl.innerHTML = `<div class="empty-msg">Nenhum representante na área.</div>`;
  }
}
window.ativarModoFocoRep = ativarModoFocoRep;

// ============================================================
// MODO FOCO NO REPRESENTANTE
// ============================================================
function ativarModoFocoRep(rep) {
  if (!rep || !rep.lat || !rep.lng) {
    toast("Este representante ainda não possui coordenadas.");
    return;
  }
  modoFocoRep = rep;

  const raioMetros   = rep.raioKm * 1000;
  const bounds       = L.latLng(rep.lat, rep.lng).toBounds(raioMetros * 2);
  map.flyToBounds(bounds, { padding: [40, 40], animate: true, duration: 1.2 });

  const clientesNoRaio  = cacheClientes.filter(c =>
    c.lat && c.lng && distanciaKm(rep.lat, rep.lng, c.lat, c.lng) <= rep.raioKm
  );
  const prospectsNoRaio = cacheProspects.filter(p =>
    p.lat && p.lng && distanciaKm(rep.lat, rep.lng, p.lat, p.lng) <= rep.raioKm
  );

  renderizarClientes(clientesNoRaio);
  renderizarProspects(prospectsNoRaio);
  clientesFiltradosRegiao  = clientesNoRaio;
  prospectsFiltradosRegiao = prospectsNoRaio;
  atualizarPills();
  desenharRotaProspects(rep, prospectsNoRaio);
  switchAba("representantes", document.querySelector("[data-aba=representantes]"));
  abrirRepDetalhe(rep, calcularEstatisticasRep(rep));
  mostrarBannerFoco(rep, prospectsNoRaio.length, clientesNoRaio.length);
  toast(`📍 Foco: ${rep.nome} — ${prospectsNoRaio.length} prospects no raio`);
}

function sairModoFocoRep() {
  modoFocoRep = null;
  if (rotaLayer) { map.removeLayer(rotaLayer); rotaLayer = null; }
  ocultarBannerFoco();
}
window.sairModoFocoRep = sairModoFocoRep;

// ============================================================
// ROTA DE VISITA (vizinho mais próximo)
// ============================================================
function desenharRotaProspects(rep, prospects) {
  if (rotaLayer) { map.removeLayer(rotaLayer); rotaLayer = null; }
  const comCoords = prospects.filter(p => p.lat && p.lng);
  if (comCoords.length === 0) return;

  let restantes = [...comCoords];
  let rota = [], atualLat = rep.lat, atualLng = rep.lng;
  while (restantes.length > 0) {
    let melhorIdx = 0, melhorDist = Infinity;
    restantes.forEach((p, i) => {
      const d = distanciaKm(atualLat, atualLng, p.lat, p.lng);
      if (d < melhorDist) { melhorDist = d; melhorIdx = i; }
    });
    const prox = restantes.splice(melhorIdx, 1)[0];
    rota.push(prox);
    atualLat = prox.lat; atualLng = prox.lng;
  }

  const pontos = [[rep.lat, rep.lng], ...rota.map(p => [p.lat, p.lng]), [rep.lat, rep.lng]];
  rotaLayer    = L.layerGroup();

  L.polyline(pontos, { color: "#f59e0b", weight: 2.5, opacity: 0.75, dashArray: "6 5" })
   .addTo(rotaLayer);

  rota.forEach((p, i) => {
    const numIcon = L.divIcon({
      className: "", iconSize: [22, 22], iconAnchor: [11, 11],
      html: `<div style="background:#f59e0b;color:#000;width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.4);">${i+1}</div>`
    });
    L.marker([p.lat, p.lng], { icon: numIcon })
      .bindPopup(`<div class="popup-nome">#${i+1} ${p.nome}</div>
        <div class="popup-info">
          <b>CNPJ:</b> ${p.cnpj}<br>
          <b>CNAE:</b> ${p.cnae}<br>
          <b>Endereço:</b> ${p.endereco}<br>
          <b>Município:</b> ${p.municipio}
          ${p.telefone1 ? `<br><b>📞</b> <a href="tel:${p.telefone1}" style="color:#f59e0b">${p.telefone1}</a>` : ""}
          ${p.telefone2 ? ` / <a href="tel:${p.telefone2}" style="color:#f59e0b">${p.telefone2}</a>` : ""}
          ${p.email     ? `<br><b>✉️</b> ${p.email}` : ""}
        </div>`)
      .addTo(rotaLayer);
  });

  rotaLayer.addTo(map);
  window._rotaAtual = { rep, pontos: rota };
}

// ============================================================
// BANNER DE FOCO
// ============================================================
function mostrarBannerFoco(rep, numProspects, numClientes) {
  let banner = document.getElementById("banner-foco");
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "banner-foco";
    banner.style.cssText = `position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:9999;background:#1a1a18;color:#fff;padding:10px 18px;border-radius:12px;font-size:13px;display:flex;align-items:center;gap:12px;box-shadow:0 4px 20px rgba(0,0,0,0.5);border:1px solid #f59e0b;`;
    document.body.appendChild(banner);
  }
  banner.innerHTML = `
    <span style="font-size:16px;">🧍</span>
    <div>
      <div style="font-weight:700;color:#fbbf24;">${rep.nome}</div>
      <div style="font-size:11px;color:#aaa;">Raio ${rep.raioKm}km · <span style="color:#2563eb">●</span> ${numProspects} prospects · <span style="color:#22c55e">●</span> ${numClientes} clientes</div>
    </div>
    <button onclick="sairModoFocoRep();aplicarFiltroGeografico(limitesRegiaoAtual);"
      style="margin-left:8px;background:rgba(255,255,255,0.1);border:none;color:#fff;padding:5px 10px;border-radius:8px;cursor:pointer;font-size:12px;">✕ Sair</button>`;
  banner.style.display = "flex";
}

function ocultarBannerFoco() {
  const banner = document.getElementById("banner-foco");
  if (banner) banner.style.display = "none";
}

// ============================================================
// EXPORTAR CSV DA ROTA
// ============================================================
function exportarRotaCSV() {
  const dados = window._rotaAtual;
  if (!dados || !dados.pontos || dados.pontos.length === 0) {
    toast("Primeiro ative o modo foco de um representante para gerar a rota.");
    return;
  }
  const rep    = dados.rep;
  const pontos = dados.pontos;

  const linhas = [
    `Rota de Prospecção — ${rep ? rep.nome : "Representante"}`,
    `Gerado em: ${new Date().toLocaleDateString("pt-BR")} ${new Date().toLocaleTimeString("pt-BR")}`,
    `Total de prospects na rota: ${pontos.length}`,
    "",
    "Ordem;Nome;CNPJ;Telefone 1;Telefone 2;E-mail;Município;UF;Endereço;CNAE"
  ];

  pontos.forEach((p, i) => {
    linhas.push([
      i + 1,
      `"${(p.nome      || "").replace(/"/g,'""')}"`,
      `"${(p.cnpj      || "").replace(/"/g,'""')}"`,
      `"${(p.telefone1 || "").replace(/"/g,'""')}"`,
      `"${(p.telefone2 || "").replace(/"/g,'""')}"`,
      `"${(p.email     || "").replace(/"/g,'""')}"`,
      `"${(p.municipio || "").replace(/"/g,'""')}"`,
      `"${(p.uf        || "").replace(/"/g,'""')}"`,
      `"${(p.endereco  || "").replace(/"/g,'""')}"`,
      `"${(p.cnae      || "").replace(/"/g,'""')}"`
    ].join(";"));
  });

  // Clientes ativos no raio como referência
  if (rep && rep.lat && rep.lng) {
    const clientesNoRaio = cacheClientes.filter(c =>
      c.lat && c.lng && c.status === "ativo" &&
      distanciaKm(rep.lat, rep.lng, c.lat, c.lng) <= rep.raioKm
    );
    if (clientesNoRaio.length > 0) {
      linhas.push("", "--- CLIENTES ATIVOS NO RAIO ---", "Nome;CNPJ;Telefone;Município;Endereço;Representante");
      clientesNoRaio.forEach(c => {
        linhas.push([
          `"${(c.nome         || "").replace(/"/g,'""')}"`,
          `"${(c.cnpj         || "").replace(/"/g,'""')}"`,
          `"${(c.fone         || "").replace(/"/g,'""')}"`,
          `"${(c.municipio    || "").replace(/"/g,'""')}"`,
          `"${(c.endereco     || "").replace(/"/g,'""')}"`,
          `"${(c.representante|| "").replace(/"/g,'""')}"`
        ].join(";"));
      });
    }
  }

  const bom  = "\uFEFF";
  const blob = new Blob([bom + linhas.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `rota_${(rep ? rep.nome : "rota").replace(/[^a-zA-Z0-9]/g,"_")}_${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast(`✅ CSV exportado com ${pontos.length} prospects!`);
}
window.exportarRotaCSV = exportarRotaCSV;

// ============================================================
// FILTROS / LISTAS
// ============================================================
function filtrarClientes() {
  const t = document.getElementById("filtro-cliente").value.toLowerCase();
  renderizarClientes(clientesFiltradosRegiao.filter(c =>
    (c.nome||"").toLowerCase().includes(t) ||
    (c.cnpj||"").includes(t) ||
    (c.municipio||"").toLowerCase().includes(t)
  ));
}
window.filtrarClientes = filtrarClientes;

function filtrarProspects() {
  const t = document.getElementById("filtro-prospect").value.toLowerCase();
  renderizarProspects(prospectsFiltradosRegiao.filter(p =>
    (p.nome||"").toLowerCase().includes(t) ||
    (p.cnpj||"").includes(t) ||
    (p.cnae||"").toLowerCase().includes(t)
  ));
}
window.filtrarProspects = filtrarProspects;

function filtrarPorStatus(status) {
  renderizarClientes(clientesFiltradosRegiao.filter(c => c.status === status));
  switchAba("clientes", document.querySelector("[data-aba=clientes]"));
  document.querySelectorAll(".stat-card").forEach(c => c.classList.remove("active-filter"));
  if (status === "ativo")   document.querySelectorAll(".stat-card")[0].classList.add("active-filter");
  if (status === "inativo") document.querySelectorAll(".stat-card")[1].classList.add("active-filter");
}
window.filtrarPorStatus = filtrarPorStatus;

function atualizarPills() {
  const total    = clientesFiltradosRegiao.length;
  const ativos   = clientesFiltradosRegiao.filter(c => c.status === "ativo").length;
  const inativos = total - ativos;
  const pct      = n => total > 0 ? Math.round((n / total) * 100) : 0;

  document.getElementById("stat-ativos")?.setAttribute("textContent" in HTMLElement.prototype ? "" : "", "");
  const s = id => document.getElementById(id);
  if (s("stat-ativos"))       s("stat-ativos").textContent       = ativos;
  if (s("stat-inativos"))     s("stat-inativos").textContent     = inativos;
  if (s("stat-prospects"))    s("stat-prospects").textContent    = prospectsFiltradosRegiao.length;
  if (s("stat-reps"))         s("stat-reps").textContent         = repsFiltradosRegiao.length;
  if (s("stat-ativos-pct"))   s("stat-ativos-pct").textContent   = `${pct(ativos)}% do total`;
  if (s("stat-inativos-pct")) s("stat-inativos-pct").textContent = `${pct(inativos)}% do total`;
}

function renderizarOportunidades() {
  const box = document.getElementById("oport-itens");
  if (!box) return;
  box.innerHTML = prospectsFiltradosRegiao.length > 0
    ? `<div class="oport-item"><span class="oport-emoji">🎯</span><div>Existem <b>${prospectsFiltradosRegiao.length} prospects</b> na área filtrada.</div></div>`
    : `<div class="oport-item">Nenhum prospect mapeado.</div>`;
}

function switchAba(abaNome, btn) {
  document.querySelectorAll(".aba-conteudo").forEach(p => p.classList.remove("active"));
  document.querySelectorAll(".aba-btn").forEach(b => b.classList.remove("active"));
  document.getElementById("aba-" + abaNome)?.classList.add("active");
  if (btn) btn.classList.add("active");
}
window.switchAba = switchAba;

function togglePainel() {
  const painel = document.getElementById("painel");
  if (!painel) return;
  painel.classList.toggle("open");
  document.getElementById("toggle-icon").textContent = painel.classList.contains("open") ? "◀" : "☰";
}
window.togglePainel = togglePainel;

// ============================================================
// PAINEL DO REPRESENTANTE
// ============================================================
function calcularEstatisticasRep(rep) {
  const raioKm = rep.raioKm || 80;
  const cdRep  = String(rep.cdRepresentante || rep.id || "").trim();
  let ativos = 0, inativos = 0, prospects = 0;

  cacheClientes.forEach(c => {
    const noRaio = rep.lat && rep.lng && c.lat && c.lng &&
                   distanciaKm(rep.lat, rep.lng, c.lat, c.lng) <= raioKm;
    const doRep  = cdRep && (
      String(c.representante || "").trim() === cdRep ||
      String(c.cd            || "").trim() === cdRep
    );
    if (noRaio || doRep) { c.status === "ativo" ? ativos++ : inativos++; }
  });

  if (rep.lat && rep.lng) {
    cacheProspects.forEach(p => {
      if (p.lat && p.lng && distanciaKm(rep.lat, rep.lng, p.lat, p.lng) <= raioKm) prospects++;
    });
  }
  return { clientesAtivos: ativos, clientesInativos: inativos, prospectsNoRaio: prospects };
}

function abrirRepDetalhe(rep, stats) {
  const el = document.getElementById("rep-detalhe");
  if (!el) return;
  el.classList.add("open");
  document.getElementById("rep-det-nome").textContent   = rep.nome;
  document.getElementById("rd-ativos").textContent      = stats.clientesAtivos;
  document.getElementById("rd-inativos").textContent    = stats.clientesInativos;
  document.getElementById("rd-prospects").textContent   = stats.prospectsNoRaio;
  document.getElementById("rd-raio").textContent        = `${rep.raioKm}km`;
  window._atualRepParaRota = rep;
}

function fecharRepDetalhe() { document.getElementById("rep-detalhe")?.classList.remove("open"); }
window.fecharRepDetalhe = fecharRepDetalhe;

function verRotaRep() {
  if (!window._atualRepParaRota) return;
  ativarModoFocoRep(window._atualRepParaRota);
}
window.verRotaRep = verRotaRep;

// ============================================================
// POPUPS
// ============================================================
function popupCliente(c) {
  return `
    <div class="popup-nome">${c.nome || "Sem nome"}</div>
    <div class="popup-info">
      <b>CNPJ:</b> ${c.cnpj || "—"}<br>
      <b>Status:</b> <span class="badge ${c.status}">${c.status}</span><br>
      <b>Endereço:</b> ${c.endereco || "—"}<br>
      <b>Município:</b> ${c.municipio || "—"}${c.uf ? " — " + c.uf : ""}<br>
      <b>Representante:</b> ${c.representante || "Sem atribuição"}
      ${c.fone ? `<br><b>📞</b> <a href="tel:${c.fone}">${c.fone}</a>` : ""}
    </div>`;
}

// ============================================================
// UTILITÁRIOS
// ============================================================
function distanciaKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 +
            Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) * Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function criarIconeCluster(cluster) {
  const c = cluster.getChildCount(), s = c < 100 ? 34 : 44;
  return L.divIcon({
    html: `<div style="background:rgba(26,26,24,0.9);color:#fff;width:${s}px;height:${s}px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;border:2px solid #fff;">${c}</div>`,
    className: "", iconSize: [s, s]
  });
}

function criarIconeClusterProspect(cluster) {
  const c = cluster.getChildCount(), s = c < 100 ? 34 : 44;
  return L.divIcon({
    html: `<div style="background:rgba(37,99,235,0.9);color:#fff;width:${s}px;height:${s}px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;border:2px solid #fff;">${c}</div>`,
    className: "", iconSize: [s, s]
  });
}

function mostrarLoading(s, m) {
  const el = document.getElementById("loading");
  if (!el) return;
  el.classList.toggle("hidden", !s);
  if (m && el.querySelector("p")) el.querySelector("p").textContent = m;
}

function toast(m) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = m;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 3500);
}

async function chamarAPI(params) {
  const url = new URL(API_URL);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const r = await fetch(url.toString());
  return r.json();
}
