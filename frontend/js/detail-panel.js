/**
 * Detail panel that shows deep code insight when a node is clicked.
 * Includes direct connections, dependency chains, impact analysis, and longest paths.
 */
class DetailPanel {
    constructor(panelEl, options = {}) {
        this.panel = panelEl;
        this.onNavigate = options.onNavigate || (() => {});

        this.graphData = null;
        this.nodeMap = {};
        this.nodeColors = {};
        this.edgeColors = {};
        this.outgoing = {};
        this.incoming = {};

        this.history = [];
        this.currentNodeId = null;

        this.headerEl = panelEl.querySelector(".dp-header");
        this.bodyEl = panelEl.querySelector(".dp-body");
        this.closeBtn = panelEl.querySelector(".dp-close");
        this.backBtn = panelEl.querySelector(".dp-back");

        this.closeBtn.addEventListener("click", () => this.close());
        this.backBtn.addEventListener("click", () => this._goBack());
    }

    setGraphData(data) {
        this.graphData = data;
        this.nodeMap = {};
        this.nodeColors = data.node_colors || {};
        this.edgeColors = data.edge_colors || {};
        for (const n of data.nodes) {
            this.nodeMap[n.id] = n;
        }
        this._buildAdjacency(data.edges);
    }

    _buildAdjacency(edges) {
        this.outgoing = {};
        this.incoming = {};
        for (const e of edges) {
            const src = typeof e.source === "object" ? e.source.id : e.source;
            const tgt = typeof e.target === "object" ? e.target.id : e.target;
            if (!this.outgoing[src]) this.outgoing[src] = [];
            if (!this.incoming[tgt]) this.incoming[tgt] = [];
            this.outgoing[src].push({ target: tgt, type: e.type });
            this.incoming[tgt].push({ source: src, type: e.type });
        }
    }

    show(nodeId) {
        const node = this.nodeMap[nodeId];
        if (!node) return;

        if (this.currentNodeId && this.currentNodeId !== nodeId) {
            this.history.push(this.currentNodeId);
            if (this.history.length > 30) this.history.shift();
        }
        this.currentNodeId = nodeId;
        this.backBtn.style.display = this.history.length > 0 ? "" : "none";

        this._renderHeader(node);
        this._renderBody(node);

        this.panel.classList.add("open");
        this.panel.setAttribute("aria-hidden", "false");
    }

    close() {
        this.panel.classList.remove("open");
        this.panel.setAttribute("aria-hidden", "true");
        this.currentNodeId = null;
        this.history = [];
    }

    _goBack() {
        if (this.history.length === 0) return;
        const prevId = this.history.pop();
        this.currentNodeId = null;
        this.show(prevId);
        this.onNavigate(prevId);
    }

    _renderHeader(node) {
        const color = this.nodeColors[node.type] || "#78909c";
        this.headerEl.innerHTML = `
            <div class="dp-node-identity">
                <span class="dp-type-badge" style="background:${color};box-shadow:0 0 8px ${color}" aria-label="Node type">${node.type}</span>
                <span class="dp-node-name">${this._esc(node.label)}</span>
            </div>
            ${node.file_path ? `<div class="dp-file-path">${this._esc(node.file_path)}${node.line_number ? `<span class="dp-line">:${node.line_number}</span>` : ""}</div>` : ""}
            <div class="dp-conn-count">${node.degree || 0} connections</div>
        `;
    }

    _renderBody(node) {
        this.bodyEl.innerHTML = "";

        this._renderConnections(node);
        this._renderLongestPath(node);
        this._renderChains(node);
        this._renderImpact(node);
    }

    // ── Direct Connections ──

    _renderConnections(node) {
        const outEdges = this.outgoing[node.id] || [];
        const inEdges = this.incoming[node.id] || [];

        if (outEdges.length === 0 && inEdges.length === 0) return;

        const section = this._section("CONNECTIONS");

        if (outEdges.length > 0) {
            const grouped = this._groupBy(outEdges, "type");
            for (const [type, edges] of Object.entries(grouped)) {
                const verb = this._describeEdge(type, "out");
                for (const e of edges) {
                    const target = this.nodeMap[e.target];
                    if (!target) continue;
                    section.appendChild(this._connectionRow(verb, target, type, "out"));
                }
            }
        }

        if (inEdges.length > 0) {
            const grouped = this._groupBy(inEdges, "type");
            for (const [type, edges] of Object.entries(grouped)) {
                const verb = this._describeEdge(type, "in");
                for (const e of edges) {
                    const source = this.nodeMap[e.source];
                    if (!source) continue;
                    section.appendChild(this._connectionRow(verb, source, type, "in"));
                }
            }
        }

        this.bodyEl.appendChild(section);
    }

    _connectionRow(verb, targetNode, edgeType, direction) {
        const row = document.createElement("div");
        row.className = "dp-conn-row";
        const color = this.nodeColors[targetNode.type] || "#78909c";
        const edgeColor = this.edgeColors[edgeType] || "#90a4ae";
        const arrow = direction === "out" ? "\u2192" : "\u2190";

        row.innerHTML = `
            <span class="dp-conn-arrow" style="color:${edgeColor}">${arrow}</span>
            <span class="dp-conn-verb">${verb}</span>
            <a class="dp-node-link" data-node-id="${this._esc(targetNode.id)}" style="color:${color}" aria-label="Navigate to ${this._esc(targetNode.label)}">
                <span class="dp-link-dot" style="background:${color}"></span>
                ${this._esc(targetNode.label)}
            </a>
        `;

        row.querySelector(".dp-node-link").addEventListener("click", (ev) => {
            ev.preventDefault();
            this._navigateTo(targetNode.id);
        });

        return row;
    }

    // ── Dependency Chains (BFS upstream / downstream) ──

    _renderChains(node) {
        const upstream = this._bfsTrace(node.id, "upstream", 6);
        const downstream = this._bfsTrace(node.id, "downstream", 6);

        if (upstream.length === 0 && downstream.length === 0) return;

        if (upstream.length > 0) {
            const section = this._section("DEPENDS ON");
            const sub = document.createElement("div");
            sub.className = "dp-chain-subtitle";
            sub.textContent = `This ${node.type} depends on ${upstream.length} upstream node${upstream.length !== 1 ? "s" : ""}`;
            section.appendChild(sub);

            const depthGroups = this._groupByDepth(upstream);
            for (const [depth, items] of depthGroups) {
                for (const item of items) {
                    section.appendChild(this._chainRow(item, depth));
                }
            }
            this.bodyEl.appendChild(section);
        }

        if (downstream.length > 0) {
            const section = this._section("DEPENDED ON BY");
            const sub = document.createElement("div");
            sub.className = "dp-chain-subtitle";
            sub.textContent = `${downstream.length} node${downstream.length !== 1 ? "s" : ""} depend${downstream.length === 1 ? "s" : ""} on this ${node.type}`;
            section.appendChild(sub);

            const depthGroups = this._groupByDepth(downstream);
            for (const [depth, items] of depthGroups) {
                for (const item of items) {
                    section.appendChild(this._chainRow(item, depth));
                }
            }
            this.bodyEl.appendChild(section);
        }
    }

    _chainRow(item, depth) {
        const row = document.createElement("div");
        row.className = "dp-chain-row";
        row.style.paddingLeft = (depth * 14) + "px";

        const targetNode = this.nodeMap[item.nodeId];
        if (!targetNode) return row;

        const color = this.nodeColors[targetNode.type] || "#78909c";
        const edgeColor = this.edgeColors[item.edgeType] || "#90a4ae";
        const verb = this._describeEdgeShort(item.edgeType);

        row.innerHTML = `
            <span class="dp-chain-edge" style="color:${edgeColor}">${verb}</span>
            <a class="dp-node-link" data-node-id="${this._esc(targetNode.id)}" style="color:${color}" aria-label="Navigate to ${this._esc(targetNode.label)}">
                <span class="dp-link-dot" style="background:${color}"></span>
                ${this._esc(targetNode.label)}
                <span class="dp-link-type">${targetNode.type}</span>
            </a>
        `;

        row.querySelector(".dp-node-link").addEventListener("click", (ev) => {
            ev.preventDefault();
            this._navigateTo(targetNode.id);
        });

        return row;
    }

    // ── Impact Analysis ──

    _renderImpact(node) {
        const downstream = this._bfsTrace(node.id, "downstream", 8);
        if (downstream.length === 0) return;

        const section = this._section("IMPACT RADIUS");

        const summary = document.createElement("div");
        summary.className = "dp-impact-summary";
        summary.innerHTML = `Changing <strong>${this._esc(node.label)}</strong> may affect <span class="dp-impact-count">${downstream.length}</span> other node${downstream.length !== 1 ? "s" : ""}`;
        section.appendChild(summary);

        const depthGroups = this._groupByDepth(downstream);
        for (const [depth, items] of depthGroups) {
            const depthLabel = document.createElement("div");
            depthLabel.className = "dp-depth-label";
            depthLabel.textContent = depth === 1 ? "Direct" : `${depth} steps away`;
            section.appendChild(depthLabel);

            for (const item of items) {
                const n = this.nodeMap[item.nodeId];
                if (!n) continue;
                const color = this.nodeColors[n.type] || "#78909c";
                const link = document.createElement("a");
                link.className = "dp-impact-item dp-node-link";
                link.style.color = color;
                link.setAttribute("data-node-id", n.id);
                link.setAttribute("aria-label", `Navigate to ${n.label}`);
                link.innerHTML = `<span class="dp-link-dot" style="background:${color}"></span>${this._esc(n.label)}`;
                link.addEventListener("click", (ev) => {
                    ev.preventDefault();
                    this._navigateTo(n.id);
                });
                section.appendChild(link);
            }
        }

        this.bodyEl.appendChild(section);
    }

    // ── Longest / Deepest Path ──

    _renderLongestPath(node) {
        const path = this._findLongestPath(node.id);
        if (path.length < 3) return;

        const section = this._section("DEEPEST PATH");
        const sub = document.createElement("div");
        sub.className = "dp-chain-subtitle";
        sub.textContent = `${path.length}-node chain through this ${node.type}`;
        section.appendChild(sub);

        const timeline = document.createElement("div");
        timeline.className = "dp-timeline";

        for (let i = 0; i < path.length; i++) {
            const step = path[i];
            const n = this.nodeMap[step.nodeId];
            if (!n) continue;
            const color = this.nodeColors[n.type] || "#78909c";
            const isCurrent = n.id === node.id;

            const entry = document.createElement("div");
            entry.className = "dp-timeline-entry" + (isCurrent ? " dp-timeline-current" : "");

            let edgeLabel = "";
            if (step.edgeType) {
                const edgeColor = this.edgeColors[step.edgeType] || "#90a4ae";
                edgeLabel = `<div class="dp-timeline-edge" style="color:${edgeColor}">${this._describeEdgeShort(step.edgeType)}</div>`;
            }

            entry.innerHTML = `
                ${i > 0 ? edgeLabel : ""}
                <div class="dp-timeline-node">
                    <span class="dp-timeline-dot" style="background:${color};box-shadow:0 0 6px ${color}"></span>
                    <a class="dp-node-link" data-node-id="${this._esc(n.id)}" style="color:${isCurrent ? "#fff" : color}" aria-label="Navigate to ${this._esc(n.label)}">
                        ${this._esc(n.label)}
                    </a>
                    <span class="dp-timeline-type">${n.type}</span>
                </div>
            `;

            const link = entry.querySelector(".dp-node-link");
            if (link) {
                link.addEventListener("click", (ev) => {
                    ev.preventDefault();
                    this._navigateTo(n.id);
                });
            }

            timeline.appendChild(entry);
        }

        section.appendChild(timeline);
        this.bodyEl.appendChild(section);
    }

    // ── Graph Traversal Algorithms ──

    _bfsTrace(startId, direction, maxDepth) {
        const results = [];
        const visited = new Set([startId]);
        const queue = [{ nodeId: startId, depth: 0 }];

        while (queue.length > 0) {
            const { nodeId, depth } = queue.shift();
            if (depth >= maxDepth) continue;

            const neighbors = direction === "upstream"
                ? (this.incoming[nodeId] || []).map(e => ({ nodeId: e.source, edgeType: e.type }))
                : (this.outgoing[nodeId] || []).map(e => ({ nodeId: e.target, edgeType: e.type }));

            for (const nb of neighbors) {
                if (visited.has(nb.nodeId)) continue;
                visited.add(nb.nodeId);
                const entry = { nodeId: nb.nodeId, edgeType: nb.edgeType, depth: depth + 1 };
                results.push(entry);
                queue.push({ nodeId: nb.nodeId, depth: depth + 1 });
            }
        }

        return results;
    }

    _findLongestPath(startId) {
        const upPath = this._dfsLongest(startId, "upstream", new Set(), 12);
        const downPath = this._dfsLongest(startId, "downstream", new Set(), 12);

        upPath.reverse();
        const combined = [...upPath, { nodeId: startId, edgeType: null }];
        if (downPath.length > 0) {
            combined.push(...downPath);
        }
        return combined;
    }

    _dfsLongest(nodeId, direction, visited, maxDepth) {
        if (maxDepth <= 0) return [];
        visited.add(nodeId);

        const neighbors = direction === "upstream"
            ? (this.incoming[nodeId] || []).map(e => ({ nodeId: e.source, edgeType: e.type }))
            : (this.outgoing[nodeId] || []).map(e => ({ nodeId: e.target, edgeType: e.type }));

        let longest = [];
        for (const nb of neighbors) {
            if (visited.has(nb.nodeId)) continue;
            const sub = this._dfsLongest(nb.nodeId, direction, new Set(visited), maxDepth - 1);
            const candidate = [{ nodeId: nb.nodeId, edgeType: nb.edgeType }, ...sub];
            if (candidate.length > longest.length) {
                longest = candidate;
            }
        }
        return longest;
    }

    // ── Natural Language Edge Descriptions ──

    _describeEdge(type, direction) {
        const map = {
            imports:          { out: "imports",           in: "imported by" },
            calls:            { out: "calls",             in: "called by" },
            inherits:         { out: "extends",           in: "extended by" },
            endpoint_handler: { out: "handles",           in: "handled by" },
            db_read:          { out: "reads from DB",     in: "read by" },
            db_write:         { out: "writes to DB",      in: "written by" },
            api_call:         { out: "calls API",         in: "API called by" },
            uses:             { out: "uses",              in: "used by" },
            middleware_chain:  { out: "chains to",         in: "chained from" },
        };
        const entry = map[type];
        if (entry) return entry[direction] || type;
        return type;
    }

    _describeEdgeShort(type) {
        const map = {
            imports: "imports",
            calls: "calls",
            inherits: "extends",
            endpoint_handler: "handles",
            db_read: "reads DB",
            db_write: "writes DB",
            api_call: "API call",
            uses: "uses",
            middleware_chain: "chains",
        };
        return map[type] || type;
    }

    // ── DOM Helpers ──

    _section(title) {
        const el = document.createElement("div");
        el.className = "dp-section";
        const h = document.createElement("div");
        h.className = "dp-section-title";
        h.textContent = title;
        el.appendChild(h);
        return el;
    }

    _groupBy(arr, key) {
        const groups = {};
        for (const item of arr) {
            const k = item[key];
            if (!groups[k]) groups[k] = [];
            groups[k].push(item);
        }
        return groups;
    }

    _groupByDepth(items) {
        const map = new Map();
        for (const item of items) {
            if (!map.has(item.depth)) map.set(item.depth, []);
            map.get(item.depth).push(item);
        }
        return [...map.entries()].sort((a, b) => a[0] - b[0]);
    }

    _navigateTo(nodeId) {
        this.show(nodeId);
        this.onNavigate(nodeId);
    }

    _esc(str) {
        const div = document.createElement("div");
        div.textContent = str || "";
        return div.innerHTML;
    }
}
