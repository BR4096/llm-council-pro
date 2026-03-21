# The Evolution of LLM Council: From Karpathy's Experiment to Council Pro

## The Origin: Andrej Karpathy's llm-council (December 2025)

Andrej Karpathy, OpenAI co-founder and AI pioneer, released [llm-council](https://github.com/karpathy/llm-council) as what he called a "Saturday hack" — a 99% "vibe coded" experiment born from his desire to explore and evaluate multiple LLMs side by side while reading books with AI assistance.

**Karpathy's Vision (Narrow & Focused):**
- **Core insight**: Multiple models reviewing each other reduces blind spots
- **3-stage pipeline**: First opinions → Peer review → Chairman synthesis
- **Single provider**: OpenRouter-only, all cloud models
- **Minimal configuration**: Edit `config.py` to change models
- **No persistence**: Conversations not saved between sessions
- **Transparent about limitations**: "I'm not going to support it in any way"

Karpathy's original was intentionally narrow — he wanted to see models critique each other, not build a product. The README explicitly states: "Code is ephemeral now and libraries are over, ask your LLM to change it in whatever way you like."

---

## The Expansion: Jacob Ben-David's llm-council-plus

Jacob Ben-David forked Karpathy's experiment and transformed it into a more accessible tool, adding the infrastructure needed for everyday use.

**Ben-David's Contributions:**
- **Multi-provider support**: OpenRouter, Ollama, Groq, direct API connections (OpenAI, Anthropic, Google, Mistral, DeepSeek)
- **Web search integration**: DuckDuckGo, Tavily, Brave with Jina Reader for full content extraction
- **Execution modes**: Chat Only, Chat + Ranking, Full Deliberation — user controls deliberation depth
- **Temperature controls**: Separate sliders for each stage
- **Settings UI**: Tabbed interface for API keys, council configuration, prompts
- **Conversation persistence**: JSON-based storage in `data/conversations/`
- **Import/Export**: Backup and share council configurations
- **Enhanced documentation**: Comprehensive README with screenshots

Ben-David's fork made the council accessible — no more editing Python files to change models. But the core 3-stage pipeline remained unchanged: Deliberation → Review → Synthesis.

---

## The Transformation: LLM Council Pro (This Project)

This version takes Ben-David's accessibility improvements and extends them into something fundamentally different: a tool for **understanding how AI thinks**, not just getting better answers.

### What's New in Council Pro

**Stage 3: Response Revisions**
- Inspired by [Sean Kochel's YouTube tutorial](https://www.youtube.com/watch?v=AmduXg_xFEM), which demonstrated adding a "self-correction" stage where models amend their answers based on peer critiques
- Models don't just get reviewed — they get to **defend and improve** their positions
- Watch reasoning evolve in real-time

**Stage 4: Council Analysis & Debate**
This is the crown jewel — the feature that makes Council Pro unique:

1. **Truth Check**: Extracts factual claims from responses and verifies them against web sources. Confirmed, disputed, or unverified — you see the evidence.

2. **Highlights Extraction**: Identifies:
   - Agreements (where models converge)
   - Disagreements (points of contention with explicit positions)
   - Unique Insights (perspectives only one model offered)

3. **Chairman Rankings**: The chairman scores each revised response on reasoning, insight, and clarity — not just which is "best," but why.

4. **Model Debates** (optional): The chairman identifies disagreements from Stage 4 and **makes the models argue**. Primary debaters defend positions, commentators weigh in, the chairman delivers a verdict. This is unique — no other council implementation does this.

**Character Personas & Dream Councils**
- Assign character names to council slots: "The Analyst", "The Historian", "The Skeptic"
- Write custom member prompts for each slot
- Save themed councils as presets
- Build councils of philosophers, scientists, or historical figures

**Single-Model Councils**
- Run the same model in multiple slots with different personas
- Each slot is tracked by position, not model name
- Test how prompts change the output of the same model on the same question
- This mirrors what Claude Code does with subagents — multiple "personalities" from one model

**Fully Customizable Prompts**
- Every stage prompt is editable in Settings
- Fine-tune deliberation style, evaluation criteria, synthesis approach
- Reset to defaults if you break something

**Additional Providers**
- Perplexity (with citation extraction)
- Kimi (Chinese market)
- GLM (with thinking mode support)
- Custom OpenAI-compatible endpoints (vLLM, LM Studio, Together AI, Fireworks, etc.)

**Export System**
- Markdown, DOCX, PDF
- Includes all stages, debates, truth-check results

**Refined UI**
- "Midnight Glass" dark theme with glassmorphic effects
- Real-time streaming with abort support
- Network access for remote usage
- Voice dictation support

---

## Competitive Landscape

### Perplexity's Council
Perplexity has a council feature that shows multiple model responses and identifies agreements/disagreements. **What it lacks**: Models don't debate. They don't critique each other. They don't revise based on feedback. There's no truth verification. You see outputs, not reasoning.

### Mark Kashef's Claude Code Council
[Mark Kashef's YouTube video](https://www.youtube.com/watch?v=LpM1dlB12-A) demonstrates building an AI council with Claude Code subagents using Optimist Strategist, Devil's Advocate, and Neutral Analyst personas. **What's different**: It's a workflow within Claude Code, not a standalone tool. No peer review rankings, no revision stage, no truth checking, no debate feature.

### The Gap Council Pro Fills

| Feature | Karpathy | Ben-David | Council Pro | Perplexity | Kashef |
|---------|----------|-----------|-------------|------------|--------|
| Multiple models | ✓ | ✓ | ✓ | ✓ | ✓ |
| Peer review rankings | ✓ | ✓ | ✓ | ✗ | ✗ |
| Response revisions | ✗ | ✗ | ✓ | ✗ | ✗ |
| Agreements/disagreements | ✗ | ✗ | ✓ | ✓ | ✗ |
| Model debates | ✗ | ✗ | ✓ | ✗ | ✗ |
| Truth verification | ✗ | ✗ | ✓ | ✗ | ✗ |
| Character personas | ✗ | ✗ | ✓ | ✗ | ✓ |
| Single-model councils | ✗ | ✗ | ✓ | ✗ | ✓ |
| Web search integration | ✗ | ✓ | ✓ | ✓ | ✗ |
| Local model support | ✗ | ✓ | ✓ | ✗ | ✗ |
| Customizable prompts | ✗ | Limited | Full | ✗ | ✓ |
| Conversation persistence | ✗ | ✓ | ✓ | ✓ | ✗ |
| Export (MD/DOCX/PDF) | ✗ | ✗ | ✓ | ✗ | ✗ |

---

## The Philosophy Shift

**Karpathy's original**: "Let's see if models critique each other better than humans can." — A proof of concept.

**Ben-David's expansion**: "Let's make this accessible to everyone with any model." — A tool.

**Council Pro's vision**: "Let's understand how AI thinks." — An instrument for insight.

This is a tool for people who want to:
- See every raw response, every ranking, every revision
- Understand **why** models agree or disagree
- Watch reasoning evolve through debate
- Build councils with personality and purpose
- Mix local and cloud models to discover what different AI is actually good at

The debate feature is the differentiator. Perplexity shows you where models disagree. Council Pro makes them **argue about it** — and you watch.

---

## Sources

- [Karpathy's llm-council](https://github.com/karpathy/llm-council)
- [Ben-David's llm-council-plus](https://github.com/jacob-bd/llm-council-plus)
- [Sean Kochel's Tutorial: How to Use Andrej Karpathy's LLM Council](https://www.youtube.com/watch?v=AmduXg_xFEM)
- [Mark Kashef: How I Built an AI Council with Claude Code Subagents](https://www.youtube.com/watch?v=LpM1dlB12-A)
