from __future__ import annotations

import re
from pathlib import Path

from .graph import Graph, Node, Edge

RE_INCLUDE = re.compile(r"""#include\s*[<"]([^>"]+)[>"]""")
RE_USING = re.compile(r"""using\s+([\w.]+)\s*;""")
RE_USE = re.compile(r"""use\s+([\w:\\]+)\s*;""")
RE_GO_IMPORT = re.compile(r"""import\s+(?:\(\s*)?["\s]*([\w/.-]+)[")\s]""")

CONFIG_NAMES = {
    "config", "settings", "configuration", ".env", "env",
    "webpack", "babel", "eslint", "prettier", "tsconfig",
    "jest", "karma", "rollup", "vite", "next.config",
    "pyproject", "setup.cfg", "tox", "mypy", "flake8",
    "docker-compose", "dockerfile", "makefile", "cmake",
    "package.json", "cargo.toml", "go.mod", "gemfile",
    "pipfile", "poetry", "requirements",
}

CONFIG_EXTENSIONS = {
    ".json", ".yaml", ".yml", ".toml", ".ini", ".cfg",
    ".env", ".conf", ".xml", ".properties",
}

TEST_PATTERNS = {"test", "tests", "spec", "specs", "__tests__", "test_", "_test"}

ROUTE_DIR_PATTERNS = {"routes", "api", "endpoints", "views", "controllers"}
MODEL_DIR_PATTERNS = {"models", "entities", "schemas"}
SERVICE_DIR_PATTERNS = {"services", "providers", "managers"}
UTIL_DIR_PATTERNS = {"utils", "utilities", "helpers", "lib", "common", "shared"}
MIDDLEWARE_DIR_PATTERNS = {"middleware", "middlewares"}


def _classify_by_path(rel_path: str, name: str, ext: str) -> str:
    parts = set(Path(rel_path).parts[:-1])
    name_lower = name.lower()
    stem = Path(name).stem.lower()

    if any(p.lower() in TEST_PATTERNS for p in parts) or "test" in stem or "spec" in stem:
        return "test"

    if stem in CONFIG_NAMES or ext in CONFIG_EXTENSIONS:
        return "config"

    if any(p.lower() in ROUTE_DIR_PATTERNS for p in parts):
        return "endpoint"
    if any(p.lower() in MODEL_DIR_PATTERNS for p in parts):
        return "model"
    if any(p.lower() in SERVICE_DIR_PATTERNS for p in parts):
        return "service"
    if any(p.lower() in UTIL_DIR_PATTERNS for p in parts):
        return "utility"
    if any(p.lower() in MIDDLEWARE_DIR_PATTERNS for p in parts):
        return "middleware"

    return "file"


class GenericAnalyzer:
    def analyze_file(self, file_info: dict, graph: Graph) -> None:
        file_id = f"file:{file_info['rel_path']}"
        node_type = _classify_by_path(
            file_info["rel_path"], file_info["name"], file_info["ext"]
        )

        graph.add_node(Node(
            id=file_id,
            label=file_info["name"],
            type=node_type,
            file_path=file_info["rel_path"],
            metadata={"extension": file_info["ext"]},
        ))

        if file_info["ext"] not in (".py", ".pyi", ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"):
            self._extract_generic_imports(file_info, file_id, graph)

    def _extract_generic_imports(self, file_info: dict, file_id: str, graph: Graph) -> None:
        try:
            with open(file_info["full_path"], "r", encoding="utf-8", errors="ignore") as f:
                source = f.read(50_000)
        except (OSError, UnicodeDecodeError):
            return

        targets: set[str] = set()

        for m in RE_INCLUDE.finditer(source):
            targets.add(m.group(1))
        for m in RE_USING.finditer(source):
            targets.add(m.group(1))
        for m in RE_USE.finditer(source):
            targets.add(m.group(1).replace("::", "/"))
        for m in RE_GO_IMPORT.finditer(source):
            targets.add(m.group(1))

        for target in targets:
            graph.add_edge_deferred(Edge(
                source=file_id,
                target=f"module:{target}",
                type="imports",
            ))
