# LLM Council Pro

![LLM Council Pro](/assets/header.png)

**Debate. Verify. Synthesize.**

Instead of asking a single LLM for an answer, convene a council where multiple models deliberate together—each responding independently, reviewing peers' work, revising based on feedback, and synthesizing a comprehensive answer. Mix cloud and local models, verify claims against the web, and watch the reasoning unfold.

[![Python 3.10+](https://img.shields.io/badge/python-3.10+-blue.svg)](https://www.python.org/downloads/)
[![React](https://img.shields.io/badge/React-19-61DAFB.svg)](https://reactjs.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115+-009688.svg)](https://fastapi.tiangolo.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

**What makes LLM Council Pro different:**

- **Watch Models Think** — See every raw response, every ranking, every revision. Understand how different models approach the same question.
- **Member Debates** — Models don't just answer; they critique each other, defend positions, and refine their thinking.
- **Custom Prompts** — Full access to customize how the council deliberates. Tailor every stage prompt to your needs.
- **Dream Councils** — Create themed councils with character personas. Build a panel of philosophers, scientists, innovators, or historical figures.
- **Local + Cloud** — Mix Ollama models with cloud providers. Discover what different models are actually good at.

This is a tool for people who want to understand **how** AI models think—not just get an answer.

---

## The Deliberation Pipeline

```
┌─────────────────────────────────────────────────────────────────┐
│                        YOUR QUESTION                             │
│              (+ optional web search for context)                 │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              STAGE 1: COUNCIL DELIBERATION                       │
│                                                                  │
│   ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐           │
│   │ Claude  │  │  GPT-4  │  │ Gemini  │  │  Llama  │           │
│   └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘           │
│        │            │            │            │                 │
│        ▼            ▼            ▼            ▼                 │
│   Response A   Response B   Response C   Response D             │
│                                                                  │
│   → Watch each model's reasoning approach in real-time          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              STAGE 2: PEER REVIEW                                │
│                                                                  │
│   Each model reviews ALL responses (anonymized as A, B, C, D)   │
│   and ranks them by accuracy, insight, and completeness.        │
│                                                                  │
│   → See how models critique each other's reasoning              │
│   → Anonymous review prevents brand bias                        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              STAGE 3: RESPONSE REVISIONS                         │
│                                                                  │
│   Each council member amends their answer based on              │
│   peer feedback—addressing critiques and incorporating          │
│   insights from other models.                                   │
│                                                                  │
│   → Watch reasoning evolve through debate                       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              STAGE 4: COUNCIL ANALYSIS AND DEBATE                │
│                                                                  │
│   Extracts key insights from the deliberation:                  │
│   • Agreements — Where models converge                          │
│   • Disagreements — Points of contention with positions         │
│   • Unique Insights — Perspectives only one model offered       │
│                                                                  │
│   Models debate the disagreements to explore nuances.           │
│                                                                  │
│   → See where council agrees, disagrees, and why                │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              STAGE 5: CHAIRMAN SYNTHESIS                         │
│                                                                  │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │                    CHAIRMAN MODEL                        │   │
│   │  Reviews all responses + rankings + revisions + debates  │   │
│   │  Synthesizes the council's collective wisdom             │   │
│   └─────────────────────────────────────────────────────────┘   │
│                              │                                   │
│                              ▼                                   │
│                        FINAL ANSWER                              │
└─────────────────────────────────────────────────────────────────┘
```

---

## Key Features

### Character Personas & Dream Councils

Give your council members personality and purpose:

- **Assign character names** — "The Analyst", "The Skeptic", "The Historian", "The Optimist"
- **Create themed councils** — A panel of philosophers for ethics questions, scientists for technical topics
- **Save as presets** — One-click switching between your dream councils
- **Share configurations** — Export and import council setups

### Single-Model Councils

Only have one LLM available? Council Pro supports running the same model in multiple council slots—each with its own persona and custom prompt.

**How it works:**
- Each council slot is tracked independently by position, not model name
- Assign different character names to each slot
- Write custom member prompts that guide the same model toward different perspectives

Run a full 5-stage deliberation with peer review, revisions, and synthesis—all from a single model instructed to think differently in each role.

![Config and Presets](/assets/llmcp-settings.png)

### Fully Customizable Prompts

Every stage prompt is editable:

- **Stage 1** — How models approach your question
- **Stage 2** — How they evaluate and rank peers
- **Stage 3** — How they revise based on feedback
- **Stage 4** — How the models debate
- **Stage 5** — How the Chairman synthesizes the final answer

Fine-tune the deliberation style, evaluation criteria, and synthesis approach. Make the council work the way *you* want.

### Council Analysis

Analyze key insights from council member responses:

- **Truth Check** - Check factual accuracy with web search
- **Council Highlights** - Agreements, disagreements and unique insights
- **Chairman's Ranking** - Based on reasoning, insight and clarity scores

Understand why council members agree or disagree.

![Council Analysis](/assets/llmcp-analysis.png)

### Watch Models Debate

See the full deliberation process:

- **Raw responses** — Each model's unfiltered answer
- **Peer critiques** — What models say about each other's work
- **Revisions** — How thinking changes through debate
- **Rankings** — Which responses models considered best

Understand *why* the final answer is what it is.

### Mix Local & Cloud Models

Build councils from any combination:

| Provider | Type | Models |
|----------|------|--------|
| **Ollama** | Local | Llama, Mistral, Phi, Qwen, Gemma... |
| **OpenRouter** | Cloud | 100+ models via single API |
| **Groq** | Cloud | Ultra-fast Llama inference |
| **OpenAI** | Direct | GPT-4.1, GPT-4o |
| **Anthropic** | Direct | Claude Sonnet, Claude Opus |
| **Google** | Direct | Gemini Pro, Gemini Flash |
| **Mistral** | Direct | Mistral Large, Codestral |
| **DeepSeek** | Direct | DeepSeek V3, R1 |
| **Perplexity** | Direct | Sonar models |
| **Custom** | Any | vLLM, LM Studio, Together AI, Fireworks... |

**Why local models matter:** When you run Ollama models, you see what open-source AI can actually do—its strengths, its gaps, its reasoning style. No rate limits, no usage tracking, no walled garden.

### Web Search Integration

Ground responses in current information:

| Provider | Type | Notes |
|----------|------|-------|
| **DuckDuckGo** | Free | No API key needed |
| **Tavily** | API Key | Purpose-built for LLMs |
| **Brave Search** | API Key | Privacy-focused |

Full article extraction via Jina Reader for deep context.

### Execution Modes

Choose your deliberation depth:

| Mode | Stages | Best For |
|------|--------|----------|
| **Chat Only** | Stage 1 | Quick model comparison |
| **Chat + Ranking** | Stages 1-2 | See peer evaluation |
| **Chat + Revisions** | Stages 1-3 | Watch reasoning evolve |
| **Full Deliberation** | All 5 stages | Complete analysis with optional debate |

### Chat Input Controls

![Chat Input Panel](/assets/llmcp-ci-panel.png)

Quick access to deliberation features from the input panel:

| Button | What It Does |
|--------|--------------|
| **Refresh** | Reload settings if you've changed config in another tab |
| **Web Search** | Pull current web context into responses (DuckDuckGo, Tavily, or Brave) |
| **Presets** | Quick-load a saved council configuration |
| **Truth Check** | Verify factual claims against web sources in Stage 4 |
| **Debate** | Enable model debates on areas of disagreement |
| **Dictation** | Voice input for your question |

### Export Conversations

Save and share your council sessions:

- **Markdown** — Clean, portable documentation
- **DOCX** — Microsoft Word format
- **PDF** — Publication-ready documents

---

## Who Is This For?

### Curious Minds
People who want to understand how AI models think differently—who enjoy seeing the reasoning process, not just the conclusion.

### Developers
Full control over prompts and configuration. Build custom deliberation workflows. Test how different models handle your domain.

### AI Enthusiasts
Compare model capabilities firsthand. Discover what local models can do. Build intuition about AI strengths and weaknesses.

### Content Creators
Get multiple perspectives on complex topics. See where models agree and disagree. Synthesize better final outputs.

---

## Quick Start

```bash
# Clone and install
git clone https://github.com/YOUR_USERNAME/llm-council-pro.git
cd llm-council-pro
uv sync                    # Backend dependencies
cd frontend && npm install # Frontend dependencies

# Run
./start.sh
```

Open **http://localhost:5173** and configure your API keys in Settings.

**Prerequisites:** Python 3.10+, Node.js 18+, [uv](https://docs.astral.sh/uv/)

### Ollama Setup (Local Models)

```bash
# Install Ollama
curl -fsSL https://ollama.com/install.sh | sh

# Pull models
ollama pull llama3.2
ollama pull mistral

# In Council Pro Settings, enter: http://localhost:11434
```

### Network Access

The app is accessible from your local network:
- **Local:** `http://localhost:5173`
- **Network:** `http://YOUR_IP:5173`

---

## Configuration

### First-Time Setup

1. **LLM API Keys** tab: Enter API keys for your chosen providers
2. **Council Config** tab: Select council members and chairman
3. **Save Changes**

API keys auto-save when you click "Test" and the connection succeeds.

### LLM API Keys

| Provider | Get API Key |
|----------|-------------|
| OpenRouter | [openrouter.ai/keys](https://openrouter.ai/keys) |
| Groq | [console.groq.com/keys](https://console.groq.com/keys) |
| OpenAI | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |
| Anthropic | [console.anthropic.com](https://console.anthropic.com/) |
| Google AI | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
| Mistral | [console.mistral.ai/api-keys](https://console.mistral.ai/api-keys/) |
| DeepSeek | [platform.deepseek.com](https://platform.deepseek.com/) |

### Custom OpenAI-Compatible Endpoint

Connect to any OpenAI-compatible API (Together AI, Fireworks, vLLM, LM Studio, etc.):
1. Go to **LLM API Keys** → **Custom OpenAI-Compatible Endpoint**
2. Enter Display Name, Base URL, and API Key
3. Click "Connect" to test and save

---

## Project History

Council Pro builds on open-source innovation:

1. **[llm-council](https://github.com/karpathy/llm-council)** by [Andrej Karpathy](https://github.com/karpathy)
   - Original concept: 3-stage deliberation
   - Core insight: Multiple models reviewing each other reduces blind spots

2. **[llm-council-plus](https://github.com/jacob-bd/llm-council-plus)** by [Jacob Ben-David](https://github.com/jacob-bd)
   - Multi-provider support, web search, execution modes

3. **LLM Council Pro** (this project)
   - Response revisions based on peer feedback
   - Character personas and council presets
   - Fully customizable prompts
   - Export to MD/DOCX/PDF
   - Additional providers (Perplexity, Kimi, GLM)
   - Refined "Midnight Glass" UI

---

## Tech Stack

| Component | Technology |
|-----------|------------|
| **Backend** | FastAPI, Python 3.10+, httpx (async) |
| **Frontend** | React 19, Vite, react-markdown |
| **Storage** | Local JSON files |
| **Theme** | "Midnight Glass" dark mode |

**Architecture:**
- Prefix-based model routing (`ollama:llama3`, `openai:gpt-4.1`)
- Graceful degradation (single failure doesn't break council)
- Real-time streaming with abort support
- Anonymous response labeling for unbiased review

---

## Data Storage

All data stored locally in `data/`:

```
data/
├── settings.json          # Configuration (includes API keys)
└── conversations/         # Conversation history
    ├── {uuid}.json
    └── ...
```

> **⚠️ Security Note:** API keys are stored in plain text. The `data/` folder is in `.gitignore` by default. Never commit `data/settings.json` to version control.

---

## Troubleshooting

**Models not appearing in dropdown**
- Ensure the provider is enabled in Council Config
- Check that API key is configured and tested successfully

**Rate limit errors (OpenRouter free tier)**
- Free models: 20 requests/min, 50/day
- Consider Groq (14,400/day) or Ollama (unlimited)

**Binary compatibility errors (node_modules)**
- When syncing between Intel/Apple Silicon Macs:
  ```bash
  rm -rf frontend/node_modules && cd frontend && npm install
  ```

---

## License

MIT License — fork it, modify it, make it your own.

---

**Watch the debate. See the reasoning. Get better answers.**
