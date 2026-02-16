# PsychMem - Psych-Grounded Selective Memory for AI Agents

A memory system for AI agents (Claude Code, OpenCode) that implements human-like memory with:

- **STM/LTM Consolidation** - Short-term memories decay or promote to long-term based on importance
- **Decay Curves** - Exponential forgetting based on Ebbinghaus curves
- **Importance Scoring** - 7-feature model (recency, frequency, importance, utility, novelty, confidence, interference)
- **Multilingual Detection** - Importance signals in 15 languages
- **Structural Analysis** - Language-agnostic typography and conversation flow analysis
- **Per-Message Extraction** - Real-time memory capture, not just on session end
- **Dual-Agent Support** - Works with both OpenCode and Claude Code

## Installation

### OpenCode Plugin

Place in your project's `.opencode/plugins/` directory or global `~/.config/opencode/plugins/`:

```bash
# Clone to plugins directory
git clone https://github.com/yourusername/psychmem.git ~/.config/opencode/plugins/psychmem

# Build
cd ~/.config/opencode/plugins/psychmem
npm install
npm run build
```

Or add to `opencode.json`:
```json
{
  "plugin": ["psychmem"]
}
```

### Claude Code Integration

PsychMem writes memories to Claude Code's auto-memory location:
- `~/.claude/projects/<project>/memory/MEMORY.md` (first 200 lines auto-loaded)
- Topic files: `constraints.md`, `learnings.md`, `decisions.md`, `bugfixes.md`

### Environment Variables

```bash
# OpenCode-specific
PSYCHMEM_INJECT_ON_COMPACTION=true        # Inject memories during compaction
PSYCHMEM_EXTRACT_ON_COMPACTION=true       # Extract before compaction
PSYCHMEM_EXTRACT_ON_MESSAGE=true          # Per-message extraction (v1.9)
PSYCHMEM_MAX_COMPACTION_MEMORIES=10       # Max memories on compaction
PSYCHMEM_MAX_SESSION_MEMORIES=10          # Max memories on session start
PSYCHMEM_MESSAGE_WINDOW_SIZE=3            # Messages for context window
PSYCHMEM_MESSAGE_IMPORTANCE_THRESHOLD=0.5 # Min importance for per-message
```

## How It Works

### Psychology Foundations

| Concept | Psychology Basis | Implementation |
|---------|------------------|----------------|
| **Dual-Store Model** | Atkinson-Shiffrin | Separate STM/LTM with different decay rates |
| **Forgetting Curve** | Ebbinghaus (1885) | `strength = s₀ × e^(-λ × Δt)` |
| **Working Memory** | Cowan's 4±1 | Max 4 memories per extraction |
| **Importance** | Emotional salience | 7-feature weighted scoring |
| **Reconsolidation** | Nader et al. (2000) | Update LTM when new evidence conflicts |

### Hook Lifecycle

1. **SessionStart** - Retrieves relevant memories and injects as context
2. **message.updated** - Per-message extraction with importance pre-filter (v1.9)
3. **PostToolUse** - Captures tool events (especially errors/fixes)
4. **Stop/session.idle** - Full context sweep and memory extraction
5. **Compaction** - Sweeps ALL messages before context compression
6. **SessionEnd** - Final consolidation and decay

### Memory Classification

| Type | Scope | Auto-Promote | Example |
|------|-------|--------------|---------|
| 🔴 **bugfix** | Project | ✓ LTM | "Fixed null pointer in auth module" |
| 🎓 **learning** | User | ✓ LTM | "Learned that bun:sqlite requires different API" |
| 🤔 **decision** | Project | ✓ LTM | "Decided to use SQLite over Postgres" |
| 🚫 **constraint** | User | - | "Never use var in TypeScript" |
| ⭐ **preference** | User | - | "Prefers functional style over OOP" |
| 📋 **procedural** | User | - | "Run tests before committing" |
| 💡 **semantic** | Project | - | "The API uses REST, not GraphQL" |
| 📅 **episodic** | Project | - | "Yesterday we refactored the auth flow" |

### Importance Detection

**Multilingual patterns** (15 languages):
- Explicit: "remember", "recuerda", "vergiss nicht", "记住", etc.
- Emphasis: "always", "never", "important", "crítico", "重要"
- Corrections: "actually", "wait", "en realidad", "eigentlich"

**Structural signals** (language-agnostic):
- Typography: ALL CAPS, `!!`, bold/emphasis markdown
- Repetition: Trigram overlap > 40%
- Correction pattern: Short reply after long
- Enumeration: Lists, "first", "second"

## Architecture

```
src/
├── index.ts                    # Main PsychMem class
├── types/                      # TypeScript definitions
├── storage/
│   └── database.ts             # SQLite storage with decay
├── memory/
│   ├── context-sweep.ts        # Stage 1: Extract candidates
│   ├── selective-memory.ts     # Stage 2: Score & consolidate
│   ├── patterns.ts             # Multilingual importance patterns
│   └── structural-analyzer.ts  # Language-agnostic signals
├── hooks/
│   └── stop.ts                 # Main extraction hook
├── retrieval/
│   └── index.ts                # Scope-aware retrieval
├── adapters/
│   ├── opencode/               # OpenCode plugin adapter
│   └── claude-code/            # Claude Code auto-memory adapter
└── transcript/
    └── sweep.ts                # Transcript-based extraction
```

## Data Storage

- **OpenCode**: `~/.psychmem/opencode/memory.db`
- **Claude Code**: `~/.psychmem/claude-code/memory.db`

Both use SQLite with vector embeddings for similarity search.

## Version History

- **v1.9** - Per-message extraction via `message.updated` hook
- **v1.8** - Dual-agent integration (OpenCode compaction + Claude Code auto-memory)
- **v1.7** - Compaction sweep trigger
- **v1.6** - Project/user-level memory scope
- **v1.5** - Multilingual (15 languages) + structural analysis

## License

MIT
