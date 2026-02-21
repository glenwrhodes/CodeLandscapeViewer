from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


NODE_TYPES = [
    "endpoint",
    "file",
    "class",
    "function",
    "router",
    "model",
    "service",
    "utility",
    "middleware",
    "task",
    "config",
    "test",
    "component",
    "module",
]

EDGE_TYPES = [
    "imports",
    "calls",
    "inherits",
    "endpoint_handler",
    "db_read",
    "db_write",
    "api_call",
    "uses",
    "middleware_chain",
]

NODE_COLORS = {
    "endpoint": "#00bcd4",
    "file": "#66bb6a",
    "class": "#ffa726",
    "function": "#42a5f5",
    "router": "#ef5350",
    "model": "#ec407a",
    "service": "#26a69a",
    "utility": "#78909c",
    "middleware": "#ab47bc",
    "task": "#ff7043",
    "config": "#8d6e63",
    "test": "#9ccc65",
    "component": "#29b6f6",
    "module": "#d4e157",
}

EDGE_COLORS = {
    "imports": "#4fc3f7",
    "calls": "#81c784",
    "inherits": "#ffb74d",
    "endpoint_handler": "#e57373",
    "db_read": "#4dd0e1",
    "db_write": "#f06292",
    "api_call": "#aed581",
    "uses": "#90a4ae",
    "middleware_chain": "#ce93d8",
}


@dataclass
class Node:
    id: str
    label: str
    type: str
    file_path: str = ""
    line_number: int = 0
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "label": self.label,
            "type": self.type,
            "file_path": self.file_path,
            "line_number": self.line_number,
            "metadata": self.metadata,
        }


@dataclass
class Edge:
    source: str
    target: str
    type: str
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "source": self.source,
            "target": self.target,
            "type": self.type,
            "metadata": self.metadata,
        }


class Graph:
    def __init__(self) -> None:
        self.nodes: dict[str, Node] = {}
        self.edges: list[Edge] = []

    def add_node(self, node: Node) -> None:
        if node.id not in self.nodes:
            self.nodes[node.id] = node

    def add_edge(self, edge: Edge) -> None:
        if edge.source in self.nodes and edge.target in self.nodes:
            self.edges.append(edge)

    def add_edge_deferred(self, edge: Edge) -> None:
        """Add an edge without validating node existence (resolved later)."""
        self.edges.append(edge)

    def merge(self, other: Graph) -> None:
        for node in other.nodes.values():
            self.add_node(node)
        for edge in other.edges:
            self.edges.append(edge)

    def resolve_edges(self) -> None:
        """Remove edges whose source or target doesn't exist in nodes."""
        valid = []
        node_ids = set(self.nodes.keys())
        seen = set()
        for edge in self.edges:
            key = (edge.source, edge.target, edge.type)
            if edge.source in node_ids and edge.target in node_ids and key not in seen:
                valid.append(edge)
                seen.add(key)
        self.edges = valid

    def to_dict(self) -> dict:
        node_degree: dict[str, int] = {nid: 0 for nid in self.nodes}
        for edge in self.edges:
            node_degree[edge.source] = node_degree.get(edge.source, 0) + 1
            node_degree[edge.target] = node_degree.get(edge.target, 0) + 1

        nodes_list = []
        for nid, node in self.nodes.items():
            d = node.to_dict()
            d["degree"] = node_degree.get(nid, 0)
            nodes_list.append(d)

        node_type_counts = {}
        for node in self.nodes.values():
            node_type_counts[node.type] = node_type_counts.get(node.type, 0) + 1

        edge_type_counts = {}
        for edge in self.edges:
            edge_type_counts[edge.type] = edge_type_counts.get(edge.type, 0) + 1

        return {
            "nodes": nodes_list,
            "edges": [e.to_dict() for e in self.edges],
            "node_colors": NODE_COLORS,
            "edge_colors": EDGE_COLORS,
            "node_type_counts": node_type_counts,
            "edge_type_counts": edge_type_counts,
            "stats": {
                "total_nodes": len(self.nodes),
                "total_edges": len(self.edges),
            },
        }
