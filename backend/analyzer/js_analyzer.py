from __future__ import annotations

import re
from pathlib import Path

from .graph import Graph, Node, Edge


RE_IMPORT_FROM = re.compile(
    r"""(?:import\s+(?:(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)(?:\s*,\s*(?:\{[^}]*\}|\*\s+as\s+\w+|\w+))*)\s+from\s+['"]([^'"]+)['"])"""
)
RE_REQUIRE = re.compile(r"""require\s*\(\s*['"]([^'"]+)['"]\s*\)""")
RE_DYNAMIC_IMPORT = re.compile(r"""import\s*\(\s*['"]([^'"]+)['"]\s*\)""")

RE_EXPRESS_ROUTE = re.compile(
    r"""(?:app|router|server)\s*\.\s*(get|post|put|patch|delete|all|use|head|options)\s*\(\s*['"]([^'"]*)['"]\s*"""
)

RE_FUNCTION_EXPORT = re.compile(
    r"""(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s+(\w+)"""
)
RE_CONST_ARROW = re.compile(
    r"""(?:export\s+(?:default\s+)?)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[\w]+)\s*=>"""
)
RE_CLASS_DECL = re.compile(
    r"""(?:export\s+(?:default\s+)?)?class\s+(\w+)(?:\s+extends\s+(\w+))?"""
)

RE_REACT_COMPONENT = re.compile(
    r"""(?:export\s+(?:default\s+)?)?(?:const|function)\s+([A-Z]\w+)"""
)

RE_MONGOOSE_MODEL = re.compile(
    r"""mongoose\.model\s*\(\s*['"](\w+)['"]"""
)
RE_SEQUELIZE_DEFINE = re.compile(
    r"""sequelize\.define\s*\(\s*['"](\w+)['"]"""
)
RE_SCHEMA = re.compile(
    r"""(?:new\s+(?:mongoose\.)?Schema|new\s+Schema)\s*\("""
)

RE_FETCH_CALL = re.compile(r"""(?:fetch|axios)\s*[.(]""")
RE_AXIOS_METHOD = re.compile(
    r"""axios\s*\.\s*(get|post|put|patch|delete|head|options)\s*\("""
)

RE_DB_READ = re.compile(
    r"""\.\s*(find|findOne|findMany|findById|findAll|select|where|aggregate|count|countDocuments)\s*\("""
)
RE_DB_WRITE = re.compile(
    r"""\.\s*(save|create|insert|insertOne|insertMany|update|updateOne|updateMany|delete|deleteOne|deleteMany|remove|destroy|bulkCreate|upsert)\s*\("""
)

RE_ROUTER_INIT = re.compile(
    r"""(?:express\.Router|Router)\s*\(\s*\)"""
)

RE_MIDDLEWARE = re.compile(
    r"""(?:app|router)\s*\.\s*use\s*\("""
)


class JsAnalyzer:
    def analyze_file(self, file_info: dict, graph: Graph) -> None:
        try:
            with open(file_info["full_path"], "r", encoding="utf-8", errors="ignore") as f:
                source = f.read()
        except (OSError, UnicodeDecodeError):
            return

        file_id = f"file:{file_info['rel_path']}"
        lines = source.split("\n")

        self._extract_routes(source, file_info, file_id, graph)
        self._extract_functions_and_classes(source, file_info, file_id, graph)
        self._extract_models(source, file_info, file_id, graph)
        self._extract_imports(source, file_info, file_id, graph)
        self._extract_api_calls(source, file_info, file_id, graph)
        self._extract_db_ops(source, file_info, file_id, graph)
        self._detect_router(source, file_info, file_id, graph)

    def _line_of(self, source: str, match_start: int) -> int:
        return source[:match_start].count("\n") + 1

    def _extract_routes(self, source: str, file_info: dict, file_id: str, graph: Graph) -> None:
        for m in RE_EXPRESS_ROUTE.finditer(source):
            method = m.group(1).upper()
            path = m.group(2)
            lineno = self._line_of(source, m.start())
            ep_id = f"endpoint:{file_info['rel_path']}:{method}:{path}"
            label = f"{method} {path}" if path else f"{method} (middleware)"

            if method == "USE":
                node_type = "middleware"
            else:
                node_type = "endpoint"

            graph.add_node(Node(
                id=ep_id,
                label=label,
                type=node_type,
                file_path=file_info["rel_path"],
                line_number=lineno,
                metadata={"method": method, "path": path},
            ))
            graph.add_edge(Edge(source=file_id, target=ep_id, type="endpoint_handler"))

    def _extract_functions_and_classes(self, source: str, file_info: dict, file_id: str, graph: Graph) -> None:
        seen_names = set()

        for m in RE_CLASS_DECL.finditer(source):
            name = m.group(1)
            base = m.group(2)
            lineno = self._line_of(source, m.start())
            class_id = f"class:{file_info['rel_path']}:{name}"

            node_type = "class"
            if "component" in name.lower() or "view" in name.lower():
                node_type = "component"
            elif "service" in name.lower():
                node_type = "service"
            elif "middleware" in name.lower():
                node_type = "middleware"
            elif "controller" in name.lower() or "router" in name.lower():
                node_type = "router"
            elif "model" in name.lower():
                node_type = "model"

            graph.add_node(Node(
                id=class_id, label=name, type=node_type,
                file_path=file_info["rel_path"], line_number=lineno,
                metadata={"extends": base},
            ))
            graph.add_edge(Edge(source=file_id, target=class_id, type="uses"))
            seen_names.add(name)

            if base:
                ref_id = f"class_ref:{base}"
                graph.add_node(Node(id=ref_id, label=base, type="class", metadata={"external_ref": True}))
                graph.add_edge_deferred(Edge(source=class_id, target=ref_id, type="inherits"))

        for regex in (RE_FUNCTION_EXPORT, RE_CONST_ARROW):
            for m in regex.finditer(source):
                name = m.group(1)
                if name in seen_names:
                    continue
                seen_names.add(name)

                lineno = self._line_of(source, m.start())
                func_id = f"func:{file_info['rel_path']}:{name}"

                node_type = "function"
                nl = name.lower()
                if "middleware" in nl:
                    node_type = "middleware"
                elif "handler" in nl or "controller" in nl:
                    node_type = "endpoint"
                elif name[0].isupper() and file_info["ext"] in (".jsx", ".tsx"):
                    node_type = "component"

                graph.add_node(Node(
                    id=func_id, label=name, type=node_type,
                    file_path=file_info["rel_path"], line_number=lineno,
                ))
                graph.add_edge(Edge(source=file_id, target=func_id, type="uses"))

    def _extract_models(self, source: str, file_info: dict, file_id: str, graph: Graph) -> None:
        for regex in (RE_MONGOOSE_MODEL, RE_SEQUELIZE_DEFINE):
            for m in regex.finditer(source):
                name = m.group(1)
                lineno = self._line_of(source, m.start())
                model_id = f"model:{file_info['rel_path']}:{name}"
                graph.add_node(Node(
                    id=model_id, label=name, type="model",
                    file_path=file_info["rel_path"], line_number=lineno,
                ))
                graph.add_edge(Edge(source=file_id, target=model_id, type="uses"))

    def _extract_imports(self, source: str, file_info: dict, file_id: str, graph: Graph) -> None:
        targets = set()
        for m in RE_IMPORT_FROM.finditer(source):
            targets.add(m.group(1))
        for m in RE_REQUIRE.finditer(source):
            targets.add(m.group(1))
        for m in RE_DYNAMIC_IMPORT.finditer(source):
            targets.add(m.group(1))

        for target in targets:
            graph.add_edge_deferred(Edge(
                source=file_id,
                target=f"module:{target}",
                type="imports",
            ))

    def _extract_api_calls(self, source: str, file_info: dict, file_id: str, graph: Graph) -> None:
        if RE_FETCH_CALL.search(source) or RE_AXIOS_METHOD.search(source):
            graph.add_edge_deferred(Edge(
                source=file_id, target=file_id, type="api_call",
            ))

    def _extract_db_ops(self, source: str, file_info: dict, file_id: str, graph: Graph) -> None:
        if RE_DB_READ.search(source):
            graph.add_edge_deferred(Edge(
                source=file_id, target=file_id, type="db_read",
            ))
        if RE_DB_WRITE.search(source):
            graph.add_edge_deferred(Edge(
                source=file_id, target=file_id, type="db_write",
            ))

    def _detect_router(self, source: str, file_info: dict, file_id: str, graph: Graph) -> None:
        if RE_ROUTER_INIT.search(source):
            router_id = f"router:{file_info['rel_path']}"
            graph.add_node(Node(
                id=router_id, label=Path(file_info["rel_path"]).stem + " (router)",
                type="router", file_path=file_info["rel_path"],
            ))
            graph.add_edge(Edge(source=file_id, target=router_id, type="uses"))

    def resolve_imports(self, js_files: list[dict], graph: Graph) -> None:
        """Resolve relative import paths to file nodes."""
        file_paths: dict[str, str] = {}
        for f in js_files:
            rel = f["rel_path"]
            file_id = f"file:{rel}"
            stem = rel
            for ext in (".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"):
                if stem.endswith(ext):
                    stem = stem[:-len(ext)]
                    break
            file_paths[stem] = file_id
            file_paths[rel] = file_id
            if stem.endswith("/index"):
                file_paths[stem[:-6]] = file_id

        for edge in graph.edges:
            if edge.type == "imports" and edge.target.startswith("module:"):
                mod = edge.target[len("module:"):]
                if mod.startswith("."):
                    source_file = edge.source.replace("file:", "")
                    source_dir = str(Path(source_file).parent).replace("\\", "/")
                    if source_dir == ".":
                        source_dir = ""
                    resolved = str(Path(source_dir) / mod).replace("\\", "/")
                    resolved = str(Path(resolved)).replace("\\", "/")

                    if resolved in file_paths:
                        edge.target = file_paths[resolved]
                    else:
                        for ext in (".js", ".jsx", ".ts", ".tsx"):
                            if resolved + ext.replace(".", "/") in file_paths:
                                edge.target = file_paths[resolved + ext.replace(".", "/")]
                                break
                            candidate = resolved
                            if candidate in file_paths:
                                edge.target = file_paths[candidate]
                                break
