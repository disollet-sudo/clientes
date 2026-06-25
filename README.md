# 📍 Mapa de Clientes — Guia de Instalação

Sistema gratuito para visualizar clientes ativos/inativos, prospects por CNAE e gerenciar representantes com raio de atuação.

**Stack:** Google Sheets + Apps Script (backend) · Leaflet + OpenStreetMap (mapa) · GitHub Pages (hospedagem)
**Custo:** R$ 0,00

---

## Passo 1 — Preparar a planilha Google Sheets

1. Acesse [sheets.google.com](https://sheets.google.com) e abra sua planilha de clientes.
2. Renomeie a aba principal para **Clientes** (ou crie uma nova com esse nome).
3. A primeira linha deve ter estes cabeçalhos **exatamente nessa ordem**:

| A | B | C | D | E | F | G | H | I |
|---|---|---|---|---|---|---|---|---|
| CNPJ | Nome | Endereço | Município | Status | CNAE | Representante | Lat | Lng |

> As colunas H e I (Lat/Lng) podem ficar vazias — o sistema vai geocodificar automaticamente.

4. Na coluna **Status**, use os valores: `ativo` ou `inativo` (em minúsculas).

---

## Passo 2 — Publicar o Apps Script (backend da API)

1. Na planilha, vá em **Extensões → Apps Script**.
2. Apague todo o código que aparecer.
3. Cole o conteúdo completo do arquivo `api.gs` deste projeto.
4. Clique em **Salvar** (ícone de disquete).
5. No menu lateral, clique em **Executar** a função `inicializarPlanilha` uma vez. Isso cria as abas necessárias.
6. Vá em **Implantar → Nova implantação**.
7. Clique no ícone de engrenagem → **App da Web**.
8. Configure:
   - **Descrição:** Mapa de Clientes
   - **Executar como:** Eu mesmo (minha conta)
   - **Quem tem acesso:** Qualquer pessoa
9. Clique em **Implantar** e copie a **URL da Web** gerada.
   - Ela terá este formato: `https://script.google.com/macros/s/XXXXXXX/exec`

---

## Passo 3 — Configurar o app.js

1. Abra o arquivo `app.js`.
2. Na linha 6, substitua `SUA_URL_DO_APPS_SCRIPT_AQUI` pela URL copiada no passo anterior:

```javascript
const API_URL = "https://script.google.com/macros/s/SEU_ID_AQUI/exec";
```

3. Salve o arquivo.

---

## Passo 4 — Publicar no GitHub Pages

### Se nunca usou GitHub:
1. Crie uma conta gratuita em [github.com](https://github.com).
2. Clique em **New repository**.
3. Nome: `mapa-clientes` · Visibilidade: **Public** (necessário para Pages gratuito).
4. Clique em **Create repository**.

### Subir os arquivos:
1. Na página do repositório, clique em **uploading an existing file**.
2. Arraste os 3 arquivos: `index.html`, `app.js` e este `README.md`.
3. Clique em **Commit changes**.

### Ativar o GitHub Pages:
1. Vá em **Settings → Pages**.
2. Em **Source**, selecione **Deploy from a branch**.
3. Branch: **main** · Pasta: **/ (root)**.
4. Clique em **Save**.
5. Após ~1 minuto, seu mapa estará disponível em:
   `https://SEU_USUARIO.github.io/mapa-clientes`

---

## Passo 5 — Geocodificar os endereços

Na primeira vez que abrir o mapa:
1. Clique no botão **🌐 Geocodificar** no canto superior direito.
2. O sistema converterá os endereços em coordenadas automaticamente via OpenStreetMap.
3. Isso pode demorar de 5 a 30 minutos dependendo da quantidade de registros.
   - O Apps Script tem limite de 6 minutos por execução. Para 33 mil clientes, execute em lotes filtrando por município.
4. As coordenadas são salvas diretamente na planilha nas colunas H e I.

> **Dica:** Para geocodificar em lotes, adicione a coluna G (Representante) vazia nos primeiros mil registros, geocodifique, depois avance para os próximos mil.

---

## Adicionar prospects por CNAE

Os 3 CNAEs alvo já estão configurados no sistema:
- **4711-3/02** — Supermercados
- **4759-8/99** — Artigos para casa
- **4691-5/00** — Atacado diverso

Para popular a aba **Prospects**:

**Opção A — Manual:** Exporte de uma base como Receita Federal, CNPJ.ws ou similar, filtrando pelos CNAEs acima, e cole na aba Prospects com os cabeçalhos: `CNPJ | Nome | Endereço | Município | CNAE | Lat | Lng`.

**Opção B — BrasilAPI (recomendado):**
Use a API gratuita para buscar empresas por município e CNAE:
```
https://brasilapi.com.br/api/cnpj/v1/{cnpj}
```
Ou serviços como [CNPJ.ws](https://cnpj.ws) que permitem busca por CNAE.

---

## Estrutura das abas da planilha

| Aba | Descrição |
|-----|-----------|
| **Clientes** | Sua base atual (33 mil registros) |
| **Representantes** | Criada automaticamente ao cadastrar via sistema |
| **Prospects** | Empresas por CNAE que ainda não são clientes |

---

## Funcionalidades disponíveis

- **Mapa:** Pins agrupados por cluster (aguenta 33 mil registros sem travar)
- **Filtros:** Por município, status, representante, nome/CNPJ
- **Prospects:** Visualização por CNAE no mapa
- **Representantes:** Cadastro, raio de atuação visual, estatísticas de cobertura
- **Cobertura:** Para cada representante: quantos clientes ativos, inativos e prospects estão no raio
- **Exportar:** Baixar lista filtrada em CSV
- **Geocodificar:** Converter endereços em coordenadas via OpenStreetMap (grátis)

---

## Atualizar os dados depois

Basta editar diretamente a planilha Google Sheets. As mudanças ficam disponíveis em tempo real — não precisa fazer nenhum novo deploy.

Para atualizar o código (`api.gs` ou `app.js`):
- Apps Script: cole o novo código e crie uma nova implantação.
- GitHub Pages: faça upload do arquivo atualizado no repositório.

---

## Suporte

Se aparecer erro `CORS` ao carregar dados, certifique-se de que o Apps Script foi implantado com **"Qualquer pessoa"** no campo "Quem tem acesso".

Se a geocodificação parar no meio, aguarde alguns minutos (limite da API do Nominatim) e execute novamente — registros já geocodificados serão ignorados.
