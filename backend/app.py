from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel

from analyzer.orchestrator import analyze_repo

app = FastAPI(title="Code Landscape Viewer")

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"


class AnalyzeRequest(BaseModel):
    repo_path: str


@app.post("/api/analyze")
async def analyze(req: AnalyzeRequest):
    repo = req.repo_path.strip()
    if not repo:
        raise HTTPException(status_code=400, detail="repo_path is required")

    expanded = os.path.expanduser(repo)
    resolved = Path(expanded).resolve()

    if not resolved.is_dir():
        raise HTTPException(status_code=400, detail=f"Directory not found: {repo}")

    try:
        result = analyze_repo(str(resolved))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    return result


@app.get("/api/status")
async def status():
    return {"status": "ok"}


app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")


@app.get("/")
async def index():
    return FileResponse(str(FRONTEND_DIR / "index.html"))
