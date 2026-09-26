<div align="center">

# 🧠 memory-lancedb-cip · 🦞OpenClaw Plugin

> Upstream: the MIT-licensed original project by win4r (CortexReach) — this package is an independent CIP build.

**Asistente de Memoria IA para Agentes [OpenClaw](https://github.com/openclaw/openclaw)**

*Dale a tu agente de IA un cerebro que realmente recuerda — entre sesiones, entre agentes, a lo largo del tiempo.*

Un plugin de memoria para OpenClaw respaldado por LanceDB que almacena preferencias, decisiones y contexto de proyectos, y los recupera automáticamente en sesiones futuras.

[![OpenClaw Plugin](https://img.shields.io/badge/OpenClaw-Plugin-blue)](https://github.com/openclaw/openclaw)
[![npm version](https://img.shields.io/npm/v/@psxxo/lancedb-cip)](https://www.npmjs.com/package/@psxxo/lancedb-cip)
[![LanceDB](https://img.shields.io/badge/LanceDB-Vectorstore-orange)](https://lancedb.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

[English](README.md) | [简体中文](README_CN.md) | [繁體中文](README_TW.md) | [日本語](README_JA.md) | [한국어](README_KO.md) | [Français](README_FR.md) | [Español](README_ES.md) | [Deutsch](README_DE.md) | [Italiano](README_IT.md) | [Русский](README_RU.md) | [Português (Brasil)](README_PT-BR.md)

</div>

---

## ¿Por qué memory-lancedb-cip?

La mayoría de los agentes de IA tienen amnesia. Olvidan todo en el momento en que inicias un nuevo chat.

**memory-lancedb-cip** es un plugin de memoria a largo plazo de nivel productivo para OpenClaw que convierte a tu agente en un **Asistente de Memoria IA** — captura automáticamente lo que importa, deja que el ruido se desvanezca naturalmente y recupera el recuerdo correcto en el momento adecuado. Sin etiquetado manual, sin complicaciones de configuración.

### Tu Asistente de Memoria IA en acción

**Sin memoria — cada sesión comienza desde cero:**

> **Tú:** "Usa tabulaciones para la indentación, siempre agrega manejo de errores."
> *(siguiente sesión)*
> **Tú:** "¡Ya te lo dije — tabulaciones, no espacios!" 😤
> *(siguiente sesión)*
> **Tú:** "...en serio, tabulaciones. Y manejo de errores. Otra vez."

**Con memory-lancedb-cip — tu agente aprende y recuerda:**

> **Tú:** "Usa tabulaciones para la indentación, siempre agrega manejo de errores."
> *(siguiente sesión — el agente recupera automáticamente tus preferencias)*
> **Agente:** *(aplica silenciosamente tabulaciones + manejo de errores)* ✅
> **Tú:** "¿Por qué elegimos PostgreSQL en lugar de MongoDB el mes pasado?"
> **Agente:** "Basándome en nuestra discusión del 12 de febrero, las razones principales fueron..." ✅

Esa es la diferencia que hace un **Asistente de Memoria IA** — aprende tu estilo, recuerda decisiones pasadas y entrega respuestas personalizadas sin que tengas que repetirte.

### ¿Qué más puede hacer?

| | Lo que obtienes |
|---|---|
| **Auto-Capture** | Tu agente aprende de cada conversación — sin necesidad de `memory_store` manual |
| **Smart Extraction** | Clasificación de 10 categorías impulsada por LLM: `profile`, `preferences`, `entities`, `events`, `cases`, `patterns`, `decision`, `fact`, `reflection`, `other` |
| **Olvido Inteligente** | Modelo de decaimiento Weibull — los recuerdos importantes permanecen, el ruido se desvanece naturalmente |
| **Recuperación Híbrida** | Búsqueda vectorial + BM25 de texto completo, fusionada con reranking por cross-encoder |
| **Inyección de Contexto** | Los recuerdos relevantes aparecen automáticamente antes de cada respuesta |
| **Aislamiento Multi-Scope** | Límites de memoria por agente, por usuario, por proyecto |
| **Cualquier Proveedor** | OpenAI, Jina, Gemini, Ollama, o cualquier API compatible con OpenAI |
| **Kit Completo de Herramientas** | CLI, respaldo, migración, actualización, exportar/importar — listo para producción |

---

## Inicio Rápido

> **Requisito de CPU:** Tu CPU debe soportar instrucciones **AVX/AVX2** (Intel Sandy Bridge 2011+ / AMD Bulldozer 2011+). El motor vectorial nativo de LanceDB las requiere — en CPUs no compatibles el plugin fallará con `SIGILL` (Instrucción ilegal). Verifica con: `grep -o 'avx[^ ]*' /proc/cpuinfo | head -1` (sin salida = no soportado). Ver #419.

### Instalación Manual

**Mediante la CLI de OpenClaw (recomendado):**
```bash
openclaw plugins install clawhub:@psxxo/lancedb-cip
```

**O mediante npm:**
```bash
npm i @psxxo/lancedb-cip
```
> Si usas npm, también necesitarás agregar el directorio de instalación del plugin como una ruta **absoluta** en `plugins.load.paths` en tu `openclaw.json`. Este es el problema de configuración más común.

Agrega a tu `openclaw.json`:

```json
{
  "plugins": {
    "slots": { "memory": "memory-lancedb-cip" },
    "entries": {
      "memory-lancedb-cip": {
        "enabled": true,
        "config": {
          "embedding": {
            "provider": "openai-compatible",
            "apiKey": "${OPENAI_API_KEY}",
            "model": "text-embedding-3-small"
          },
          "autoCapture": true,
          "autoRecall": true,
          "smartExtraction": true,
          "extractMinMessages": 2,
          "extractMaxChars": 8000,
          "sessionMemory": { "enabled": false }
        }
      }
    }
  }
}
```

**¿Por qué estos valores predeterminados?**
- `autoCapture` + `smartExtraction` → tu agente aprende de cada conversación automáticamente
- `autoRecall` → los recuerdos relevantes se inyectan antes de cada respuesta
- `extractMinMessages: 2` → la extracción se activa en chats normales de dos turnos
- `sessionMemory.enabled: false` → evita contaminar la recuperación con resúmenes de sesión desde el primer día

Valida y reinicia:

```bash
openclaw config validate
openclaw gateway restart
openclaw logs --follow --plain | grep "memory-lancedb-cip"
```

Deberías ver:
- `memory-lancedb-cip: smart extraction enabled`
- `memory-lancedb-cip@...: plugin registered`

¡Listo! Tu agente ahora tiene memoria a largo plazo.

<details>
<summary><strong>Más rutas de instalación (usuarios existentes, actualizaciones)</strong></summary>

**¿Ya usas OpenClaw?**

1. Agrega el plugin con una entrada **absoluta** en `plugins.load.paths`
2. Vincula el slot de memoria: `plugins.slots.memory = "memory-lancedb-cip"`
3. Verifica: `openclaw plugins info memory-lancedb-cip && openclaw memory-cip stats`

**¿Actualizando desde una versión anterior a v1.1.0?**

```bash
# 1) Respaldo
openclaw memory-cip export --scope global --output memories-backup.json
# 2) Ejecución de prueba
openclaw memory-cip upgrade --dry-run
# 3) Ejecutar actualización
openclaw memory-cip upgrade
# 4) Verificar
openclaw memory-cip stats
```

Consulta `CHANGELOG-v1.1.0.md` para los cambios de comportamiento y la justificación de la actualización.

</details>

<details>
<summary><strong>Importación rápida para Bot de Telegram (clic para expandir)</strong></summary>

Si usas la integración de Telegram de OpenClaw, la forma más fácil es enviar un comando de importación directamente al Bot principal en lugar de editar la configuración manualmente.

Envía este mensaje (en inglés, ya que es un prompt para el bot):

```text
Help me connect this memory plugin with the most user-friendly configuration: https://github.com/psxxo/memory-lancedb-cip

Requirements:
1. Set it as the only active memory plugin
2. Use Jina for embedding, and set embedding.taskQuery=retrieval.query and embedding.taskPassage=retrieval.passage
3. Use Jina for reranker
4. Use gpt-4o-mini for the smart-extraction LLM
5. Enable autoCapture, autoRecall, smartExtraction
6. extractMinMessages=2
7. sessionMemory.enabled=false
8. captureAssistant=false
9. retrieval mode=hybrid, vectorWeight=0.7, bm25Weight=0.3
10. rerank=cross-encoder, candidatePoolSize=12, minScore=0.6, hardMinScore=0.62
11. Generate the final openclaw.json config directly, not just an explanation
```

</details>

---

## Tutorial en Video

> Recorrido completo: instalación, configuración y funcionamiento interno de la recuperación híbrida.

[![YouTube Video](https://img.shields.io/badge/YouTube-Watch%20Now-red?style=for-the-badge&logo=youtube)](https://youtu.be/MtukF1C8epQ)
**https://youtu.be/MtukF1C8epQ**

[![Bilibili Video](https://img.shields.io/badge/Bilibili-Watch%20Now-00A1D6?style=for-the-badge&logo=bilibili&logoColor=white)](https://www.bilibili.com/video/BV1zUf2BGEgn/)
**https://www.bilibili.com/video/BV1zUf2BGEgn/**

---

## Arquitectura

```
┌─────────────────────────────────────────────────────────┐
│                   index.ts (Entry Point)                │
│  Plugin Registration · Config Parsing · Lifecycle Hooks │
└────────┬──────────┬──────────┬──────────┬───────────────┘
         │          │          │          │
    ┌────▼───┐ ┌────▼───┐ ┌───▼────┐ ┌──▼──────────┐
    │ store  │ │embedder│ │retriever│ │   scopes    │
    │ .ts    │ │ .ts    │ │ .ts    │ │    .ts      │
    └────────┘ └────────┘ └────────┘ └─────────────┘
         │                     │
    ┌────▼───┐           ┌─────▼──────────┐
    │migrate │           │noise-filter.ts │
    │ .ts    │           │adaptive-       │
    └────────┘           │retrieval.ts    │
                         └────────────────┘
    ┌─────────────┐   ┌──────────┐
    │  tools.ts   │   │  cli.ts  │
    │ (Agent API) │   │ (CLI)    │
    └─────────────┘   └──────────┘
```

> Para un análisis detallado de la arquitectura completa, consulta [docs/memory_architecture_analysis.md](docs/memory_architecture_analysis.md).

<details>
<summary><strong>Referencia de Archivos (clic para expandir)</strong></summary>

| Archivo | Propósito |
| --- | --- |
| `index.ts` | Punto de entrada del plugin. Se registra con la API de Plugins de OpenClaw, analiza la configuración, monta hooks de ciclo de vida |
| `openclaw.plugin.json` | Metadatos del plugin + declaración completa de configuración con JSON Schema |
| `cli.ts` | Comandos CLI: `memory-cip list/search/stats/delete/delete-bulk/export/import/reembed/upgrade/migrate` |
| `src/store.ts` | Capa de almacenamiento LanceDB. Creación de tablas / Indexación FTS / Búsqueda vectorial / Búsqueda BM25 / CRUD |
| `src/embedder.ts` | Abstracción de embeddings. Compatible con cualquier proveedor de API compatible con OpenAI |
| `src/retriever.ts` | Motor de recuperación híbrida. Vector + BM25 → Fusión Híbrida → Rerank → Decaimiento de Ciclo de Vida → Filtro |
| `src/scopes.ts` | Control de acceso multi-scope |
| `src/tools.ts` | Definiciones de herramientas del agente: `memory_recall`, `memory_store`, `memory_forget`, `memory_update` + herramientas de gestión |
| `src/noise-filter.ts` | Filtra rechazos del agente, meta-preguntas, saludos y contenido de baja calidad |
| `src/adaptive-retrieval.ts` | Determina si una consulta necesita recuperación de memoria |
| `src/migrate.ts` | Migración desde `memory-lancedb` integrado a Pro |
| `src/smart-extractor.ts` | Extracción de 10 categorías impulsada por LLM con almacenamiento en capas L0/L1/L2 y deduplicación en dos etapas |
| `src/decay-engine.ts` | Modelo de decaimiento exponencial estirado de Weibull |
| `src/tier-manager.ts` | Promoción/degradación en tres niveles: Peripheral ↔ Working ↔ Core |

</details>

> `memory_search` / `memory_get` se registran como alias de compatibilidad solo mientras esos nombres sigan libres, de modo que nunca entran en conflicto con las herramientas de memoria que ya ofrece el motor de memoria integrado.

---

## Características Principales

### Recuperación Híbrida

```
Query → embedQuery() ─┐
                       ├─→ Hybrid Fusion → Rerank → Lifecycle Decay Boost → Length Norm → Filter
Query → BM25 FTS ─────┘
```

- **Búsqueda Vectorial** — similitud semántica mediante LanceDB ANN (distancia coseno)
- **Búsqueda de Texto Completo BM25** — coincidencia exacta de palabras clave mediante índice FTS de LanceDB
- **Fusión Híbrida** — puntuación vectorial como base, los resultados de BM25 reciben un impulso ponderado (no es RRF estándar — ajustado para calidad de recuperación en el mundo real)
- **Pesos Configurables** — `vectorWeight`, `bm25Weight`, `minScore`

### Reranking con Cross-Encoder

- Adaptadores integrados para **Jina**, **SiliconFlow**, **Voyage AI** y **Pinecone**
- Compatible con cualquier endpoint compatible con Jina (por ejemplo, Hugging Face TEI, DashScope)
- Puntuación híbrida: 60% cross-encoder + 40% puntuación fusionada original
- Degradación elegante: recurre a similitud coseno en caso de fallo de la API

### Pipeline de Puntuación Multi-Etapa

| Etapa | Efecto |
| --- | --- |
| **Fusión Híbrida** | Combina recuperación semántica y de coincidencia exacta |
| **Rerank con Cross-Encoder** | Promueve resultados semánticamente precisos |
| **Impulso por Decaimiento de Ciclo de Vida** | Frescura Weibull + frecuencia de acceso + importancia × confianza |
| **Normalización de Longitud** | Evita que entradas largas dominen (ancla: 500 caracteres) |
| **Puntuación Mínima Estricta** | Elimina resultados irrelevantes (predeterminado: 0.35) |
| **Diversidad MMR** | Similitud coseno > 0.85 → degradado |

### Extracción Inteligente de Memoria (v1.1.0)

- **Extracción de 10 Categorías con LLM**: `profile`, `preferences`, `entities`, `events`, `cases`, `patterns`, `decision`, `fact`, `reflection`, `other` — un único vocabulario; el nombre canónico es lo que se almacena en la columna `category`. Los alias en singular (`preference`, `entity`, `event`, `case`, `pattern`) se aceptan en la entrada, y los nombres desconocidos se rechazan. Para importaciones JSON, el operador puede establecer una política explícita para nombres desconocidos (`--unknown reject|other|<canonical>`, predeterminado `reject`) y mapear nombres de entrada arbitrarios a categorías canónicas (`--category-map`).
- **Almacenamiento en Capas L0/L1/L2**: L0 (índice de una oración) → L1 (resumen estructurado) → L2 (narrativa completa)
- **Deduplicación en Dos Etapas**: pre-filtro de similitud vectorial (≥0.7) → decisión semántica por LLM (CREATE/MERGE/SKIP)
- **Fusión por Categoría**: `profile` siempre se fusiona; `preferences` / `entities` / `patterns` / `fact` / `reflection` se fusionan cuando se detectan duplicados; `events` / `cases` / `decision` son solo de adición (nunca se fusionan)

### Gestión del Ciclo de Vida de la Memoria (v1.1.0)

- **Motor de Decaimiento Weibull**: puntuación compuesta = recencia + frecuencia + valor intrínseco
- **Promoción en Tres Niveles**: `Peripheral ↔ Working ↔ Core` con umbrales configurables
- **Refuerzo por Acceso**: los recuerdos frecuentemente recuperados decaen más lentamente (estilo repetición espaciada)
- **Vida Media Modulada por Importancia**: los recuerdos importantes decaen más lentamente

### Aislamiento Multi-Scope

- Scopes integrados: `global`, `agent:<id>`, `custom:<name>`, `project:<id>`, `user:<id>`
- Control de acceso a nivel de agente mediante `scopes.agentAccess`
- Predeterminado: cada agente accede a `global` + su propio scope `agent:<id>`

### Auto-Capture y Auto-Recall

- **Auto-Capture** (`agent_end`): extrae preferencia/hecho/decisión/entidad de las conversaciones, deduplica, almacena hasta 3 por turno
- **Auto-Recall** (`before_agent_start`): inyecta contexto `<relevant-memories>` (hasta 3 entradas)

### Filtrado de Ruido y Recuperación Adaptativa

- Filtra contenido de baja calidad: rechazos del agente, meta-preguntas, saludos
- Omite la recuperación para saludos, comandos slash, confirmaciones simples, emojis
- Fuerza la recuperación para palabras clave de memoria ("recuerda", "anteriormente", "la última vez")
- Umbrales adaptados a CJK (chino: 6 caracteres vs inglés: 15 caracteres)

---

<details>
<summary><strong>Comparación con <code>memory-lancedb</code> integrado (clic para expandir)</strong></summary>

| Característica | `memory-lancedb` integrado | **memory-lancedb-cip** |
| --- | :---: | :---: |
| Búsqueda vectorial | Sí | Sí |
| Búsqueda de texto completo BM25 | - | Sí |
| Fusión híbrida (Vector + BM25) | - | Sí |
| Rerank con cross-encoder (multi-proveedor) | - | Sí |
| Impulso por recencia y decaimiento temporal | - | Sí |
| Normalización de longitud | - | Sí |
| Diversidad MMR | - | Sí |
| Aislamiento multi-scope | - | Sí |
| Filtrado de ruido | - | Sí |
| Recuperación adaptativa | - | Sí |
| CLI de gestión | - | Sí |
| Memoria de sesión | - | Sí |
| Embeddings adaptados a la tarea | - | Sí |
| **Extracción Inteligente con LLM (10 categorías)** | - | Sí (v1.1.0) |
| **Decaimiento Weibull + Promoción por Niveles** | - | Sí (v1.1.0) |
| Cualquier embedding compatible con OpenAI | Limitado | Sí |

</details>

---

## Configuración

<details>
<summary><strong>Ejemplo de Configuración Completa</strong></summary>

```json
{
  "embedding": {
    "apiKey": "${JINA_API_KEY}",
    "model": "jina-embeddings-v5-text-small",
    "baseURL": "https://api.jina.ai/v1",
    "dimensions": 1024,
    "taskQuery": "retrieval.query",
    "taskPassage": "retrieval.passage",
    "normalized": true
  },
  "dbPath": "~/.openclaw/memory/lancedb-cip",
  "autoCapture": true,
  "autoRecall": true,
  "retrieval": {
    "mode": "hybrid",
    "vectorWeight": 0.7,
    "bm25Weight": 0.3,
    "minScore": 0.3,
    "rerank": "cross-encoder",
    "rerankApiKey": "${JINA_API_KEY}",
    "rerankModel": "jina-reranker-v3",
    "rerankEndpoint": "https://api.jina.ai/v1/rerank",
    "rerankProvider": "jina",
    "candidatePoolSize": 20,
    "recencyHalfLifeDays": 14,
    "recencyWeight": 0.1,
    "filterNoise": true,
    "lengthNormAnchor": 500,
    "hardMinScore": 0.35,
    "timeDecayHalfLifeDays": 60,
    "reinforcementFactor": 0.5,
    "maxHalfLifeMultiplier": 3
  },
  "enableManagementTools": false,
  "scopes": {
    "default": "global",
    "definitions": {
      "global": { "description": "Shared knowledge" },
      "agent:discord-bot": { "description": "Discord bot private" }
    },
    "agentAccess": {
      "discord-bot": ["global", "agent:discord-bot"]
    }
  },
  "sessionMemory": {
    "enabled": false,
    "messageCount": 15
  },
  "smartExtraction": true,
  "llm": {
    "apiKey": "${OPENAI_API_KEY}",
    "model": "gpt-4o-mini",
    "baseURL": "https://api.openai.com/v1"
  },
  "extractMinMessages": 2,
  "extractMaxChars": 8000
}
```

</details>

<details>
<summary><strong>Proveedores de Embedding</strong></summary>

Funciona con **cualquier API de embedding compatible con OpenAI**:

| Proveedor | Modelo | URL Base | Dimensiones |
| --- | --- | --- | --- |
| **Jina** (recomendado) | `jina-embeddings-v5-text-small` | `https://api.jina.ai/v1` | 1024 |
| **OpenAI** | `text-embedding-3-small` | `https://api.openai.com/v1` | 1536 |
| **Voyage** | `voyage-4-lite` / `voyage-4` | `https://api.voyageai.com/v1` | 1024 / 1024 |
| **Google Gemini** | `gemini-embedding-001` | `https://generativelanguage.googleapis.com/v1beta/openai/` | 3072 |
| **Ollama** (local) | `nomic-embed-text` | `http://localhost:11434/v1` | específico del proveedor |

</details>

<details>
<summary><strong>Proveedores de Rerank</strong></summary>

El reranking con cross-encoder admite múltiples proveedores mediante `rerankProvider`:

| Proveedor | `rerankProvider` | Modelo de Ejemplo |
| --- | --- | --- |
| **Jina** (predeterminado) | `jina` | `jina-reranker-v3` |
| **SiliconFlow** (nivel gratuito disponible) | `siliconflow` | `BAAI/bge-reranker-v2-m3` |
| **Voyage AI** | `voyage` | `rerank-2.5` |
| **Pinecone** | `pinecone` | `bge-reranker-v2-m3` |

Cualquier endpoint de rerank compatible con Jina también funciona — configura `rerankProvider: "jina"` y apunta `rerankEndpoint` a tu servicio (por ejemplo, Hugging Face TEI, DashScope `qwen3-rerank`).

</details>

<details>
<summary><strong>Smart Extraction (LLM) — v1.1.0</strong></summary>

Cuando `smartExtraction` está habilitado (predeterminado: `true`), el plugin utiliza un LLM para extraer y clasificar recuerdos de forma inteligente en lugar de disparadores basados en regex.

| Campo | Tipo | Predeterminado | Descripción |
|-------|------|----------------|-------------|
| `smartExtraction` | boolean | `true` | Habilitar/deshabilitar la extracción de 10 categorías impulsada por LLM |
| `llm.auth` | string | `api-key` | `api-key` usa `llm.apiKey` / `embedding.apiKey`; `oauth` usa un archivo de token OAuth con alcance de plugin por defecto |
| `llm.apiKey` | string | *(recurre a `embedding.apiKey`)* | Clave API para el proveedor de LLM |
| `llm.model` | string | `openai/gpt-oss-120b` | Nombre del modelo LLM |
| `llm.baseURL` | string | *(recurre a `embedding.baseURL`)* | Endpoint de la API del LLM |
| `llm.oauthProvider` | string | `openai-codex` | ID del proveedor OAuth usado cuando `llm.auth` es `oauth` |
| `llm.oauthPath` | string | `~/.openclaw/.memory-lancedb-cip/oauth.json` | Archivo de token OAuth usado cuando `llm.auth` es `oauth` |
| `llm.timeoutMs` | number | `30000` | Tiempo de espera de solicitud LLM en milisegundos |
| `extractMinMessages` | number | `2` | Mensajes mínimos antes de que se active la extracción |
| `extractMaxChars` | number | `8000` | Máximo de caracteres enviados al LLM |


Configuración de `llm` con OAuth (usa la caché de inicio de sesión existente de Codex / ChatGPT para llamadas al LLM):
```json
{
  "llm": {
    "auth": "oauth",
    "oauthProvider": "openai-codex",
    "model": "gpt-5.4",
    "oauthPath": "${HOME}/.openclaw/.memory-lancedb-cip/oauth.json",
    "timeoutMs": 30000
  }
}
```

Notas para `llm.auth: "oauth"`:

- `llm.oauthProvider` es actualmente `openai-codex`.
- Los tokens OAuth se almacenan por defecto en `~/.openclaw/.memory-lancedb-cip/oauth.json`.
- Puedes configurar `llm.oauthPath` si deseas almacenar ese archivo en otra ubicación.
- `auth login` guarda una copia de la configuración anterior de `llm` con api-key junto al archivo OAuth, y `auth logout` restaura esa copia cuando está disponible.
- Cambiar de `api-key` a `oauth` no transfiere automáticamente `llm.baseURL`. Configúralo manualmente en modo OAuth solo cuando intencionalmente quieras un backend personalizado compatible con ChatGPT/Codex.

</details>

<details>
<summary><strong>Configuración del Ciclo de Vida (Decaimiento + Nivel)</strong></summary>

| Campo | Predeterminado | Descripción |
|-------|----------------|-------------|
| `decay.recencyHalfLifeDays` | `30` | Vida media base para el decaimiento de recencia Weibull |
| `decay.frequencyWeight` | `0.3` | Peso de la frecuencia de acceso en la puntuación compuesta |
| `decay.intrinsicWeight` | `0.3` | Peso de `importancia × confianza` |
| `decay.betaCore` | `0.8` | Beta de Weibull para memorias `core` |
| `decay.betaWorking` | `1.0` | Beta de Weibull para memorias `working` |
| `decay.betaPeripheral` | `1.3` | Beta de Weibull para memorias `peripheral` |
| `tier.coreAccessThreshold` | `10` | Mínimo de recuperaciones antes de promover a `core` |
| `tier.peripheralAgeDays` | `60` | Umbral de antigüedad para degradar memorias inactivas |

</details>

<details>
<summary><strong>Refuerzo por Acceso</strong></summary>

Los recuerdos frecuentemente recuperados decaen más lentamente (estilo repetición espaciada).

Claves de configuración (bajo `retrieval`):
- `reinforcementFactor` (0-2, predeterminado: `0.5`) — establece `0` para deshabilitar
- `maxHalfLifeMultiplier` (1-10, predeterminado: `3`) — límite máximo de vida media efectiva

</details>

---

## Comandos CLI

```bash
openclaw memory-cip list [--scope global] [--category fact] [--limit 20] [--json]
openclaw memory-cip search "query" [--scope global] [--limit 10] [--json]
openclaw memory-cip stats [--scope global] [--json]
openclaw memory-cip auth login [--provider openai-codex] [--model gpt-5.4] [--oauth-path /abs/path/oauth.json]
openclaw memory-cip auth status
openclaw memory-cip auth logout
openclaw memory-cip delete <id>
openclaw memory-cip delete-bulk --scope global [--before 2025-01-01] [--dry-run]
openclaw memory-cip export [--scope global] [--output memories.json]
openclaw memory-cip import memories.json [--scope global] [--dry-run]
openclaw memory-cip reembed --source-db /path/to/old-db [--batch-size 32] [--skip-existing]
openclaw memory-cip upgrade [--dry-run] [--batch-size 10] [--no-llm] [--limit N] [--scope SCOPE]
openclaw memory-cip migrate check|run|verify [--source /path]
```

`--category` acepta las 10 categorías canónicas (`profile` / `preferences` / `entities` / `events` / `cases` / `patterns` / `decision` / `fact` / `reflection` / `other`) más los alias de entrada (`preference` / `entity` / `event` / `case` / `pattern`). Los valores desconocidos se rechazan con un error de validación en lugar de recurrir silenciosamente a `patterns` u `other`.

**Política de categorías de `import` (nada se coacciona nunca en silencio).** Para cada fila, la categoría se resuelve en este orden:

1. **nombre canónico exacto** — se almacena tal cual;
2. **alias integrado** (`preference` → `preferences`, `entity` → `entities`, `event` → `events`, `case` → `cases`, `pattern` → `patterns`);
3. **`--category-map <file>`** — un objeto JSON que asigna nombres de entrada arbitrarios a categorías canónicas, p. ej. `{"lemmas":"cases"}`;
4. **`--unknown <policy>`** — decide los nombres restantes no reconocidos:
   - `reject` (**predeterminado**): omite la fila e imprime una advertencia por fila que enumera los nombres canónicos;
   - `other`: almacena la fila como `other`, solo porque el operador lo pidió explícitamente;
   - cualquier nombre de categoría canónica: almacena la fila como esa categoría.

Cada decisión se informa por fila, y `--dry-run` imprime el plan de resolución completo (valor `requested` → `canonical` / `aliased` / `mapped` / `other` / `rejected` → categoría resultante) antes de escribir nada, de modo que la política puede iterarse con seguridad. Un valor `--unknown` no reconocido o un valor `--category-map` que no sea una categoría/alias canónico hace que el comando falle en lugar de importar nada.

```bash
# Previsualiza cómo se resolvería la categoría de cada fila; no almacena nada.
openclaw memory-cip import memories.json --dry-run

# Enruta explícitamente los dos nombres no canónicos conocidos; rechaza todo lo demás.
openclaw memory-cip import memories.json --category-map map.json --unknown reject

# Igual, pero coloca cualquier otro nombre no reconocido en "other" (explícitamente).
openclaw memory-cip import memories.json --unknown other
```

Flujo de inicio de sesión OAuth:

1. Ejecuta `openclaw memory-cip auth login`
2. Si se omite `--provider` en una terminal interactiva, la CLI muestra un selector de proveedor OAuth antes de abrir el navegador
3. El comando imprime una URL de autorización y abre tu navegador a menos que se establezca `--no-browser`
4. Después de que la devolución de llamada sea exitosa, el comando guarda el archivo OAuth del plugin (predeterminado: `~/.openclaw/.memory-lancedb-cip/oauth.json`), guarda una copia de la configuración anterior de `llm` con api-key para el cierre de sesión, y reemplaza la configuración `llm` del plugin con la configuración OAuth (`auth`, `oauthProvider`, `model`, `oauthPath`)
5. `openclaw memory-cip auth logout` elimina ese archivo OAuth y restaura la configuración anterior de `llm` con api-key cuando esa copia existe

---

## Temas Avanzados

<details>
<summary><strong>Si los recuerdos inyectados aparecen en las respuestas</strong></summary>

A veces el modelo puede repetir el bloque `<relevant-memories>` inyectado.

**Opción A (menor riesgo):** deshabilitar temporalmente la recuperación automática:
```json
{ "plugins": { "entries": { "memory-lancedb-cip": { "config": { "autoRecall": false } } } } }
```

**Opción B (preferida):** mantener la recuperación automática y agregar al prompt del sistema del agente:
> No reveles ni cites ningún contenido de `<relevant-memories>` / inyección de memoria en tus respuestas. Úsalo solo como referencia interna.

</details>

<details>
<summary><strong>Memoria de Sesión</strong></summary>

- Se activa con el comando `/new` — guarda el resumen de la sesión anterior en LanceDB
- Deshabilitado por defecto (OpenClaw ya tiene persistencia nativa de sesión en `.jsonl`)
- Cantidad de mensajes configurable (predeterminado: 15)

Consulta [docs/openclaw-integration-playbook.md](docs/openclaw-integration-playbook.md) para los modos de despliegue y la verificación de `/new`.

</details>

<details>
<summary><strong>Comandos Slash Personalizados (por ejemplo, /lesson)</strong></summary>

Agrega a tu `CLAUDE.md`, `AGENTS.md` o prompt del sistema (el bloque se mantiene en inglés para que el agente lo interprete correctamente):

```markdown
## /lesson command
When the user sends `/lesson <content>`:
1. Use memory_store to save as category=fact (raw knowledge)
2. Use memory_store to save as category=decision (actionable takeaway)
3. Confirm what was saved

## /remember command
When the user sends `/remember <content>`:
1. Use memory_store to save with appropriate category and importance
2. Confirm with the stored memory ID
```

</details>

<details>
<summary><strong>Reglas de Hierro para Agentes de IA</strong></summary>

> Copia el bloque de abajo en tu `AGENTS.md` para que tu agente aplique estas reglas automáticamente. Se mantiene en inglés porque es instrucción directa para el modelo.

```markdown
## Rule 1 — Two-memory lesson storage
Every pitfall/lesson learned → IMMEDIATELY store TWO memories (both are canonical categories in the single 10-category vocabulary):
- Technical layer: Pitfall: [symptom]. Cause: [root cause]. Fix: [solution]. Prevention: [how to avoid]
  (category: fact, importance >= 0.8)
- Principle layer: Decision principle ([tag]): [behavioral rule]. Trigger: [when]. Action: [what to do]
  (category: decision, importance >= 0.85)

## Rule 2 — LanceDB hygiene
Entries must be short and atomic (< 500 chars). No raw conversation summaries or duplicates.

## Rule 3 — Recall before retry
On ANY tool failure, ALWAYS memory_recall with relevant keywords BEFORE retrying.

## Rule 4 — Confirm target codebase
Confirm you are editing memory-lancedb-cip vs built-in memory-lancedb before changes.

## Rule 5 — Clear jiti cache after plugin code changes
After modifying .ts files under plugins/, MUST run rm -rf /tmp/jiti/ BEFORE openclaw gateway restart.
```

</details>

<details>
<summary><strong>Esquema de la Base de Datos</strong></summary>

Tabla LanceDB `memories`:

| Campo | Tipo | Descripción |
| --- | --- | --- |
| `id` | string (UUID) | Clave primaria |
| `text` | string | Texto del recuerdo (indexado con FTS) |
| `vector` | float[] | Vector de embedding |
| `category` | string | Categoría de almacenamiento (canónica): `profile` / `preferences` / `entities` / `events` / `cases` / `patterns` / `decision` / `fact` / `reflection` / `other` |
| `scope` | string | Identificador de scope (por ejemplo, `global`, `agent:main`) |
| `importance` | float | Puntuación de importancia 0-1 |
| `timestamp` | int64 | Marca de tiempo de creación (ms) |
| `metadata` | string (JSON) | Metadatos extendidos |

Claves comunes de `metadata` en v1.1.0: `l0_abstract`, `l1_overview`, `l2_content`, `memory_category`, `tier`, `access_count`, `confidence`, `last_accessed_at`

> **Nota sobre categorías:** Existe un **único vocabulario de 10 categorías** — `profile`, `preferences`, `entities`, `events`, `cases`, `patterns`, `decision`, `fact`, `reflection`, `other`. El nombre canónico *es* lo que almacena el campo de nivel superior `category` (mapeo de identidad; no hay una doble capa separada de semántica/almacenamiento). En la entrada se aceptan los alias en singular `preference` → `preferences`, `entity` → `entities`, `event` → `events`, `case` → `cases` y `pattern` → `patterns`; `decision`, `fact`, `reflection` y `other` son canónicos por sí mismos. Los nombres de categoría desconocidos se **rechazan** con un error de validación — nunca se asignan silenciosamente a `patterns` u `other`.
>
> Comportamiento de fusión / línea temporal / durabilidad: `profile` siempre se fusiona (sin línea temporal, duradero); `preferences`, `entities` y `fact` se fusionan y se versionan temporalmente mediante `fact_key` (duraderos); `patterns` y `reflection` se fusionan sin línea temporal (duraderos); `events` es solo de adición (sin línea temporal, duradero, con juicio de ficción); `cases` y `decision` son solo de adición (sin línea temporal, duraderos); `other` ni se fusiona ni usa línea temporal y no es duradero.

</details>

<details>
<summary><strong>Solución de Problemas</strong></summary>

### "Cannot mix BigInt and other types" (LanceDB / Apache Arrow)

En LanceDB 0.26+, algunas columnas numéricas pueden devolverse como `BigInt`. Actualiza a **memory-lancedb-cip >= 1.0.14** — este plugin ahora convierte los valores usando `Number(...)` antes de realizar operaciones aritméticas.

</details>

---

## Documentación

| Documento | Descripción |
| --- | --- |
| [Manual de Integración con OpenClaw](docs/openclaw-integration-playbook.md) | Modos de despliegue, verificación, matriz de regresión |
| [Análisis de la Arquitectura de Memoria](docs/memory_architecture_analysis.md) | Análisis detallado de la arquitectura completa |
| [CHANGELOG v1.1.0](docs/CHANGELOG-v1.1.0.md) | Cambios de comportamiento en v1.1.0 y justificación de la actualización |
| [Fragmentación de Contexto Largo](docs/long-context-chunking.md) | Estrategia de fragmentación para documentos largos |

---

## Beta: Smart Memory v1.1.0

> Estado: Beta — disponible mediante `npm i @psxxo/lancedb-cip`. Los usuarios estables en `latest` no se ven afectados.

| Característica | Descripción |
|----------------|-------------|
| **Smart Extraction** | Extracción de 10 categorías impulsada por LLM con metadatos L0/L1/L2. Recurre a regex cuando está deshabilitado. |
| **Puntuación de Ciclo de Vida** | Decaimiento Weibull integrado en la recuperación — los recuerdos de alta frecuencia y alta importancia se clasifican mejor. |
| **Gestión de Niveles** | Sistema de tres niveles (Core → Working → Peripheral) con promoción/degradación automática. |

Comentarios: [GitHub Issues](https://github.com/psxxo/memory-lancedb-cip/issues) · Revertir: `npm i @psxxo/lancedb-cip@latest`

---

## Dependencias

| Paquete | Propósito |
| --- | --- |
| `@lancedb/lancedb` ≥0.26.2 | Base de datos vectorial (ANN + FTS) |
| `openai` ≥6.21.0 | Cliente de API de Embedding compatible con OpenAI |
| `@sinclair/typebox` 0.34.48 | Definiciones de tipos con JSON Schema |

---

## Contributors

<p>
<a href="https://github.com/win4r"><img src="https://avatars.githubusercontent.com/u/42172631?v=4" width="48" height="48" alt="@win4r" /></a>
<a href="https://github.com/kctony"><img src="https://avatars.githubusercontent.com/u/1731141?v=4" width="48" height="48" alt="@kctony" /></a>
<a href="https://github.com/Akatsuki-Ryu"><img src="https://avatars.githubusercontent.com/u/8062209?v=4" width="48" height="48" alt="@Akatsuki-Ryu" /></a>
<a href="https://github.com/JasonSuz"><img src="https://avatars.githubusercontent.com/u/612256?v=4" width="48" height="48" alt="@JasonSuz" /></a>
<a href="https://github.com/Minidoracat"><img src="https://avatars.githubusercontent.com/u/11269639?v=4" width="48" height="48" alt="@Minidoracat" /></a>
<a href="https://github.com/furedericca-lab"><img src="https://avatars.githubusercontent.com/u/263020793?v=4" width="48" height="48" alt="@furedericca-lab" /></a>
<a href="https://github.com/joe2643"><img src="https://avatars.githubusercontent.com/u/19421931?v=4" width="48" height="48" alt="@joe2643" /></a>
<a href="https://github.com/AliceLJY"><img src="https://avatars.githubusercontent.com/u/136287420?v=4" width="48" height="48" alt="@AliceLJY" /></a>
<a href="https://github.com/chenjiyong"><img src="https://avatars.githubusercontent.com/u/8199522?v=4" width="48" height="48" alt="@chenjiyong" /></a>
</p>

Full list: [Contributors](https://github.com/psxxo/memory-lancedb-cip/graphs/contributors)

## Star History

<a href="https://star-history.dera.page/#psxxo/memory-lancedb-cip&Date">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://star-history.dera.page/svg?repos=psxxo/memory-lancedb-cip&type=Date&theme=dark&transparent=true" />
    <source media="(prefers-color-scheme: light)" srcset="https://star-history.dera.page/svg?repos=psxxo/memory-lancedb-cip&type=Date&transparent=true" />
    <img alt="Star History Chart" src="https://star-history.dera.page/svg?repos=psxxo/memory-lancedb-cip&type=Date&transparent=true" />
  </picture>
</a>

## Licencia

MIT

---

## Mi Código QR de WeChat

<img src="https://github.com/win4r/AISuperDomain/assets/42172631/7568cf78-c8ba-4182-aa96-d524d903f2bc" width="214.8" height="291">
