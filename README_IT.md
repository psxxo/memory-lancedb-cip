<div align="center">

# 🧠 memory-lancedb-cip · 🦞OpenClaw Plugin

> Upstream: the MIT-licensed original project by win4r (CortexReach) — this package is an independent CIP build.

**Assistente Memoria IA per Agenti [OpenClaw](https://github.com/openclaw/openclaw)**

*Dai al tuo agente IA un cervello che ricorda davvero — tra sessioni, tra agenti, nel tempo.*

Un plugin di memoria a lungo termine per OpenClaw basato su LanceDB che memorizza preferenze, decisioni e contesto di progetto, e li richiama automaticamente nelle sessioni future.

[![OpenClaw Plugin](https://img.shields.io/badge/OpenClaw-Plugin-blue)](https://github.com/openclaw/openclaw)
[![npm version](https://img.shields.io/npm/v/@psxxo/lancedb-cip)](https://www.npmjs.com/package/@psxxo/lancedb-cip)
[![LanceDB](https://img.shields.io/badge/LanceDB-Vectorstore-orange)](https://lancedb.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

[English](README.md) | [简体中文](README_CN.md) | [繁體中文](README_TW.md) | [日本語](README_JA.md) | [한국어](README_KO.md) | [Français](README_FR.md) | [Español](README_ES.md) | [Deutsch](README_DE.md) | [Italiano](README_IT.md) | [Русский](README_RU.md) | [Português (Brasil)](README_PT-BR.md)

</div>

---

## Perché memory-lancedb-cip?

La maggior parte degli agenti IA soffre di amnesia. Dimenticano tutto nel momento in cui si avvia una nuova chat.

**memory-lancedb-cip** è un plugin di memoria a lungo termine di livello produttivo per OpenClaw che trasforma il tuo agente in un vero **Assistente Memoria IA** — cattura automaticamente ciò che conta, lascia il rumore dissolversi naturalmente e recupera il ricordo giusto al momento giusto. Nessun tag manuale, nessuna configurazione complicata.

### Il tuo Assistente Memoria IA in azione

**Senza memoria — ogni sessione parte da zero:**

> **Tu:** "Usa i tab per l'indentazione, aggiungi sempre la gestione degli errori."
> *(sessione successiva)*
> **Tu:** "Te l'ho già detto — tab, non spazi!" 😤
> *(sessione successiva)*
> **Tu:** "…sul serio, tab. E gestione degli errori. Di nuovo."

**Con memory-lancedb-cip — il tuo agente impara e ricorda:**

> **Tu:** "Usa i tab per l'indentazione, aggiungi sempre la gestione degli errori."
> *(sessione successiva — l'agente richiama automaticamente le tue preferenze)*
> **Agente:** *(applica silenziosamente tab + gestione errori)* ✅
> **Tu:** "Perché il mese scorso abbiamo scelto PostgreSQL invece di MongoDB?"
> **Agente:** "In base alla nostra discussione del 12 febbraio, i motivi principali erano…" ✅

Questa è la differenza che fa un **Assistente Memoria IA** — impara il tuo stile, ricorda le decisioni passate e fornisce risposte personalizzate senza che tu debba ripeterti.

### Cos'altro può fare?

| | Cosa ottieni |
|---|---|
| **Auto-Capture** | Il tuo agente impara da ogni conversazione — nessun `memory_store` manuale necessario |
| **Estrazione intelligente** | Classificazione LLM in 10 categorie: `profile`, `preferences`, `entities`, `events`, `cases`, `patterns`, `decision`, `fact`, `reflection`, `other` |
| **Oblio intelligente** | Modello di decadimento Weibull — i ricordi importanti restano, il rumore svanisce |
| **Ricerca ibrida** | Ricerca vettoriale + BM25 full-text, fusa con reranking cross-encoder |
| **Iniezione di contesto** | I ricordi rilevanti emergono automaticamente prima di ogni risposta |
| **Isolamento multi-scope** | Confini di memoria per agente, per utente, per progetto |
| **Qualsiasi provider** | OpenAI, Jina, Gemini, Ollama o qualsiasi API compatibile OpenAI |
| **Toolkit completo** | CLI, backup, migrazione, upgrade, esportazione/importazione — pronto per la produzione |

---

## Avvio rapido

> **Requisito CPU:** La tua CPU deve supportare le istruzioni **AVX/AVX2** (Intel Sandy Bridge 2011+ / AMD Bulldozer 2011+). Il motore vettoriale nativo di LanceDB le richiede — su CPU non supportate il plugin andrà in crash con `SIGILL` (Istruzione illegale). Verifica con: `grep -o 'avx[^ ]*' /proc/cpuinfo | head -1` (nessun output = non supportato). Vedi #419.

### Installazione manuale

**Tramite OpenClaw CLI (consigliato):**
```bash
openclaw plugins install clawhub:@psxxo/lancedb-cip
```

**Oppure tramite npm:**
```bash
npm i @psxxo/lancedb-cip
```
> Se usi npm, dovrai anche aggiungere la directory di installazione del plugin come percorso **assoluto** in `plugins.load.paths` nel tuo `openclaw.json`. Questo è il problema di configurazione più comune.

Aggiungi al tuo `openclaw.json`:

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

**Perché questi valori predefiniti?**
- `autoCapture` + `smartExtraction` → il tuo agente impara automaticamente da ogni conversazione
- `autoRecall` → i ricordi rilevanti vengono iniettati prima di ogni risposta
- `extractMinMessages: 2` → l'estrazione si attiva nelle normali chat a due turni
- `sessionMemory.enabled: false` → evita di inquinare la ricerca con riassunti di sessione all'inizio

Valida e riavvia:

```bash
openclaw config validate
openclaw gateway restart
openclaw logs --follow --plain | grep "memory-lancedb-cip"
```

Dovresti vedere:
- `memory-lancedb-cip: smart extraction enabled`
- `memory-lancedb-cip@...: plugin registered`

Fatto! Il tuo agente ora ha una memoria a lungo termine.

<details>
<summary><strong>Ulteriori percorsi di installazione (utenti esistenti, aggiornamenti)</strong></summary>

**Usi già OpenClaw?**

1. Aggiungi il plugin con un percorso **assoluto** in `plugins.load.paths`
2. Associa lo slot di memoria: `plugins.slots.memory = "memory-lancedb-cip"`
3. Verifica: `openclaw plugins info memory-lancedb-cip && openclaw memory-cip stats`

**Aggiornamento da versioni precedenti alla v1.1.0?**

```bash
# 1) Backup
openclaw memory-cip export --scope global --output memories-backup.json
# 2) Dry run
openclaw memory-cip upgrade --dry-run
# 3) Run upgrade
openclaw memory-cip upgrade
# 4) Verify
openclaw memory-cip stats
```

Vedi `CHANGELOG-v1.1.0.md` per le modifiche comportamentali e le motivazioni dell'aggiornamento.

</details>

<details>
<summary><strong>Importazione rapida Telegram Bot (clicca per espandere)</strong></summary>

Se stai usando l'integrazione Telegram di OpenClaw, il modo più semplice è inviare un comando di importazione direttamente al Bot principale invece di modificare manualmente la configurazione.

Invia questo messaggio:

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

## Tutorial video

> Guida completa: installazione, configurazione e funzionamento interno della ricerca ibrida.

[![YouTube Video](https://img.shields.io/badge/YouTube-Watch%20Now-red?style=for-the-badge&logo=youtube)](https://youtu.be/MtukF1C8epQ)
**https://youtu.be/MtukF1C8epQ**

[![Bilibili Video](https://img.shields.io/badge/Bilibili-Watch%20Now-00A1D6?style=for-the-badge&logo=bilibili&logoColor=white)](https://www.bilibili.com/video/BV1zUf2BGEgn/)
**https://www.bilibili.com/video/BV1zUf2BGEgn/**

---

## Architettura

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

> Per un approfondimento sull'architettura completa, consulta [docs/memory_architecture_analysis.md](docs/memory_architecture_analysis.md).

<details>
<summary><strong>Riferimento file (clicca per espandere)</strong></summary>

| File | Scopo |
| --- | --- |
| `index.ts` | Punto di ingresso del plugin. Si registra con l'API Plugin di OpenClaw, analizza la configurazione, monta gli hook del ciclo di vita |
| `openclaw.plugin.json` | Metadati del plugin + dichiarazione completa della configurazione JSON Schema |
| `cli.ts` | Comandi CLI: `memory-cip list/search/stats/delete/delete-bulk/export/import/reembed/upgrade/migrate` |
| `src/store.ts` | Layer di storage LanceDB. Creazione tabelle / indicizzazione FTS / ricerca vettoriale / ricerca BM25 / CRUD |
| `src/embedder.ts` | Astrazione embedding. Compatibile con qualsiasi provider API compatibile OpenAI |
| `src/retriever.ts` | Motore di ricerca ibrido. Vettoriale + BM25 → Fusione ibrida → Rerank → Decadimento ciclo di vita → Filtro |
| `src/scopes.ts` | Controllo accessi multi-scope |
| `src/tools.ts` | Definizioni degli strumenti agente: `memory_recall`, `memory_store`, `memory_forget`, `memory_update` + strumenti di gestione |
| `src/noise-filter.ts` | Filtra rifiuti dell'agente, meta-domande, saluti e contenuti di bassa qualità |
| `src/adaptive-retrieval.ts` | Determina se una query necessita di ricerca nella memoria |
| `src/migrate.ts` | Migrazione dal `memory-lancedb` integrato a Pro |
| `src/smart-extractor.ts` | Estrazione LLM in 10 categorie con archiviazione a strati L0/L1/L2 e deduplicazione in due fasi |
| `src/decay-engine.ts` | Modello di decadimento esponenziale esteso Weibull |
| `src/tier-manager.ts` | Promozione/retrocessione a tre livelli: Peripheral ↔ Working ↔ Core |

</details>

> `memory_search` / `memory_get` vengono registrati come alias di compatibilità solo finché quei nomi restano liberi, così non entrano mai in conflitto con gli strumenti di memoria già forniti dal motore di memoria integrato.

---

## Funzionalità principali

### Ricerca ibrida

```
Query → embedQuery() ─┐
                       ├─→ Hybrid Fusion → Rerank → Lifecycle Decay Boost → Length Norm → Filter
Query → BM25 FTS ─────┘
```

- **Ricerca vettoriale** — similarità semantica tramite LanceDB ANN (distanza del coseno)
- **Ricerca full-text BM25** — corrispondenza esatta delle parole chiave tramite indice FTS di LanceDB
- **Fusione ibrida** — punteggio vettoriale come base, i risultati BM25 ricevono un boost ponderato (non RRF standard — ottimizzato per la qualità di richiamo nel mondo reale)
- **Pesi configurabili** — `vectorWeight`, `bm25Weight`, `minScore`

### Reranking Cross-Encoder

- Adattatori integrati per **Jina**, **SiliconFlow**, **Voyage AI** e **Pinecone**
- Compatibile con qualsiasi endpoint compatibile Jina (ad es. Hugging Face TEI, DashScope)
- Punteggio ibrido: 60% cross-encoder + 40% punteggio fuso originale
- Degradazione elegante: fallback sulla similarità del coseno in caso di errore API

### Pipeline di punteggio multi-fase

| Fase | Effetto |
| --- | --- |
| **Fusione ibrida** | Combina richiamo semantico e corrispondenza esatta |
| **Rerank Cross-Encoder** | Promuove risultati semanticamente precisi |
| **Boost decadimento ciclo di vita** | Freschezza Weibull + frequenza di accesso + importance × confidence |
| **Normalizzazione lunghezza** | Impedisce alle voci lunghe di dominare (ancora: 500 caratteri) |
| **Punteggio minimo rigido** | Rimuove risultati irrilevanti (predefinito: 0.35) |
| **Diversità MMR** | Similarità coseno > 0.85 → retrocesso |

### Estrazione intelligente della memoria (v1.1.0)

- **Estrazione LLM in 10 categorie**: `profile`, `preferences`, `entities`, `events`, `cases`, `patterns`, `decision`, `fact`, `reflection`, `other` — un unico vocabolario; il nome canonico è ciò che viene memorizzato nella colonna `category`. Gli alias al singolare (`preference`, `entity`, `event`, `case`, `pattern`) sono accettati in input, e i nomi sconosciuti vengono rifiutati. Per le importazioni JSON, l'operatore può impostare una policy esplicita per i nomi sconosciuti (`--unknown reject|other|<canonical>`, predefinito `reject`) e mappare nomi di input arbitrari su categorie canoniche (`--category-map`).
- **Archiviazione a strati L0/L1/L2**: L0 (indice in una frase) → L1 (riepilogo strutturato) → L2 (narrazione completa)
- **Deduplicazione in due fasi**: pre-filtro similarità vettoriale (≥0.7) → decisione semantica LLM (CREATE/MERGE/SKIP)
- **Fusione consapevole delle categorie**: `profile` viene sempre fuso; `preferences` / `entities` / `patterns` / `fact` / `reflection` vengono fusi quando vengono rilevati duplicati; `events` / `cases` / `decision` sono solo in aggiunta (mai fusi)

### Gestione del ciclo di vita della memoria (v1.1.0)

- **Motore di decadimento Weibull**: punteggio composito = freschezza + frequenza + valore intrinseco
- **Promozione a tre livelli**: `Peripheral ↔ Working ↔ Core` con soglie configurabili
- **Rinforzo per accesso**: i ricordi richiamati frequentemente decadono più lentamente (stile ripetizione spaziata)
- **Emivita modulata dall'importanza**: i ricordi importanti decadono più lentamente

### Isolamento multi-scope

- Scope integrati: `global`, `agent:<id>`, `custom:<name>`, `project:<id>`, `user:<id>`
- Controllo accessi a livello agente tramite `scopes.agentAccess`
- Predefinito: ogni agente accede a `global` + il proprio scope `agent:<id>`

### Auto-Capture e Auto-Recall

- **Auto-Capture** (`agent_end`): estrae preferenze/fatti/decisioni/entità dalle conversazioni, deduplica, memorizza fino a 3 per turno
- **Auto-Recall** (`before_agent_start`): inietta il contesto `<relevant-memories>` (fino a 3 voci)

### Filtraggio del rumore e ricerca adattiva

- Filtra contenuti di bassa qualità: rifiuti dell'agente, meta-domande, saluti
- Salta la ricerca per: saluti, comandi slash, conferme semplici, emoji
- Forza la ricerca per parole chiave della memoria ("ricorda", "precedentemente", "l'ultima volta")
- Soglie CJK (cinese: 6 caratteri vs inglese: 15 caratteri)

---

<details>
<summary><strong>Confronto con <code>memory-lancedb</code> integrato (clicca per espandere)</strong></summary>

| Funzionalità | `memory-lancedb` integrato | **memory-lancedb-cip** |
| --- | :---: | :---: |
| Ricerca vettoriale | Sì | Sì |
| Ricerca full-text BM25 | - | Sì |
| Fusione ibrida (Vettoriale + BM25) | - | Sì |
| Rerank cross-encoder (multi-provider) | - | Sì |
| Boost di freschezza e decadimento temporale | - | Sì |
| Normalizzazione lunghezza | - | Sì |
| Diversità MMR | - | Sì |
| Isolamento multi-scope | - | Sì |
| Filtraggio del rumore | - | Sì |
| Ricerca adattiva | - | Sì |
| CLI di gestione | - | Sì |
| Memoria di sessione | - | Sì |
| Embedding task-aware | - | Sì |
| **Estrazione intelligente LLM (10 categorie)** | - | Sì (v1.1.0) |
| **Decadimento Weibull + promozione livelli** | - | Sì (v1.1.0) |
| Qualsiasi embedding compatibile OpenAI | Limitato | Sì |

</details>

---

## Configurazione

<details>
<summary><strong>Esempio di configurazione completa</strong></summary>

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
<summary><strong>Provider di embedding</strong></summary>

Funziona con **qualsiasi API di embedding compatibile OpenAI**:

| Provider | Modello | Base URL | Dimensioni |
| --- | --- | --- | --- |
| **Jina** (consigliato) | `jina-embeddings-v5-text-small` | `https://api.jina.ai/v1` | 1024 |
| **OpenAI** | `text-embedding-3-small` | `https://api.openai.com/v1` | 1536 |
| **Voyage** | `voyage-4-lite` / `voyage-4` | `https://api.voyageai.com/v1` | 1024 / 1024 |
| **Google Gemini** | `gemini-embedding-001` | `https://generativelanguage.googleapis.com/v1beta/openai/` | 3072 |
| **Ollama** (locale) | `nomic-embed-text` | `http://localhost:11434/v1` | specifico del provider |

</details>

<details>
<summary><strong>Provider di rerank</strong></summary>

Il reranking cross-encoder supporta più provider tramite `rerankProvider`:

| Provider | `rerankProvider` | Modello di esempio |
| --- | --- | --- |
| **Jina** (predefinito) | `jina` | `jina-reranker-v3` |
| **SiliconFlow** (piano gratuito disponibile) | `siliconflow` | `BAAI/bge-reranker-v2-m3` |
| **Voyage AI** | `voyage` | `rerank-2.5` |
| **Pinecone** | `pinecone` | `bge-reranker-v2-m3` |

Funziona anche qualsiasi endpoint di rerank compatibile Jina — imposta `rerankProvider: "jina"` e punta `rerankEndpoint` al tuo servizio (ad es. Hugging Face TEI, DashScope `qwen3-rerank`).

</details>

<details>
<summary><strong>Estrazione intelligente (LLM) — v1.1.0</strong></summary>

Quando `smartExtraction` è abilitato (predefinito: `true`), il plugin utilizza un LLM per estrarre e classificare intelligentemente i ricordi invece di trigger basati su regex.

| Campo | Tipo | Predefinito | Descrizione |
|-------|------|---------|-------------|
| `smartExtraction` | boolean | `true` | Abilita/disabilita l'estrazione LLM in 10 categorie |
| `llm.auth` | string | `api-key` | `api-key` usa `llm.apiKey` / `embedding.apiKey`; `oauth` usa un file token OAuth con scope plugin per impostazione predefinita |
| `llm.apiKey` | string | *(fallback su `embedding.apiKey`)* | Chiave API per il provider LLM |
| `llm.model` | string | `openai/gpt-oss-120b` | Nome del modello LLM |
| `llm.baseURL` | string | *(fallback su `embedding.baseURL`)* | Endpoint API LLM |
| `llm.oauthProvider` | string | `openai-codex` | ID del provider OAuth usato quando `llm.auth` è `oauth` |
| `llm.oauthPath` | string | `~/.openclaw/.memory-lancedb-cip/oauth.json` | File token OAuth usato quando `llm.auth` è `oauth` |
| `llm.timeoutMs` | number | `30000` | Timeout della richiesta LLM in millisecondi |
| `extractMinMessages` | number | `2` | Messaggi minimi prima che l'estrazione si attivi |
| `extractMaxChars` | number | `8000` | Caratteri massimi inviati al LLM |


Configurazione `llm` OAuth (usa la cache di login esistente di Codex / ChatGPT per le chiamate LLM):
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

Note per `llm.auth: "oauth"`:

- `llm.oauthProvider` è attualmente `openai-codex`.
- I token OAuth sono salvati di default in `~/.openclaw/.memory-lancedb-cip/oauth.json`.
- Puoi impostare `llm.oauthPath` se vuoi salvare quel file altrove.
- `auth login` crea uno snapshot della configurazione `llm` precedente con api-key accanto al file OAuth, e `auth logout` ripristina quello snapshot quando disponibile.
- Il passaggio da `api-key` a `oauth` non trasferisce automaticamente `llm.baseURL`. Impostalo manualmente in modalità OAuth solo quando vuoi intenzionalmente un backend personalizzato compatibile ChatGPT/Codex.

</details>

<details>
<summary><strong>Configurazione ciclo di vita (Decadimento + Livelli)</strong></summary>

| Campo | Predefinito | Descrizione |
|-------|---------|-------------|
| `decay.recencyHalfLifeDays` | `30` | Emivita base per il decadimento di freschezza Weibull |
| `decay.frequencyWeight` | `0.3` | Peso della frequenza di accesso nel punteggio composito |
| `decay.intrinsicWeight` | `0.3` | Peso di `importance × confidence` |
| `decay.betaCore` | `0.8` | Beta Weibull per i ricordi `core` |
| `decay.betaWorking` | `1.0` | Beta Weibull per i ricordi `working` |
| `decay.betaPeripheral` | `1.3` | Beta Weibull per i ricordi `peripheral` |
| `tier.coreAccessThreshold` | `10` | Conteggio minimo richiami prima della promozione a `core` |
| `tier.peripheralAgeDays` | `60` | Soglia di età per retrocedere i ricordi inattivi |

</details>

<details>
<summary><strong>Rinforzo per accesso</strong></summary>

I ricordi richiamati frequentemente decadono più lentamente (stile ripetizione spaziata).

Chiavi di configurazione (sotto `retrieval`):
- `reinforcementFactor` (0-2, predefinito: `0.5`) — imposta `0` per disabilitare
- `maxHalfLifeMultiplier` (1-10, predefinito: `3`) — limite massimo sull'emivita effettiva

</details>

---

## Comandi CLI

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

`--category` accetta le 10 categorie canoniche (`profile` / `preferences` / `entities` / `events` / `cases` / `patterns` / `decision` / `fact` / `reflection` / `other`) più gli alias di input (`preference` / `entity` / `event` / `case` / `pattern`). I valori sconosciuti vengono rifiutati con un errore di validazione invece di ricadere silenziosamente su `patterns` o `other`.

**Policy delle categorie per `import` (nulla viene mai convertito in silenzio).** Per ogni riga, la categoria viene risolta in questo ordine:

1. **nome canonico esatto** — memorizzato così com'è;
2. **alias integrato** (`preference` → `preferences`, `entity` → `entities`, `event` → `events`, `case` → `cases`, `pattern` → `patterns`);
3. **`--category-map <file>`** — un oggetto JSON che mappa nomi di input arbitrari su categorie canoniche, ad es. `{"lemmas":"cases"}`;
4. **`--unknown <policy>`** — decide i nomi rimanenti non riconosciuti:
   - `reject` (**predefinito**): salta la riga e stampa un avviso per riga che elenca i nomi canonici;
   - `other`: memorizza la riga come `other`, solo perché l'operatore l'ha richiesto esplicitamente;
   - qualsiasi nome di categoria canonica: memorizza la riga come quella categoria.

Ogni decisione viene segnalata per riga, e `--dry-run` stampa il piano di risoluzione completo (valore `requested` → `canonical` / `aliased` / `mapped` / `other` / `rejected` → categoria risultante) prima che venga scritto qualcosa, così la policy può essere iterata in sicurezza. Un valore `--unknown` non riconosciuto o un valore `--category-map` che non è una categoria/alias canonico fa fallire il comando invece di importare qualsiasi cosa.

```bash
# Anteprima di come verrebbe risolta la categoria di ogni riga; non memorizza nulla.
openclaw memory-cip import memories.json --dry-run

# Instrada esplicitamente i due nomi non canonici noti, rifiuta tutto il resto.
openclaw memory-cip import memories.json --category-map map.json --unknown reject

# Idem, ma colloca ogni altro nome non riconosciuto in "other" (esplicitamente).
openclaw memory-cip import memories.json --unknown other
```

Flusso di login OAuth:

1. Esegui `openclaw memory-cip auth login`
2. Se `--provider` è omesso in un terminale interattivo, la CLI mostra un selettore di provider OAuth prima di aprire il browser
3. Il comando stampa un URL di autorizzazione e apre il browser, a meno che non sia impostato `--no-browser`
4. Dopo il successo del callback, il comando salva il file OAuth del plugin (predefinito: `~/.openclaw/.memory-lancedb-cip/oauth.json`), crea uno snapshot della configurazione `llm` precedente con api-key per il logout, e sostituisce la configurazione `llm` del plugin con le impostazioni OAuth (`auth`, `oauthProvider`, `model`, `oauthPath`)
5. `openclaw memory-cip auth logout` elimina quel file OAuth e ripristina la configurazione `llm` precedente con api-key quando quello snapshot esiste

---

## Argomenti avanzati

<details>
<summary><strong>Se i ricordi iniettati appaiono nelle risposte</strong></summary>

A volte il modello può ripetere il blocco `<relevant-memories>` iniettato.

**Opzione A (rischio minimo):** disabilita temporaneamente l'auto-recall:
```json
{ "plugins": { "entries": { "memory-lancedb-cip": { "config": { "autoRecall": false } } } } }
```

**Opzione B (preferita):** mantieni il recall, aggiungi al prompt di sistema dell'agente:
> Do not reveal or quote any `<relevant-memories>` / memory-injection content in your replies. Use it for internal reference only.

</details>

<details>
<summary><strong>Memoria di sessione</strong></summary>

- Si attiva con il comando `/new` — salva il riepilogo della sessione precedente in LanceDB
- Disabilitata per impostazione predefinita (OpenClaw ha già la persistenza nativa delle sessioni in `.jsonl`)
- Conteggio messaggi configurabile (predefinito: 15)

Vedi [docs/openclaw-integration-playbook.md](docs/openclaw-integration-playbook.md) per le modalità di distribuzione e la verifica di `/new`.

</details>

<details>
<summary><strong>Comandi slash personalizzati (ad es. /lesson)</strong></summary>

Aggiungi al tuo `CLAUDE.md`, `AGENTS.md` o prompt di sistema:

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
<summary><strong>Regole d'oro per agenti IA</strong></summary>

> Copia il blocco seguente nel tuo `AGENTS.md` in modo che il tuo agente applichi queste regole automaticamente.

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
<summary><strong>Schema del database</strong></summary>

Tabella LanceDB `memories`:

| Campo | Tipo | Descrizione |
| --- | --- | --- |
| `id` | string (UUID) | Chiave primaria |
| `text` | string | Testo del ricordo (indicizzato FTS) |
| `vector` | float[] | Vettore di embedding |
| `category` | string | Categoria di archiviazione (canonica): `profile` / `preferences` / `entities` / `events` / `cases` / `patterns` / `decision` / `fact` / `reflection` / `other` |
| `scope` | string | Identificatore scope (ad es. `global`, `agent:main`) |
| `importance` | float | Punteggio di importanza 0-1 |
| `timestamp` | int64 | Timestamp di creazione (ms) |
| `metadata` | string (JSON) | Metadati estesi |

Chiavi `metadata` comuni nella v1.1.0: `l0_abstract`, `l1_overview`, `l2_content`, `memory_category`, `tier`, `access_count`, `confidence`, `last_accessed_at`

> **Nota sulle categorie:** Esiste un **unico vocabolario di 10 categorie** — `profile`, `preferences`, `entities`, `events`, `cases`, `patterns`, `decision`, `fact`, `reflection`, `other`. Il nome canonico *è* ciò che memorizza il campo di primo livello `category` (mappatura identitaria; non esiste un doppio strato separato semantica/archiviazione). In input sono accettati gli alias al singolare `preference` → `preferences`, `entity` → `entities`, `event` → `events`, `case` → `cases` e `pattern` → `patterns`; `decision`, `fact`, `reflection` e `other` sono essi stessi canonici. I nomi di categoria sconosciuti vengono **rifiutati** con un errore di validazione — non vengono mai mappati silenziosamente su `patterns` o `other`.
>
> Comportamento di fusione / timeline / durabilità: `profile` viene sempre fuso (nessuna timeline, durevole); `preferences`, `entities` e `fact` vengono fusi e versionati temporalmente tramite `fact_key` (durevoli); `patterns` e `reflection` vengono fusi senza timeline (durevoli); `events` è solo in aggiunta (nessuna timeline, durevole, giudicato sulla finzione); `cases` e `decision` sono solo in aggiunta (nessuna timeline, durevoli); `other` non viene né fuso né usa una timeline e non è durevole.

</details>

<details>
<summary><strong>Risoluzione dei problemi</strong></summary>

### "Cannot mix BigInt and other types" (LanceDB / Apache Arrow)

Con LanceDB 0.26+, alcune colonne numeriche potrebbero essere restituite come `BigInt`. Aggiorna a **memory-lancedb-cip >= 1.0.14** — questo plugin ora converte i valori usando `Number(...)` prima delle operazioni aritmetiche.

</details>

---

## Documentazione

| Documento | Descrizione |
| --- | --- |
| [Playbook di integrazione OpenClaw](docs/openclaw-integration-playbook.md) | Modalità di distribuzione, verifica, matrice di regressione |
| [Analisi dell'architettura della memoria](docs/memory_architecture_analysis.md) | Analisi approfondita dell'architettura completa |
| [CHANGELOG v1.1.0](docs/CHANGELOG-v1.1.0.md) | Modifiche comportamentali v1.1.0 e motivazioni per l'upgrade |
| [Chunking contesto lungo](docs/long-context-chunking.md) | Strategia di chunking per documenti lunghi |

---

## Beta: Smart Memory v1.1.0

> Stato: Beta — disponibile tramite `npm i @psxxo/lancedb-cip`. Gli utenti stabili su `latest` non sono interessati.

| Funzionalità | Descrizione |
|---------|-------------|
| **Estrazione intelligente** | Estrazione LLM in 10 categorie con metadati L0/L1/L2. Fallback su regex se disabilitato. |
| **Punteggio ciclo di vita** | Decadimento Weibull integrato nella ricerca — i ricordi frequenti e importanti si posizionano più in alto. |
| **Gestione livelli** | Sistema a tre livelli (Core → Working → Peripheral) con promozione/retrocessione automatica. |

Feedback: [GitHub Issues](https://github.com/psxxo/memory-lancedb-cip/issues) · Ripristina: `npm i @psxxo/lancedb-cip@latest`

---

## Dipendenze

| Pacchetto | Scopo |
| --- | --- |
| `@lancedb/lancedb` ≥0.26.2 | Database vettoriale (ANN + FTS) |
| `openai` ≥6.21.0 | Client API Embedding compatibile OpenAI |
| `@sinclair/typebox` 0.34.48 | Definizioni di tipo JSON Schema |

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

## Licenza

MIT

---

## Il mio QR Code WeChat

<img src="https://github.com/win4r/AISuperDomain/assets/42172631/7568cf78-c8ba-4182-aa96-d524d903f2bc" width="214.8" height="291">
