# Code Landscape Viewer

An interactive code repository visualization tool that analyzes codebases across multiple languages and renders a navigable force-directed graph of the entire project structure.

## Features

- **Multi-language analysis**: Python (AST-based), JavaScript/TypeScript (pattern-based), and generic file-level analysis for any language
- **Semantic detection**: Identifies endpoints, models, services, routers, tasks, and more
- **Relationship mapping**: Imports, function calls, inheritance, DB operations, API calls
- **Interactive graph**: D3.js force-directed layout with zoom, pan, drag, search, and filtering
- **Dark theme UI**: Sidebar with node/edge type filters, display options, and statistics

## Quick Start

1. Install dependencies:

```bash
pip install -r requirements.txt
```

2. Run the server:

```bash
cd backend
python -m uvicorn app:app --reload --port 8000
```

3. Open your browser to `http://localhost:8000`

4. Enter a local repository path and click **Analyze**

## Supported Languages

| Language | Analysis Method | Detection |
|----------|----------------|-----------|
| Python | AST parsing | Endpoints, models, classes, functions, imports, DB ops, tasks |
| JavaScript/TypeScript | Regex patterns | Routes, components, modules, imports, API calls, DB queries |
| Other | File-level | Directory structure, file roles, basic import patterns |

## Architecture

- **Backend**: FastAPI serves the API and static frontend
- **Analyzers**: Language-specific analyzers produce a unified graph model
- **Frontend**: Vanilla JS + D3.js for graph visualization, no build step required
