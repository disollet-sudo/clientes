// ============================================================
// MAPA DE CLIENTES — app.js (Versão Representante em Foco)
// ============================================================

const API_URL = "https://script.google.com/macros/s/AKfycbw1cd-544_y5nYIlpRe50qfmJJlSMRSu63aeBCsin4qX3FBB3Px3hr3p5Kj8RnHpTQmbg/exec";

let map, clusterClientes, clusterProspects;
let cacheClientes = [], cacheProspects = [], cacheRepresentantes = [];
let dadosCarregadosGlobais = false;
let clientesFiltradosRegiao = [], prospectsFiltradosRegiao = [], repsFiltradosRegiao = [];
let marcadoresRep = {}, circulosRep = {};
let limitesRegiaoAtual = null;

// Estado do modo "foco no representante"
let modoFocoRep = null;
let rotaLayer = null;
let marcadoresClientesRep = [], marcadoresProspectsRep = [];

document.addEventListener("DOMContentLoaded", () => {
  inicializarMapa();
  mostrarLoading(false);
});

function inicializarMapa() {
  map = L.map("map", { center: [-29.68, -53.80], zoom: 6, zoomControl: true });
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '© <a href="https://openstreetmap.org">OpenStreetMap</a>', maxZoom: 19
  }).addTo(map);
  clusterClientes  = L.markerClusterGroup({ chunkedLoading: true, maxClusterRadius: 45, iconCreateFunction: criarIconeCluster });
  clusterProspects = L.markerClusterGroup({ chunkedLoading: true, maxClusterRadius: 45, iconCreateFunction: criarIconeClusterProspect });
  map.addLayer(clusterClientes);
  map.addLayer(clusterProspects);
  map.on("click", onMapClick);
}

// ------------------------------------------------------------
// EXTRATOR DE COORDENADAS
// ------------------------------------------------------------
function extrairCoordenadas(obj) {
  let lat = obj.Lat || obj.lat || obj.latitude || obj.Latitude || obj.LAT;
  let lng = obj.Lng || obj.lng || obj.longitude || obj.Longitude || obj.LNG;
  let combo = obj.LatLng || obj.latlng || obj.latLng || obj.Coordenadas || "";
  let strLat = String(lat || "").trim();
  if (!combo && strLat.includes("-") && (strLat.match(/-/g) || []).length >= 2 && !lng) combo = strLat;
  if (combo) {
    let limpo = String(combo).replace(/,/g, '.').replace(/\s/g, '');
    let matches = limpo.match(/-?\d+\.\d+|-?\d+/g);
    if (matches && matches.length >= 2) return { lat: parseFloat(matches[0]), lng: parseFloat(matches[1]) };
  }
  function normalizar(val) {
    if (val === undefined || val === null || val === "" || val === "—") return null;
    let n = parseFloat(String(val).replace(',', '.').trim());
    return isNaN(n) ? null : n;
  }
  return { lat: normalizar(lat), lng: normalizar(lng) };
}

// ------------------------------------------------------------
// BUSCA PRINCIPAL
// ------------------------------------------------------------
async function iniciarBusca() {
  const cidadeInput = document.getElementById('input-busca-welcome');
  if (!cidadeInput) return;
  const cidadeNome = cidadeInput.value.trim();
  if (!cidadeNome) { toast("Por favor, digite uma cidade, bairro ou estado."); return; }
  mostrarLoading(true, `Buscando limites de "${cidadeNome}"...`);
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&countrycodes=br&limit=1&addressdetails=1&q=${encodeURIComponent(cidadeNome)}`;
    const data = await (await fetch(url)).json();
    if (data && data.length > 0) {
      const lat = parseFloat(data[0].lat), lon = parseFloat(data[0].lon);
      const bbox = data[0].boundingbox;
      limitesRegiaoAtual = L.latLngBounds(
        L.latLng(parseFloat(bbox[0]), parseFloat(bbox[2])),
        L.latLng(parseFloat(bbox[1]), parseFloat(bbox[3]))
      );
      let zoomAlvo = 12;
      const tipo = data[0].type || "", classe = data[0].class || "", nomeBaixo = data[0].display_name.toLowerCase();
      if (tipo === "state" || nomeBaixo.includes("estado") || (classe === "boundary" && data[0].importance > 0.65)) zoomAlvo = 7;
      else if (tipo === "suburb" || tipo === "neighborhood") zoomAlvo = 14;
      map.flyTo([lat, lon], zoomAlvo, { animate: true, duration: 1.5 });
      cidadeInput.blur();
      const nomeExibicao = data[0].display_name.split(',')[0];
      toast(`Focado em: ${nomeExibicao}`);
      document.getElementById("welcome-overlay")?.classList.add("hidden");
      document.getElementById("painel")?.classList.add("open");
      document.getElementById("btn-toggle")?.classList.add("visible");
      document.getElementById("btn-map-busca")?.classList.add("visible");
      if (document.getElementById("painel-regiao-nome")) document.getElementById("painel-regiao-nome").textContent = nomeExibicao;
      if (document.getElementById("regiao-label-top")) document.getElementById("regiao-label-top").textContent = nomeExibicao;
      if (!dadosCarregadosGlobais) {
        mostrarLoading(true, "Lendo base de dados...");
        await carregarAPIGlobal();
      }
      sairModoFocoRep();
      aplicarFiltroGeografico(limitesRegiaoAtual);
      mostrarLoading(false);
    } else {
      mostrarLoading(false); toast("Região não encontrada. Tente detalhar melhor.");
    }
  } catch (error) {
    console.error(error); mostrarLoading(false); toast("Falha na ligação com o servidor de mapas.");
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
  const inputWelcome = document.getElementById('input-busca-welcome');
  if (inputWelcome) { inputWelcome.value = ""; inputWelcome.focus(); }
}
window.novaBusca = novaBusca;

// ------------------------------------------------------------
// CARREGAR API
// ------------------------------------------------------------
async function carregarAPIGlobal() {
  try {
    const [resClientes, resProspects, resReps] = await Promise.all([
      chamarAPI({ action: "clientes" }),
      chamarAPI({ action: "prospects" }),
      chamarAPI({ action: "representantes" })
    ]);
    const arrClientes = Array.isArray(resClientes) ? resClientes : (resClientes.clientes || []);
    const arrProspects = Array.isArray(resProspects) ? resProspects : (resProspects.prospects || []);
    const arrReps = Array.isArray(resReps) ? resReps : (resReps.representantes || []);

    cacheClientes = arrClientes.map(c => {
      const coords = extrairCoordenadas(c);
      return { ...c, lat: coords.lat, lng: coords.lng };
    });
    cacheProspects = arrProspects.map(p => {
      const coords = extrairCoordenadas(p);
      return {
        ...p,
        cnpj:      p.CNPJ      || p.cnpj      || "—",
        nome:      p.Nome      || p["Razão Social"] || p.nome || p.Razao_Social || "Sem nome",
        municipio: p.Município || p.Municipio  || p.cidade || p.Município_UF || "—",
        endereco:  p.Endereço  || p.Endereco   || p.endereco || "—",
        cnae:      p.CNAE_Desc || p.CNAE       || p.cnae || "—",
        telefone1: p.telefone1 || p["Telefone 1"] || p.Telefone1 || p.Telefone || p.fone || "",
        telefone2: p.telefone2 || p["Telefone 2"] || p.Telefone2 || "",
        email:     p.email     || p["E-mail"]  || p.Email || "",
        lat: coords.lat, lng: coords.lng
      };
    });
    cacheRepresentantes = arrReps.map((r, idx) => {
      const coords = extrairCoordenadas(r);
      const CORES  = ["#f59e0b","#3b82f6","#ec4899","#10b981","#8b5cf6","#f97316","#06b6d4","#84cc16"];

      // Valida bounds Brasil
      const validarBR = (lat, lng) => {
        const latOk = lat && lat >= -35 && lat <= 6;
        const lngOk = lng && lng >= -75 && lng <= -28;
        return latOk && lngOk ? { lat, lng } : { lat: 0, lng: 0 };
      };

      let { lat, lng } = validarBR(coords.lat || r.lat || 0, coords.lng || r.lng || 0);

      // Se coordenadas inválidas, tenta buscar diretamente nos campos brutos
      if (!lat || !lng) {
        const possiveisLat = [r.Lat, r.lat, r.Latitude, r.latitude];
        const possiveisLng = [r.Lng, r.lng, r.Longitude, r.longitude];
        for (const v of possiveisLat) {
          const n = parseFloat(String(v || "").replace(",", "."));
          if (n >= -35 && n <= 6) { lat = n; break; }
        }
        for (const v of possiveisLng) {
          const n = parseFloat(String(v || "").replace(",", "."));
          if (n >= -75 && n <= -28) { lng = n; break; }
        }
      }

      return {
        ...r,
        id:        r.id || r.Cd_empresa || r.cdRepresentante || String(idx),
        nome:      r.nomeExibicao || r.fantasia || r.Nome_completo || r.nome || r.Nome || "Representante",
        municipio: r.municipio || r.Municipio || r.Município || "—",
        uf:        r.uf || r.Uf || "",
        divisao:   r.divisao || r.Divisao || "",
        cdRepresentante: r.cdRepresentante || r.Cd_represent || r.id || "",
        cor:       r.cor || r.Cor || CORES[idx % CORES.length],
        raioKm:    parseFloat(String(r.raioKm || r.RaioKm || 80).replace(",", ".")) || 80,
        lat, lng
      };
    });

    // Debug: mostra no console quantos reps têm coordenadas válidas
    const comCoords = cacheRepresentantes.filter(r => r.lat && r.lng).length;
    console.log(`Representantes carregados: ${cacheRepresentantes.length} total, ${comCoords} com coordenadas válidas`);
    if (comCoords === 0 && cacheRepresentantes.length > 0) {
      console.warn("Amostra de coords recebidas:", cacheRepresentantes.slice(0,3).map(r => ({ nome: r.nome, lat: r.lat, lng: r.lng })));
    }
    dadosCarregadosGlobais = true;
  } catch (e) {
    console.error(e); toast("Erro ao carregar dados."); throw e;
  }
}

// ------------------------------------------------------------
// FILTRO GEOGRÁFICO
// ------------------------------------------------------------
function aplicarFiltroGeografico(bounds) {
  const boundsExpandido = bounds.pad(0.2);
  clientesFiltradosRegiao  = cacheClientes.filter(c  => c.lat  && c.lng  && boundsExpandido.contains(L.latLng(c.lat,  c.lng)));
  prospectsFiltradosRegiao = cacheProspects.filter(p => p.lat  && p.lng  && boundsExpandido.contains(L.latLng(p.lat,  p.lng)));
  repsFiltradosRegiao = cacheRepresentantes.filter(r => {
    if (!r.lat || !r.lng) return true;
    const dist = distanciaKm(r.lat, r.lng, bounds.getCenter().lat, bounds.getCenter().lng);
    return boundsExpandido.contains(L.latLng(r.lat, r.lng)) || (dist <= r.raioKm);
  });
  renderizarClientes(clientesFiltradosRegiao);
  renderizarProspects(prospectsFiltradosRegiao);
  renderizarRepresentantes();
  atualizarPills();
  renderizarOportunidades();
}

// ------------------------------------------------------------
// MODO FOCO NO REPRESENTANTE
// Ao clicar no boneco: zoom no raio, painel filtra só aquele rep
// ------------------------------------------------------------
function ativarModoFocoRep(rep) {
  modoFocoRep = rep;

  // Zoom para o raio do representante
  const raioMetros = rep.raioKm * 1000;
  const bounds = L.latLng(rep.lat, rep.lng).toBounds(raioMetros * 2);
  map.flyToBounds(bounds, { padding: [40, 40], animate: true, duration: 1.2 });

  // Filtra clientes e prospects dentro do raio
  const clientesNoRaio   = cacheClientes.filter(c  => c.lat  && c.lng  && distanciaKm(rep.lat, rep.lng, c.lat,  c.lng) <= rep.raioKm);
  const prospectsNoRaio  = cacheProspects.filter(p => p.lat  && p.lng  && distanciaKm(rep.lat, rep.lng, p.lat,  p.lng) <= rep.raioKm);

  // Redesenha mapa só com os dados do raio
  renderizarClientes(clientesNoRaio);
  renderizarProspects(prospectsNoRaio);

  // Atualiza painel lateral
  clientesFiltradosRegiao  = clientesNoRaio;
  prospectsFiltradosRegiao = prospectsNoRaio;
  atualizarPills();

  // Mostra rota de visita pelos prospects (linha conectando pontos mais próximos)
  desenharRotaProspects(rep, prospectsNoRaio);

  // Abre aba de reps e destaca
  switchAba('reps', document.querySelector('[data-aba=reps]'));
  abrirRepDetalhe(rep, calcularEstatisticasRep(rep));

  // Banner de foco
  mostrarBannerFoco(rep, prospectsNoRaio.length, clientesNoRaio.length);

  toast(`📍 Foco: ${rep.nome} — ${prospectsNoRaio.length} prospects no raio`);
}

function sairModoFocoRep() {
  modoFocoRep = null;
  if (rotaLayer) { map.removeLayer(rotaLayer); rotaLayer = null; }
  ocultarBannerFoco();
}
window.sairModoFocoRep = sairModoFocoRep;

// ------------------------------------------------------------
// ROTA DE VISITA PELOS PROSPECTS (linha + numeração)
// Algoritmo guloso do vizinho mais próximo a partir do rep
// ------------------------------------------------------------
function desenharRotaProspects(rep, prospects) {
  if (rotaLayer) { map.removeLayer(rotaLayer); rotaLayer = null; }
  const comCoords = prospects.filter(p => p.lat && p.lng);
  if (comCoords.length === 0) return;

  // Algoritmo do vizinho mais próximo
  let restantes = [...comCoords];
  let rota = [];
  let atualLat = rep.lat, atualLng = rep.lng;
  while (restantes.length > 0) {
    let melhorIdx = 0, melhorDist = Infinity;
    restantes.forEach((p, i) => {
      const d = distanciaKm(atualLat, atualLng, p.lat, p.lng);
      if (d < melhorDist) { melhorDist = d; melhorIdx = i; }
    });
    const proximo = restantes.splice(melhorIdx, 1)[0];
    rota.push(proximo);
    atualLat = proximo.lat; atualLng = proximo.lng;
  }

  // Desenha a rota como polyline pontilhada
  const pontos = [[rep.lat, rep.lng], ...rota.map(p => [p.lat, p.lng]), [rep.lat, rep.lng]];
  rotaLayer = L.layerGroup();

  L.polyline(pontos, {
    color: "#f59e0b", weight: 2.5, opacity: 0.75, dashArray: "6 5"
  }).addTo(rotaLayer);

  // Numera os prospects na ordem de visita
  rota.forEach((p, i) => {
    const numIcon = L.divIcon({
      className: "",
      iconSize: [22, 22],
      iconAnchor: [11, 11],
      html: `<div style="background:#f59e0b;color:#000;width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.4);">${i+1}</div>`
    });
    L.marker([p.lat, p.lng], { icon: numIcon })
      .bindPopup(`<div class="popup-nome">#${i+1} ${p.nome}</div>
        <div class="popup-info">
          <b>CNPJ:</b> ${p.cnpj}<br>
          <b>CNAE:</b> ${p.cnae}<br>
          <b>Município:</b> ${p.municipio}
          ${p.telefone1 ? `<br><b>📞</b> <a href="tel:${p.telefone1}" style="color:#f59e0b">${p.telefone1}</a>` : ""}
          ${p.telefone2 ? ` / <a href="tel:${p.telefone2}" style="color:#f59e0b">${p.telefone2}</a>` : ""}
          ${p.email     ? `<br><b>✉️</b> ${p.email}` : ""}
        </div>`)
      .addTo(rotaLayer);
  });

  rotaLayer.addTo(map);

  // Guarda rota para exportação
  window._rotaAtual = { rep: window._atualRepParaRota, pontos: rota };
}

// ------------------------------------------------------------
// BANNER DE FOCO
// ------------------------------------------------------------
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
    <button onclick="sairModoFocoRep(); if(limitesRegiaoAtual){aplicarFiltroGeografico(limitesRegiaoAtual);}" style="background:#374151;border:none;color:#fff;border-radius:8px;padding:4px 10px;cursor:pointer;font-size:12px;">✕ Sair</button>`;
  banner.style.display = "flex";
}

function ocultarBannerFoco() {
  const banner = document.getElementById("banner-foco");
  if (banner) banner.style.display = "none";
}

// ------------------------------------------------------------
// RENDERIZAÇÃO
// ------------------------------------------------------------
function renderizarClientes(lista) {
  clusterClientes.clearLayers();
  const listEl = document.getElementById("lista-clientes");
  if (!listEl) return;
  listEl.innerHTML = "";
  lista.forEach(c => {
    if (c.lat && c.lng) {
      const isAtivo = c.status === "ativo";
      const marker = L.circleMarker([c.lat, c.lng], {
        radius: 8, fillColor: isAtivo ? "#22c55e" : "#ef4444",
        color: isAtivo ? "#15803d" : "#b91c1c", weight: 2, fillOpacity: 0.9
      });
      marker.bindPopup(popupCliente(c));
      clusterClientes.addLayer(marker);
    }
    const div = document.createElement("div"); div.className = "item-lista";
    div.innerHTML = `<div class="item-icon" style="background:${c.status==='ativo'?'rgba(34,197,94,0.15)':'rgba(239,68,68,0.15)'}">🏢</div>
      <div class="item-dados"><div class="item-nome">${c.nome||c.cnpj}</div>
      <div class="item-info"><span class="badge ${c.status}">${c.status||"—"}</span>
      ${c.municipio?" · "+c.municipio:""} ${c.representante?" · 💼 "+c.representante:""}</div></div>`;
    div.onclick = () => { if (c.lat && c.lng) map.flyTo([c.lat, c.lng], 15); };
    listEl.appendChild(div);
  });
  if (lista.length === 0) listEl.innerHTML = `<div class="empty-msg">Nenhum cliente mapeado nesta área.</div>`;
}

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
      marker.bindPopup(`<div class="popup-nome">${p.nome}</div>
        <div class="popup-info">
          <b>CNPJ:</b> ${p.cnpj}<br>
          <b>Atividade:</b> ${p.cnae}<br>
          <b>Município:</b> ${p.municipio}<br>
          <b>Endereço:</b> ${p.endereco}
          ${p.telefone1 ? `<br><b>📞 Telefone:</b> <a href="tel:${p.telefone1}" style="color:#2563eb">${p.telefone1}</a>` : ""}
          ${p.telefone2 ? ` / <a href="tel:${p.telefone2}" style="color:#2563eb">${p.telefone2}</a>` : ""}
          ${p.email     ? `<br><b>✉️ E-mail:</b> <a href="mailto:${p.email}" style="color:#2563eb">${p.email}</a>` : ""}
        </div>`);
      clusterProspects.addLayer(marker);
    }
    const div = document.createElement("div"); div.className = "item-lista";
    div.innerHTML = `<div class="item-icon" style="background:rgba(37,99,235,0.15)">🎯</div>
      <div class="item-dados"><div class="item-nome">${p.nome}</div><div class="item-info">
      <span class="badge prospect">Prospect</span> ${p.municipio?" · "+p.municipio:""}
      ${p.telefone1 ? ` · 📞 ${p.telefone1}` : ""}
      · 🏷️ ${p.cnpj}</div></div>`;
    div.onclick = () => { if (p.lat && p.lng) map.flyTo([p.lat, p.lng], 15); };
    listEl.appendChild(div);
  });
  if (lista.length === 0) listEl.innerHTML = `<div class="empty-msg">Nenhum prospect mapeado nesta área.</div>`;
}

function renderizarRepresentantes() {
  const listEl = document.getElementById("lista-reps");
  if (!listEl) return;
  listEl.innerHTML = "";
  Object.values(marcadoresRep).forEach(m => map.removeLayer(m));
  Object.values(circulosRep).forEach(c => map.removeLayer(c));
  marcadoresRep = {}; circulosRep = {};

  repsFiltradosRegiao.forEach(rep => {
    if (rep.lat && rep.lng) {
      // Boneco AMARELO bem visível
      const repIcon = L.divIcon({
        className: "",
        iconSize: [40, 50],
        iconAnchor: [20, 50],
        popupAnchor: [0, -50],
        html: `<div style="position:relative;width:40px;height:50px;filter:drop-shadow(0 3px 6px rgba(0,0,0,0.6));">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 50" width="40" height="50">
            <path d="M20 0C9 0 0 9 0 20c0 15 20 30 20 30S40 35 40 20C40 9 31 0 20 0z" fill="#f59e0b" stroke="#fff" stroke-width="2.5"/>
            <circle cx="20" cy="15" r="6" fill="#1a1a18"/>
            <path d="M8 33c0-6.6 5.4-12 12-12s12 5.4 12 12" fill="#1a1a18"/>
          </svg>
        </div>`
      });
      const marker = L.marker([rep.lat, rep.lng], { icon: repIcon, zIndexOffset: 1000 });

      // Clique no boneco = modo foco
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

    const stats = calcularEstatisticasRep(rep);
    const temCoords = rep.lat && rep.lng;
    const avisoGeo = !temCoords
      ? `<span style="color:#ef4444;font-size:11px;">⚠️ Sem coordenadas na planilha</span>`
      : `<span style="color:#f59e0b;font-size:11px;">⭕ Raio: ${rep.raioKm} km</span>`;

    const div = document.createElement("div"); div.className = "rep-item";
    div.innerHTML = `
      <div class="rep-item-header">
        <div class="rep-mini-dot" style="background:#f59e0b"></div>
        <span class="rep-item-nome">${rep.nome}</span>
      </div>
      <div class="rep-item-info">${rep.municipio?"📍 "+rep.municipio+" · ":""}${avisoGeo}</div>
      <div class="rep-item-stats">
        <div class="rep-mini-stat" style="color:#22c55e"><strong>${stats.clientesAtivos}</strong> Ativos</div>
        <div class="rep-mini-stat" style="color:#ef4444"><strong>${stats.clientesInativos}</strong> Inat.</div>
        <div class="rep-mini-stat" style="color:#2563eb"><strong>${stats.prospectsNoRaio}</strong> Prospects</div>
      </div>
      ${temCoords ? `<div style="margin-top:6px;"><button class="btn-foco-rep" onclick="ativarModoFocoRep(window._reps['${rep.id}'])">🔍 Ver raio de atuação</button></div>` : ""}`;
    div.onclick = (e) => {
      if (e.target.classList.contains("btn-foco-rep")) return;
      if (temCoords) { map.flyTo([rep.lat, rep.lng], 11); abrirRepDetalhe(rep, stats); }
      else toast(`${rep.nome} não possui coordenadas.`);
    };
    listEl.appendChild(div);
  });

  // Guarda reps acessíveis globalmente para os botões inline
  window._reps = {};
  repsFiltradosRegiao.forEach(r => { window._reps[r.id] = r; });

  if (repsFiltradosRegiao.length === 0) listEl.innerHTML = `<div class="empty-msg">Nenhum representante na área.</div>`;
}
window.ativarModoFocoRep = ativarModoFocoRep;

// ------------------------------------------------------------
// CÁLCULOS E PAINÉIS
// ------------------------------------------------------------
function abrirRepDetalhe(rep, stats) {
  const el = document.getElementById("rep-detalhe");
  if (!el) return;
  el.classList.add("open");
  document.getElementById("rep-det-nome").textContent = rep.nome;
  document.getElementById("rd-ativos").textContent = stats.clientesAtivos;
  document.getElementById("rd-inativos").textContent = stats.clientesInativos;
  document.getElementById("rd-prospects").textContent = stats.prospectsNoRaio;
  document.getElementById("rd-raio").textContent = `${rep.raioKm}km`;
  window._atualRepParaRota = rep;

  // Calcula potencial de vendas (prospects / clientes ativos)
  const potencial = stats.clientesAtivos > 0 ? ((stats.prospectsNoRaio / stats.clientesAtivos) * 100).toFixed(0) : "∞";
  const elPot = document.getElementById("rd-potencial");
  if (elPot) elPot.textContent = `${potencial}%`;
}

function fecharRepDetalhe() { document.getElementById("rep-detalhe")?.classList.remove("open"); }
window.fecharRepDetalhe = fecharRepDetalhe;

function verRotaRep() {
  if (!window._atualRepParaRota) return;
  const rep = window._atualRepParaRota;
  if (rep.lat && rep.lng) ativarModoFocoRep(rep);
  else toast(`O representante ${rep.nome} não possui coordenadas.`);
}
window.verRotaRep = verRotaRep;

function exportarRotaCSV() {
  const dados = window._rotaAtual;
  if (!dados || !dados.pontos || dados.pontos.length === 0) {
    toast("Primeiro ative o modo foco de um representante para gerar a rota.");
    return;
  }
  const rep    = dados.rep;
  const pontos = dados.pontos;

  // Cabeçalho
  const linhas = [
    `Rota de Prospecção — ${rep ? rep.nome : "Representante"}`,
    `Gerado em: ${new Date().toLocaleDateString("pt-BR")} ${new Date().toLocaleTimeString("pt-BR")}`,
    `Total de prospects na rota: ${pontos.length}`,
    "",
    "Ordem;Nome;CNPJ;Telefone 1;Telefone 2;E-mail;Município;Endereço;CNAE;Latitude;Longitude"
  ];

  pontos.forEach((p, i) => {
    const linha = [
      i + 1,
      `"${(p.nome      || "").replace(/"/g, '""')}"`,
      `"${(p.cnpj      || "").replace(/"/g, '""')}"`,
      `"${(p.telefone1 || "").replace(/"/g, '""')}"`,
      `"${(p.telefone2 || "").replace(/"/g, '""')}"`,
      `"${(p.email     || "").replace(/"/g, '""')}"`,
      `"${(p.municipio || "").replace(/"/g, '""')}"`,
      `"${(p.endereco  || "").replace(/"/g, '""')}"`,
      `"${(p.cnae      || "").replace(/"/g, '""')}"`,
      p.lat || "",
      p.lng || ""
    ].join(";");
    linhas.push(linha);
  });

  // Adiciona clientes ativos no raio (referência)
  if (rep && rep.lat && rep.lng) {
    const clientesNoRaio = cacheClientes.filter(c =>
      c.lat && c.lng && c.status === "ativo" &&
      distanciaKm(rep.lat, rep.lng, c.lat, c.lng) <= rep.raioKm
    );
    if (clientesNoRaio.length > 0) {
      linhas.push("");
      linhas.push("--- CLIENTES ATIVOS NO RAIO (para referência) ---");
      linhas.push("Nome;CNPJ;Telefone;Município;Endereço;Representante");
      clientesNoRaio.forEach(c => {
        linhas.push([
          `"${(c.nome      || "").replace(/"/g, '""')}"`,
          `"${(c.cnpj      || "").replace(/"/g, '""')}"`,
          `"${(c.fone      || "").replace(/"/g, '""')}"`,
          `"${(c.municipio || "").replace(/"/g, '""')}"`,
          `"${(c.endereco  || "").replace(/"/g, '""')}"`,
          `"${(c.representante || "").replace(/"/g, '""')}"`
        ].join(";"));
      });
    }
  }

  // Download
  const bom     = "\uFEFF"; // BOM para Excel abrir com acentos corretos
  const blob    = new Blob([bom + linhas.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url     = URL.createObjectURL(blob);
  const a       = document.createElement("a");
  const repNome = rep ? rep.nome.replace(/[^a-zA-Z0-9]/g, "_") : "rota";
  a.href        = url;
  a.download    = `rota_${repNome}_${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast(`✅ CSV exportado com ${pontos.length} prospects!`);
}
window.exportarRotaCSV = exportarRotaCSV;

function filtrarClientes() {
  const termo = document.getElementById("filtro-cliente").value.toLowerCase();
  renderizarClientes(clientesFiltradosRegiao.filter(c => (c.nome||"").toLowerCase().includes(termo)||(c.cnpj||"").includes(termo)||(c.municipio||"").toLowerCase().includes(termo)));
}
window.filtrarClientes = filtrarClientes;

function filtrarProspects() {
  const termo = document.getElementById("filtro-prospect").value.toLowerCase();
  renderizarProspects(prospectsFiltradosRegiao.filter(p => (p.nome||"").toLowerCase().includes(termo)||(p.cnpj||"").includes(termo)||(p.cnae||"").toLowerCase().includes(termo)));
}
window.filtrarProspects = filtrarProspects;

function filtrarPorStatus(status) {
  renderizarClientes(clientesFiltradosRegiao.filter(c => c.status === status));
  switchAba('clientes', document.querySelector('[data-aba=clientes]'));
  document.querySelectorAll('.stat-card').forEach(c => c.classList.remove('active-filter'));
  if(status==='ativo')   document.querySelectorAll('.stat-card')[0].classList.add('active-filter');
  if(status==='inativo') document.querySelectorAll('.stat-card')[1].classList.add('active-filter');
}
window.filtrarPorStatus = filtrarPorStatus;

function atualizarPills() {
  const total = clientesFiltradosRegiao.length;
  const ativos = clientesFiltradosRegiao.filter(c => c.status === "ativo").length;
  const inativos = total - ativos;
  if (document.getElementById("stat-ativos"))      document.getElementById("stat-ativos").textContent = ativos;
  if (document.getElementById("stat-inativos"))    document.getElementById("stat-inativos").textContent = inativos;
  if (document.getElementById("stat-prospects"))   document.getElementById("stat-prospects").textContent = prospectsFiltradosRegiao.length;
  if (document.getElementById("stat-reps"))        document.getElementById("stat-reps").textContent = repsFiltradosRegiao.length;
  if (document.getElementById("stat-ativos-pct"))  document.getElementById("stat-ativos-pct").textContent = `${total>0?Math.round((ativos/total)*100):0}% do total`;
  if (document.getElementById("stat-inativos-pct"))document.getElementById("stat-inativos-pct").textContent = `${total>0?Math.round((inativos/total)*100):0}% do total`;
}

function renderizarOportunidades() {
  const box = document.getElementById("oport-itens"); if (!box) return;
  box.innerHTML = prospectsFiltradosRegiao.length > 0
    ? `<div class="oport-item"><span class="oport-emoji">🎯</span><div>Existem <b>${prospectsFiltradosRegiao.length} prospects</b> na área filtrada.</div></div>`
    : `<div class="oport-item">Nenhum prospect mapeado.</div>`;
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
  if (painel) { painel.classList.toggle("open"); document.getElementById("toggle-icon").textContent = painel.classList.contains("open") ? "◀" : "☰"; }
}
window.togglePainel = togglePainel;

function calcularEstatisticasRep(rep) {
  const raioKm = rep.raioKm || 80;
  let ativos = 0, inativos = 0, prospects = 0;
  const cdRep = String(rep.cdRepresentante || rep.id || "").trim();

  cacheClientes.forEach(c => {
    const noRaio = rep.lat && rep.lng && c.lat && c.lng && distanciaKm(rep.lat, rep.lng, c.lat, c.lng) <= raioKm;
    const doRep  = cdRep && (String(c.representante || "").trim() === cdRep || String(c.cd || "").trim() === cdRep);
    if (noRaio || doRep) {
      c.status === "ativo" ? ativos++ : inativos++;
    }
  });

  if (rep.lat && rep.lng) {
    cacheProspects.forEach(p => {
      if (p.lat && p.lng && distanciaKm(rep.lat, rep.lng, p.lat, p.lng) <= raioKm) prospects++;
    });
  }
  return { clientesAtivos: ativos, clientesInativos: inativos, prospectsNoRaio: prospects };
}

function popupCliente(c) {
  return `<div class="popup-nome">${c.nome||"Sem nome"}</div><div class="popup-info"><b>CNPJ:</b> ${c.cnpj||"—"}<br><b>Status:</b> <span class="badge ${c.status}">${c.status}</span><br><b>Endereço:</b> ${c.endereco||"—"} (${c.municipio||"—"})<br><b>Representante:</b> ${c.representante||"Sem atribuição"}</div>`;
}

function popupRepresentante(rep) {
  const stats = calcularEstatisticasRep(rep);
  return `<div class="popup-nome">${rep.nome}</div><div class="popup-info"><b>Base:</b> ${rep.municipio||"—"}<br><b>Raio:</b> ${rep.raioKm}km<hr style="margin:6px 0;border:none;border-top:1px solid #ddd;"><b>No raio:</b><br>✅ ${stats.clientesAtivos} ativos · ❌ ${stats.clientesInativos} inativos<br>🎯 ${stats.prospectsNoRaio} prospects</div>`;
}

function onMapClick(e) { window._pendingLat = e.latlng.lat; window._pendingLng = e.latlng.lng; }

function mostrarLoading(s, m) {
  const el = document.getElementById("loading");
  if (!el) return;
  el.classList.toggle("hidden", !s);
  if (m) el.querySelector("p").textContent = m;
}

function toast(m) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = m;
  el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 3500);
}

function distanciaKm(lat1, lng1, lat2, lng2) {
  const R = 6371, dLat = (lat2-lat1)*Math.PI/180, dLng = (lng2-lng1)*Math.PI/180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function criarIconeCluster(cluster) {
  const count = cluster.getChildCount(), size = count < 100 ? 34 : 44;
  return L.divIcon({
    html: `<div style="background:rgba(26,26,24,0.9);color:#fff;width:${size}px;height:${size}px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;border:2px solid #fff;">${count}</div>`,
    className: "", iconSize: [size, size]
  });
}

function criarIconeClusterProspect(cluster) {
  const count = cluster.getChildCount(), size = count < 100 ? 34 : 44;
  return L.divIcon({
    html: `<div style="background:rgba(37,99,235,0.9);color:#fff;width:${size}px;height:${size}px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:600;border:2px solid #fff;">${count}</div>`,
    className: "", iconSize: [size, size]
  });
}

async function chamarAPI(params) {
  if (!API_URL) return { clientes:[], prospects:[], representantes:[] };
  const url = new URL(API_URL);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const r = await fetch(url.toString());
  return await r.json();
}
