// ============================================================
// GESTÃO COMERCIAL — app.js
// Substitua a URL abaixo pela URL do seu Google Apps Script
// ============================================================

const GAS_URL = 'https://script.google.com/macros/s/AKfycbw-uVG8ou7ClOx8q04Xx_GCihwPPRYbqSNx3aJh7QXPYcsW1OKRNBdaWHMgO89UTvmnQg/exec';
const RAIO_PADRAO_KM = 200;

// ─── Estado global ───────────────────────────────────────────
const state = {
  map: null,
  dados: null,           // { clientes, prospects, representantes }
  regiaoNome: '',
  bbox: null,
  layers: {
    clientes: null,
    prospects: null,
    representantes: null,
    raioCircle: null,
    rota: null,
    highlight: []
  },
  repAtivo: null,        // representante selecionado
};

// ─── Init ────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initMap();
  bindUI();
});

// ============================================================
// MAPA
// ============================================================
function initMap() {
  state.map = L.map('map', {
    center: [-15.7801, -47.9292],
    zoom: 5,
    zoomControl: false
  });

  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '© OpenStreetMap © CARTO',
    subdomains: 'abcd',
    maxZoom: 19
  }).addTo(state.map);

  L.control.zoom({ position: 'bottomright' }).addTo(state.map);
}

// ============================================================
// BIND UI
// ============================================================
function bindUI() {
  // Botão buscar região
  document.getElementById('btn-buscar').addEventListener('click', buscarRegiao);
  document.getElementById('input-regiao').addEventListener('keydown', e => {
    if (e.key === 'Enter') buscarRegiao();
  });

  // Fechar drawer representante
  document.getElementById('btn-fechar-drawer').addEventListener('click', fecharDrawer);

  // Botão rota + CSV
  document.getElementById('btn-rota-csv').addEventListener('click', rotaECsv);

  // Nova busca
  document.getElementById('btn-nova-busca').addEventListener('click', novaBusca);

  // Abas do painel
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    });
  });

  // Filtros das abas
  document.getElementById('filtro-clientes').addEventListener('input', renderListaClientes);
  document.getElementById('filtro-prospects').addEventListener('input', renderListaProspects);
  document.getElementById('filtro-representantes').addEventListener('input', renderListaRepresentantes);
}

// ============================================================
// BUSCA DE REGIÃO (Nominatim)
// ============================================================
async function buscarRegiao() {
  const termo = document.getElementById('input-regiao').value.trim();
  if (!termo) return;

  const btnBuscar = document.getElementById('btn-buscar');
  btnBuscar.textContent = 'Buscando...';
  btnBuscar.disabled = true;

  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(termo)}&format=json&limit=1&accept-language=pt-BR`;
    const resp = await fetch(url, { headers: { 'User-Agent': 'GestaoComercial/1.0' } });
    const resultados = await resp.json();

    if (!resultados.length) {
      alert('Região não encontrada. Tente outro nome.');
      return;
    }

    const r = resultados[0];
    const bb = r.boundingbox; // [latMin, latMax, lngMin, lngMax]
    state.bbox = {
      latMin: parseFloat(bb[0]),
      latMax: parseFloat(bb[1]),
      lngMin: parseFloat(bb[2]),
      lngMax: parseFloat(bb[3])
    };
    state.regiaoNome = r.display_name.split(',')[0];

    // Centraliza mapa
    state.map.fitBounds([
      [state.bbox.latMin, state.bbox.lngMin],
      [state.bbox.latMax, state.bbox.lngMax]
    ], { padding: [30, 30] });

    // Fecha card de busca
    document.getElementById('card-busca').style.display = 'none';

    // Carrega dados do backend
    await carregarDados();

  } catch (err) {
    alert('Erro ao buscar região: ' + err.message);
  } finally {
    btnBuscar.textContent = 'Buscar';
    btnBuscar.disabled = false;
  }
}

// ============================================================
// CARREGAR DADOS DO GAS
// ============================================================
async function carregarDados() {
  mostrarLoading(true);

  try {
    const { latMin, latMax, lngMin, lngMax } = state.bbox;
    const url = `${GAS_URL}?acao=getRegiao&latMin=${latMin}&latMax=${latMax}&lngMin=${lngMin}&lngMax=${lngMax}`;
    const resp = await fetch(url);
    const dados = await resp.json();

    if (dados.erro) throw new Error(dados.erro);

    state.dados = dados;

    limparLayersAnteriores();
    plotarMarcadores();
    abrirPainel();
    renderStats();
    renderOportunidades();
    renderListaClientes();
    renderListaProspects();
    renderListaRepresentantes();

  } catch (err) {
    alert('Erro ao carregar dados: ' + err.message);
  } finally {
    mostrarLoading(false);
  }
}

function mostrarLoading(show) {
  document.getElementById('loading').style.display = show ? 'flex' : 'none';
}

// ============================================================
// PLOTAR MARCADORES
// ============================================================
function plotarMarcadores() {
  const { clientes, prospects, representantes } = state.dados;

  // Cluster geral para clientes e prospects
  const clusterClientes = L.markerClusterGroup({ disableClusteringAtZoom: 12 });
  const clusterProspects = L.markerClusterGroup({ disableClusteringAtZoom: 12 });

  // ── Clientes ──
  clientes.forEach(c => {
    const ativo = c.ativo == 1;
    const color = ativo ? '#22c55e' : '#ef4444';
    const marker = L.circleMarker([c.lat, c.lng], {
      radius: 7,
      fillColor: color,
      color: color,
      weight: 1.5,
      fillOpacity: 0.85,
      className: 'marker-cliente'
    });
    marker.bindPopup(popupCliente(c));
    marker._dadosCliente = c;
    clusterClientes.addLayer(marker);
  });

  // ── Prospects ──
  prospects.forEach(p => {
    const icon = L.divIcon({
      html: svgEstrela('#3b82f6'),
      className: '',
      iconSize: [20, 20],
      iconAnchor: [10, 10]
    });
    const marker = L.marker([p.lat, p.lng], { icon });
    marker.bindPopup(popupProspect(p));
    marker._dadosProspect = p;
    clusterProspects.addLayer(marker);
  });

  // ── Representantes ──
  const layerReps = L.layerGroup();
  representantes.forEach(rep => {
    const cor = rep.cor || '#F59E0B';
    const icon = L.divIcon({
      html: svgBoneco(cor),
      className: '',
      iconSize: [32, 32],
      iconAnchor: [16, 32]
    });
    const marker = L.marker([rep.lat, rep.lng], { icon, zIndexOffset: 1000 });
    marker.bindPopup(popupRepresentante(rep));
    marker._dadosRep = rep;
    marker.on('click', () => ativarModoRep(rep, marker));
    layerReps.addLayer(marker);
  });

  clusterClientes.addTo(state.map);
  clusterProspects.addTo(state.map);
  layerReps.addTo(state.map);

  state.layers.clientes = clusterClientes;
  state.layers.prospects = clusterProspects;
  state.layers.representantes = layerReps;
}

function limparLayersAnteriores() {
  ['clientes', 'prospects', 'representantes', 'raioCircle', 'rota'].forEach(key => {
    if (state.layers[key]) {
      state.map.removeLayer(state.layers[key]);
      state.layers[key] = null;
    }
  });
  state.layers.highlight.forEach(l => state.map.removeLayer(l));
  state.layers.highlight = [];
  state.repAtivo = null;
}

// ============================================================
// POPUPS
// ============================================================
function popupCliente(c) {
  const badge = c.ativo == 1
    ? '<span class="popup-badge ativo">Ativo</span>'
    : '<span class="popup-badge inativo">Inativo</span>';
  return `
    <div class="popup-card">
      <div class="popup-header">${badge}<strong>${c.fantasia || c.nome_completo}</strong></div>
      <div class="popup-row"><span>Cód.</span><span>${c.cd_empresa}</span></div>
      <div class="popup-row"><span>CNPJ/CPF</span><span>${c.cnpj_cpf}</span></div>
      <div class="popup-row"><span>Fone</span><span>${c.fone}</span></div>
      <div class="popup-row"><span>Contato</span><span>${c.contato}</span></div>
      <div class="popup-row"><span>Município</span><span>${c.municipio}/${c.uf}</span></div>
      <div class="popup-row"><span>Representante</span><span>${nomeRep(c.cd_representant)}</span></div>
    </div>`;
}

function popupProspect(p) {
  return `
    <div class="popup-card">
      <div class="popup-header"><span class="popup-badge prospect">Prospect</span><strong>${p.nome}</strong></div>
      <div class="popup-row"><span>CNPJ</span><span>${p.cnpj}</span></div>
      <div class="popup-row"><span>Telefone 1</span><span>${p.telefone1}</span></div>
      <div class="popup-row"><span>Telefone 2</span><span>${p.telefone2}</span></div>
      <div class="popup-row"><span>Município</span><span>${p.municipio_uf || p.municipio + '/' + p.uf}</span></div>
      <div class="popup-row"><span>CNAE</span><span>${p.cnae_desc}</span></div>
    </div>`;
}

function popupRepresentante(rep) {
  return `
    <div class="popup-card">
      <div class="popup-header"><span class="popup-badge rep">Representante</span><strong>${rep.fantasia}</strong></div>
      <div class="popup-row"><span>Nome</span><span>${rep.nome_completo}</span></div>
      <div class="popup-row"><span>Município</span><span>${rep.municipio}/${rep.uf}</span></div>
      <div class="popup-row"><span>Divisão</span><span>${rep.divisao}</span></div>
      <div class="popup-row" style="margin-top:8px"><span colspan="2" style="color:#94a3b8;font-size:11px">Clique no ícone para ver raio de atuação</span></div>
    </div>`;
}

function nomeRep(cdRep) {
  if (!state.dados || !state.dados.representantes) return cdRep || '—';
  const rep = state.dados.representantes.find(r => r.cd_representant == cdRep);
  return rep ? rep.fantasia : (cdRep || '—');
}

// ============================================================
// PAINEL LATERAL
// ============================================================
function abrirPainel() {
  const painel = document.getElementById('painel');
  painel.classList.add('aberto');
  document.getElementById('painel-titulo').textContent = state.regiaoNome;
}

function novaBusca() {
  document.getElementById('painel').classList.remove('aberto');
  document.getElementById('card-busca').style.display = 'flex';
  document.getElementById('input-regiao').value = '';
  limparLayersAnteriores();
  fecharDrawer();
  state.dados = null;
}

// ── Stats ──
function renderStats() {
  const { clientes, prospects, representantes } = state.dados;
  const ativos = clientes.filter(c => c.ativo == 1).length;
  const inativos = clientes.filter(c => c.ativo == 0).length;

  document.getElementById('stat-ativos').textContent = ativos;
  document.getElementById('stat-inativos').textContent = inativos;
  document.getElementById('stat-prospects').textContent = prospects.length;
  document.getElementById('stat-reps').textContent = representantes.length;
}

// ── Oportunidades ──
function renderOportunidades() {
  const { clientes, prospects, representantes } = state.dados;
  const inativos = clientes.filter(c => c.ativo == 0);

  // Prospects sem representante a < 200km
  let prospectsSemCob = 0;
  prospects.forEach(p => {
    const temCob = representantes.some(r => haversine(p.lat, p.lng, r.lat, r.lng) <= RAIO_PADRAO_KM);
    if (!temCob) prospectsSemCob++;
  });

  // Rep com mais inativos
  const contInativosPorRep = {};
  inativos.forEach(c => {
    const k = c.cd_representant;
    contInativosPorRep[k] = (contInativosPorRep[k] || 0) + 1;
  });
  let repMaisInativos = { nome: '—', qtd: 0 };
  Object.entries(contInativosPorRep).forEach(([cd, qtd]) => {
    if (qtd > repMaisInativos.qtd) {
      repMaisInativos = { nome: nomeRep(cd), qtd };
    }
  });

  // Município com mais prospects sem cobertura
  const contMunic = {};
  prospects.forEach(p => {
    const temCob = representantes.some(r => haversine(p.lat, p.lng, r.lat, r.lng) <= RAIO_PADRAO_KM);
    if (!temCob) {
      const m = p.municipio_uf || p.municipio || 'Desconhecido';
      contMunic[m] = (contMunic[m] || 0) + 1;
    }
  });
  let municTop = '—';
  let municTopQtd = 0;
  Object.entries(contMunic).forEach(([m, q]) => {
    if (q > municTopQtd) { municTop = m; municTopQtd = q; }
  });

  const el = document.getElementById('oportunidades');
  el.innerHTML = `
    <div class="op-item">
      <span class="op-icon" style="color:#ef4444">↻</span>
      <span><strong>${inativos.length}</strong> clientes inativos — potencial de reativação</span>
    </div>
    <div class="op-item">
      <span class="op-icon" style="color:#3b82f6">◎</span>
      <span><strong>${prospectsSemCob}</strong> prospects sem representante a menos de ${RAIO_PADRAO_KM} km</span>
    </div>
    <div class="op-item">
      <span class="op-icon" style="color:#f59e0b">⚠</span>
      <span>Rep com mais inativos: <strong>${repMaisInativos.nome}</strong> (${repMaisInativos.qtd})</span>
    </div>
    <div class="op-item">
      <span class="op-icon" style="color:#a78bfa">📍</span>
      <span>Município com mais prospects sem cobertura: <strong>${municTop}</strong></span>
    </div>`;
}

// ── Listas das abas ──
function renderListaClientes() {
  if (!state.dados) return;
  const filtro = document.getElementById('filtro-clientes').value.toLowerCase();
  const lista = document.getElementById('lista-clientes');
  const items = state.dados.clientes.filter(c =>
    !filtro ||
    (c.fantasia || '').toLowerCase().includes(filtro) ||
    (c.municipio || '').toLowerCase().includes(filtro) ||
    (c.cnpj_cpf || '').toLowerCase().includes(filtro)
  );

  if (!items.length) {
    lista.innerHTML = '<div class="lista-vazia">Nenhum cliente encontrado</div>';
    return;
  }

  lista.innerHTML = items.map(c => {
    const ativo = c.ativo == 1;
    return `
      <div class="lista-item" onclick="focarMarcador(${c.lat}, ${c.lng})">
        <div class="lista-item-nome">${c.fantasia || c.nome_completo}</div>
        <div class="lista-item-sub">
          <span class="badge-mini ${ativo ? 'ativo' : 'inativo'}">${ativo ? 'Ativo' : 'Inativo'}</span>
          ${c.municipio}/${c.uf}
        </div>
        <div class="lista-item-rep">${nomeRep(c.cd_representant)}</div>
      </div>`;
  }).join('');
}

function renderListaProspects() {
  if (!state.dados) return;
  const filtro = document.getElementById('filtro-prospects').value.toLowerCase();
  const lista = document.getElementById('lista-prospects');
  const items = state.dados.prospects.filter(p =>
    !filtro ||
    (p.nome || '').toLowerCase().includes(filtro) ||
    (p.municipio || '').toLowerCase().includes(filtro) ||
    (p.cnae_desc || '').toLowerCase().includes(filtro)
  );

  if (!items.length) {
    lista.innerHTML = '<div class="lista-vazia">Nenhum prospect encontrado</div>';
    return;
  }

  lista.innerHTML = items.map(p => `
    <div class="lista-item" onclick="focarMarcador(${p.lat}, ${p.lng})">
      <div class="lista-item-nome">${p.nome}</div>
      <div class="lista-item-sub">${p.municipio_uf || p.municipio + '/' + p.uf}</div>
      <div class="lista-item-rep">${p.cnae_desc || p.cnae || '—'}</div>
      <div class="lista-item-rep" style="color:#94a3b8">${p.telefone1}</div>
    </div>`).join('');
}

function renderListaRepresentantes() {
  if (!state.dados) return;
  const filtro = document.getElementById('filtro-representantes').value.toLowerCase();
  const lista = document.getElementById('lista-representantes');
  const { clientes } = state.dados;

  const items = state.dados.representantes.filter(r =>
    !filtro ||
    (r.fantasia || '').toLowerCase().includes(filtro) ||
    (r.municipio || '').toLowerCase().includes(filtro) ||
    (r.divisao || '').toLowerCase().includes(filtro)
  );

  if (!items.length) {
    lista.innerHTML = '<div class="lista-vazia">Nenhum representante encontrado</div>';
    return;
  }

  lista.innerHTML = items.map(rep => {
    const qtdAtivos = clientes.filter(c => c.cd_representant == rep.cd_representant && c.ativo == 1).length;
    return `
      <div class="lista-item" onclick="focarMarcador(${rep.lat}, ${rep.lng})">
        <div class="lista-item-nome" style="color:${rep.cor || '#F59E0B'}">${rep.fantasia}</div>
        <div class="lista-item-sub">${rep.municipio}/${rep.uf}</div>
        <div class="lista-item-rep">${rep.divisao}</div>
        <div class="lista-item-rep"><span style="color:#22c55e">●</span> ${qtdAtivos} clientes ativos</div>
      </div>`;
  }).join('');
}

function focarMarcador(lat, lng) {
  state.map.setView([lat, lng], 14, { animate: true });
}

// ============================================================
// MODO REPRESENTANTE (raio + drawer)
// ============================================================
function ativarModoRep(rep, marker) {
  // Limpar modo anterior
  limparModoRep();
  state.repAtivo = rep;

  const cor = rep.cor || '#F59E0B';

  // Círculo de raio
  const circle = L.circle([rep.lat, rep.lng], {
    radius: RAIO_PADRAO_KM * 1000,
    color: cor,
    fillColor: cor,
    fillOpacity: 0.08,
    weight: 2,
    dashArray: '6 4'
  }).addTo(state.map);
  state.layers.raioCircle = circle;

  // Classificar clientes e prospects no raio
  const { clientes, prospects } = state.dados;
  const clientesNoRaio = clientes.filter(c =>
    haversine(c.lat, c.lng, rep.lat, rep.lng) <= RAIO_PADRAO_KM
  );
  const prospNoRaio = prospects.filter(p =>
    haversine(p.lat, p.lng, rep.lat, rep.lng) <= RAIO_PADRAO_KM
  );

  // Highlight markers (borda branca)
  clientesNoRaio.forEach(c => {
    const hl = L.circleMarker([c.lat, c.lng], {
      radius: 9,
      fillColor: c.ativo == 1 ? '#22c55e' : '#ef4444',
      color: '#ffffff',
      weight: 2.5,
      fillOpacity: 0.9
    }).addTo(state.map);
    hl.bindPopup(popupCliente(c));
    state.layers.highlight.push(hl);
  });

  prospNoRaio.forEach(p => {
    const hl = L.marker([p.lat, p.lng], {
      icon: L.divIcon({
        html: svgEstrela('#60a5fa', true),
        className: '',
        iconSize: [22, 22],
        iconAnchor: [11, 11]
      })
    }).addTo(state.map);
    hl.bindPopup(popupProspect(p));
    state.layers.highlight.push(hl);
  });

  // Atualizar drawer
  abrirDrawer(rep, clientesNoRaio, prospNoRaio);
}

function limparModoRep() {
  if (state.layers.raioCircle) {
    state.map.removeLayer(state.layers.raioCircle);
    state.layers.raioCircle = null;
  }
  if (state.layers.rota) {
    state.map.removeLayer(state.layers.rota);
    state.layers.rota = null;
  }
  state.layers.highlight.forEach(l => state.map.removeLayer(l));
  state.layers.highlight = [];
}

function abrirDrawer(rep, clientesNoRaio, prospNoRaio) {
  const cor = rep.cor || '#F59E0B';
  const ativosNoRaio = clientesNoRaio.filter(c => c.ativo == 1);
  const inativosNoRaio = clientesNoRaio.filter(c => c.ativo == 0);

  document.getElementById('drawer-avatar').style.borderColor = cor;
  document.getElementById('drawer-nome').textContent = rep.fantasia;
  document.getElementById('drawer-divisao').textContent = rep.divisao;

  document.getElementById('drawer-ativos').textContent = ativosNoRaio.length;
  document.getElementById('drawer-inativos').textContent = inativosNoRaio.length;
  document.getElementById('drawer-prosp-raio').textContent = prospNoRaio.length;

  // Guarda para rota/CSV
  state._ativosNoRaio = ativosNoRaio;
  state._inativosNoRaio = inativosNoRaio;
  state._prospNoRaio = prospNoRaio;

  document.getElementById('drawer').classList.add('aberto');
}

function fecharDrawer() {
  document.getElementById('drawer').classList.remove('aberto');
  limparModoRep();
  state.repAtivo = null;
}

// ============================================================
// ROTA + EXPORTAR CSV
// ============================================================
function rotaECsv() {
  const rep = state.repAtivo;
  if (!rep) return;

  const ativos = state._ativosNoRaio || [];
  const inativos = state._inativosNoRaio || [];
  const prosp = state._prospNoRaio || [];

  // Ordenar por distância crescente
  const todos = [
    ...ativos.map(c => ({ ...c, _tipo: 'Ativo', _dist: haversine(c.lat, c.lng, rep.lat, rep.lng) })),
    ...inativos.map(c => ({ ...c, _tipo: 'Inativo', _dist: haversine(c.lat, c.lng, rep.lat, rep.lng) })),
    ...prosp.map(p => ({ ...p, _tipo: 'Prospect', _dist: haversine(p.lat, p.lng, rep.lat, rep.lng) }))
  ].sort((a, b) => a._dist - b._dist);

  // Rota no mapa
  if (state.layers.rota) state.map.removeLayer(state.layers.rota);
  const pontos = [[rep.lat, rep.lng], ...todos.map(t => [t.lat, t.lng])];
  state.layers.rota = L.polyline(pontos, {
    color: rep.cor || '#F59E0B',
    weight: 2.5,
    opacity: 0.7,
    dashArray: '8 4'
  }).addTo(state.map);

  // CSV
  const linhas = [['Nome', 'CNPJ_CPF', 'Telefone', 'Contato', 'Municipio', 'UF', 'Status', 'Distancia_km']];
  todos.forEach(t => {
    if (t._tipo === 'Prospect') {
      linhas.push([t.nome, t.cnpj, t.telefone1, '', t.municipio, t.uf, 'Prospect', t._dist.toFixed(1)]);
    } else {
      linhas.push([t.fantasia || t.nome_completo, t.cnpj_cpf, t.fone, t.contato, t.municipio, t.uf, t._tipo, t._dist.toFixed(1)]);
    }
  });

  const csv = linhas.map(l => l.map(v => `"${(v || '').toString().replace(/"/g, '""')}"`).join(',')).join('\n');
  downloadCSV(csv, `rota_${rep.fantasia.replace(/\s+/g, '_')}.csv`);
}

function downloadCSV(conteudo, nome) {
  const blob = new Blob(['\uFEFF' + conteudo], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  a.click();
  URL.revokeObjectURL(url);
}

// ============================================================
// ÍCONES SVG
// ============================================================
function svgEstrela(cor, borda = false) {
  const stroke = borda ? 'stroke="white" stroke-width="1.5"' : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20">
    <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" fill="${cor}" ${stroke}/>
  </svg>`;
}

function svgBoneco(cor) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 40" width="32" height="40">
    <circle cx="16" cy="9" r="7" fill="${cor}"/>
    <path d="M4 32 Q4 20 16 20 Q28 20 28 32 Z" fill="${cor}"/>
    <circle cx="16" cy="9" r="7" fill="${cor}" opacity="0.3"/>
  </svg>`;
}

// ============================================================
// UTILITÁRIOS
// ============================================================

// Distância Haversine em km
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
