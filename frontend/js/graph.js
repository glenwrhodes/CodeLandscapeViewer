/**
 * Canvas-based force-directed graph renderer with neon glow effects.
 */
class GraphRenderer {
    constructor(canvasEl, tooltipEl) {
        this.canvas = canvasEl;
        this.ctx = canvasEl.getContext("2d");
        this.tooltip = tooltipEl;

        this.allNodes = [];
        this.allEdges = [];
        this.visibleNodes = [];
        this.visibleEdges = [];
        this.nodeMap = {};

        this.nodeColors = {};
        this.edgeColors = {};
        this.hiddenNodeTypes = new Set();
        this.hiddenEdgeTypes = new Set();

        this.showLabels = false;
        this.showArrows = true;
        this.frozen = false;

        this.highlightedNodeId = null;
        this.hoveredNode = null;
        this.searchMatches = new Set();

        this.transform = d3.zoomIdentity;
        this.simulation = null;
        this.dpr = window.devicePixelRatio || 1;

        this._onNodeClick = null;
        this._resizeObserver = null;
        this._initCanvas();
        this._initZoom();
        this._initInteractions();
    }

    _initCanvas() {
        this._resize();
        this._resizeObserver = new ResizeObserver(() => this._resize());
        this._resizeObserver.observe(this.canvas.parentElement);
    }

    _resize() {
        const parent = this.canvas.parentElement;
        const w = parent.clientWidth;
        const h = parent.clientHeight;
        this.width = w;
        this.height = h;
        this.canvas.width = w * this.dpr;
        this.canvas.height = h * this.dpr;
        this.canvas.style.width = w + "px";
        this.canvas.style.height = h + "px";
        this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        this._draw();
    }

    _initZoom() {
        this.zoom = d3.zoom()
            .scaleExtent([0.05, 8])
            .on("zoom", (event) => {
                this.transform = event.transform;
                this._draw();
            });

        d3.select(this.canvas).call(this.zoom);
    }

    _initInteractions() {
        const self = this;

        d3.select(this.canvas).on("mousemove", function (event) {
            const [mx, my] = d3.pointer(event);
            const node = self._hitTest(mx, my);
            if (node !== self.hoveredNode) {
                self.hoveredNode = node;
                self.canvas.style.cursor = node ? "pointer" : "default";
                self._showTooltip(node, event.clientX, event.clientY);
                self._draw();
            } else if (node) {
                self._moveTooltip(event.clientX, event.clientY);
            }
        });

        d3.select(this.canvas).on("click", function (event) {
            const [mx, my] = d3.pointer(event);
            const node = self._hitTest(mx, my);
            if (node) {
                self.highlightedNodeId = self.highlightedNodeId === node.id ? null : node.id;
                if (self._onNodeClick) self._onNodeClick(node);
            } else {
                self.highlightedNodeId = null;
            }
            self._draw();
        });

        d3.select(this.canvas).on("mouseleave", function () {
            self.hoveredNode = null;
            self._hideTooltip();
            self._draw();
        });

        d3.select(this.canvas).call(
            d3.drag()
                .subject((event) => {
                    const [mx, my] = d3.pointer(event, self.canvas);
                    const node = self._hitTest(mx, my);
                    return node || null;
                })
                .on("start", (event) => {
                    if (!event.subject) return;
                    if (!event.active && self.simulation) self.simulation.alphaTarget(0.3).restart();
                    event.subject.fx = event.subject.x;
                    event.subject.fy = event.subject.y;
                })
                .on("drag", (event) => {
                    if (!event.subject) return;
                    event.subject.fx = self.transform.invertX(event.x);
                    event.subject.fy = self.transform.invertY(event.y);
                    self._draw();
                })
                .on("end", (event) => {
                    if (!event.subject) return;
                    if (!event.active && self.simulation) self.simulation.alphaTarget(0);
                    if (!self.frozen) {
                        event.subject.fx = null;
                        event.subject.fy = null;
                    }
                })
        );
    }

    _hitTest(canvasX, canvasY) {
        const x = this.transform.invertX(canvasX);
        const y = this.transform.invertY(canvasY);
        for (let i = this.visibleNodes.length - 1; i >= 0; i--) {
            const n = this.visibleNodes[i];
            const r = this._nodeRadius(n) + 2;
            const dx = n.x - x;
            const dy = n.y - y;
            if (dx * dx + dy * dy < r * r) return n;
        }
        return null;
    }

    _nodeRadius(node) {
        const base = 3;
        const deg = node.degree || 0;
        return base + Math.sqrt(deg) * 1.5;
    }

    setData(graphData) {
        this.allNodes = graphData.nodes.map(n => ({ ...n }));
        this.allEdges = graphData.edges.map(e => ({ ...e }));
        this.nodeColors = graphData.node_colors || {};
        this.edgeColors = graphData.edge_colors || {};

        this.nodeMap = {};
        for (const n of this.allNodes) {
            this.nodeMap[n.id] = n;
        }

        this.highlightedNodeId = null;
        this.searchMatches = new Set();
        this.hiddenNodeTypes = new Set();
        this.hiddenEdgeTypes = new Set();

        this._applyFilters();
        this._buildSimulation();

        this._fitPending = true;
        this.simulation.on("tick.fit", () => {
            if (this._fitPending && this.simulation.alpha() < 0.5) {
                this._fitPending = false;
                this.simulation.on("tick.fit", null);
                this.fitToView();
            }
        });
    }

    _applyFilters() {
        const visNodeIds = new Set();
        this.visibleNodes = this.allNodes.filter(n => {
            if (this.hiddenNodeTypes.has(n.type)) return false;
            visNodeIds.add(n.id);
            return true;
        });

        this.visibleEdges = this.allEdges.filter(e => {
            if (this.hiddenEdgeTypes.has(e.type)) return false;
            const src = typeof e.source === "object" ? e.source.id : e.source;
            const tgt = typeof e.target === "object" ? e.target.id : e.target;
            return visNodeIds.has(src) && visNodeIds.has(tgt);
        });
    }

    _buildSimulation() {
        if (this.simulation) this.simulation.stop();

        const nodeCount = this.visibleNodes.length;
        const edgeCount = this.visibleEdges.length;
        const density = edgeCount / Math.max(nodeCount, 1);

        const chargeStrength = nodeCount > 800 ? -25 : nodeCount > 400 ? -45 : nodeCount > 150 ? -70 : -90;
        const linkDistance = nodeCount > 800 ? 20 : nodeCount > 400 ? 35 : nodeCount > 150 ? 50 : 60;
        const linkStrength = nodeCount > 400 ? 0.35 : 0.4;

        this.simulation = d3.forceSimulation(this.visibleNodes)
            .force("link", d3.forceLink(this.visibleEdges)
                .id(d => d.id)
                .distance(linkDistance)
                .strength(linkStrength)
            )
            .force("charge", d3.forceManyBody().strength(chargeStrength).distanceMax(500))
            .force("center", d3.forceCenter(0, 0).strength(0.03))
            .force("collision", d3.forceCollide().radius(d => this._nodeRadius(d) + 3).strength(0.6))
            .force("x", d3.forceX(0).strength(0.01))
            .force("y", d3.forceY(0).strength(0.01))
            .alphaDecay(0.025)
            .on("tick", () => this._draw());

        if (this.frozen) this.simulation.stop();
    }

    _draw() {
        const ctx = this.ctx;
        const w = this.width;
        const h = this.height;

        ctx.save();
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);

        this._drawBackground(ctx, w, h);

        ctx.translate(this.transform.x, this.transform.y);
        ctx.scale(this.transform.k, this.transform.k);

        const highlightNeighbors = new Set();
        if (this.highlightedNodeId) {
            highlightNeighbors.add(this.highlightedNodeId);
            for (const e of this.visibleEdges) {
                const src = typeof e.source === "object" ? e.source.id : e.source;
                const tgt = typeof e.target === "object" ? e.target.id : e.target;
                if (src === this.highlightedNodeId) highlightNeighbors.add(tgt);
                if (tgt === this.highlightedNodeId) highlightNeighbors.add(src);
            }
        }

        this._drawEdges(ctx, highlightNeighbors);
        this._drawNodeGlows(ctx, highlightNeighbors);
        this._drawNodes(ctx, highlightNeighbors);

        if (this.showLabels && this.transform.k > 0.3) {
            this._drawLabels(ctx, highlightNeighbors);
        }

        ctx.restore();
    }

    _drawBackground(ctx, w, h) {
        const grad = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.max(w, h) * 0.7);
        grad.addColorStop(0, "#0e1e38");
        grad.addColorStop(1, "#060e1a");
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);
    }

    _drawEdges(ctx, highlightNeighbors) {
        const hasHighlight = this.highlightedNodeId !== null;

        for (const e of this.visibleEdges) {
            const src = typeof e.source === "object" ? e.source : this.nodeMap[e.source];
            const tgt = typeof e.target === "object" ? e.target : this.nodeMap[e.target];
            if (!src || !tgt || src.x == null || tgt.x == null) continue;

            const srcId = src.id || e.source;
            const tgtId = tgt.id || e.target;
            const isNeighbor = highlightNeighbors.has(srcId) && highlightNeighbors.has(tgtId);

            const color = this.edgeColors[e.type] || "#4fc3f7";
            let alpha = hasHighlight ? (isNeighbor ? 0.8 : 0.03) : 0.18;
            let lineWidth = isNeighbor ? 1.8 : 0.5;

            if (isNeighbor) {
                ctx.save();
                ctx.shadowColor = color;
                ctx.shadowBlur = 8;
            }

            ctx.beginPath();
            ctx.moveTo(src.x, src.y);
            ctx.lineTo(tgt.x, tgt.y);
            ctx.strokeStyle = color;
            ctx.globalAlpha = alpha;
            ctx.lineWidth = lineWidth;
            ctx.stroke();

            if (this.showArrows) {
                this._drawArrow(ctx, src, tgt, this._nodeRadius(tgt), color, alpha);
            }

            if (isNeighbor) {
                ctx.restore();
            }
        }
        ctx.globalAlpha = 1;
    }

    _drawArrow(ctx, src, tgt, targetRadius, color, alpha) {
        const dx = tgt.x - src.x;
        const dy = tgt.y - src.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 1) return;

        const ux = dx / dist;
        const uy = dy / dist;
        const tipX = tgt.x - ux * (targetRadius + 2);
        const tipY = tgt.y - uy * (targetRadius + 2);
        const arrowLen = 6;
        const arrowWidth = 3;

        ctx.beginPath();
        ctx.moveTo(tipX, tipY);
        ctx.lineTo(tipX - ux * arrowLen + uy * arrowWidth, tipY - uy * arrowLen - ux * arrowWidth);
        ctx.lineTo(tipX - ux * arrowLen - uy * arrowWidth, tipY - uy * arrowLen + ux * arrowWidth);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.globalAlpha = alpha;
        ctx.fill();
    }

    _drawNodeGlows(ctx, highlightNeighbors) {
        const hasHighlight = this.highlightedNodeId !== null;

        for (const n of this.visibleNodes) {
            if (n.x == null) continue;
            const r = this._nodeRadius(n);
            const color = this.nodeColors[n.type] || "#78909c";
            const isHighlighted = highlightNeighbors.has(n.id);
            const isHovered = this.hoveredNode && this.hoveredNode.id === n.id;
            const isSearchMatch = this.searchMatches.size > 0 && this.searchMatches.has(n.id);

            let alpha = hasHighlight ? (isHighlighted ? 0.35 : 0.02) : 0.2;
            if (this.searchMatches.size > 0 && !isSearchMatch && !hasHighlight) alpha = 0.03;
            if (isHovered) alpha = 0.5;

            const glowRadius = isHighlighted || isHovered ? r * 4 : r * 2.5;
            const grad = ctx.createRadialGradient(n.x, n.y, r * 0.5, n.x, n.y, glowRadius);
            grad.addColorStop(0, color);
            grad.addColorStop(1, "transparent");

            ctx.beginPath();
            ctx.arc(n.x, n.y, glowRadius, 0, Math.PI * 2);
            ctx.fillStyle = grad;
            ctx.globalAlpha = alpha;
            ctx.fill();
        }
        ctx.globalAlpha = 1;
    }

    _drawNodes(ctx, highlightNeighbors) {
        const hasHighlight = this.highlightedNodeId !== null;

        for (const n of this.visibleNodes) {
            if (n.x == null) continue;
            const r = this._nodeRadius(n);
            const color = this.nodeColors[n.type] || "#78909c";
            const isHighlighted = highlightNeighbors.has(n.id);
            const isHovered = this.hoveredNode && this.hoveredNode.id === n.id;
            const isSearchMatch = this.searchMatches.size > 0 && this.searchMatches.has(n.id);

            let alpha = 1;
            if (hasHighlight && !isHighlighted) alpha = 0.1;
            if (this.searchMatches.size > 0 && !isSearchMatch && !hasHighlight) alpha = 0.12;

            ctx.save();
            if (isHighlighted || isHovered || isSearchMatch) {
                ctx.shadowColor = color;
                ctx.shadowBlur = isHovered ? 20 : 12;
            }

            ctx.beginPath();
            ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.globalAlpha = alpha;
            ctx.fill();

            const bright = this._brighten(color, 60);
            const innerGrad = ctx.createRadialGradient(n.x - r * 0.3, n.y - r * 0.3, 0, n.x, n.y, r);
            innerGrad.addColorStop(0, bright);
            innerGrad.addColorStop(1, color);
            ctx.fillStyle = innerGrad;
            ctx.globalAlpha = alpha * 0.7;
            ctx.fill();

            ctx.restore();

            if (isHighlighted || isSearchMatch) {
                ctx.beginPath();
                ctx.arc(n.x, n.y, r + 2, 0, Math.PI * 2);
                ctx.strokeStyle = isSearchMatch ? "#ffffff" : bright;
                ctx.lineWidth = 1.2;
                ctx.globalAlpha = 0.7;
                ctx.stroke();
            }
        }
        ctx.globalAlpha = 1;
    }

    _brighten(hex, amount) {
        let r = parseInt(hex.slice(1, 3), 16);
        let g = parseInt(hex.slice(3, 5), 16);
        let b = parseInt(hex.slice(5, 7), 16);
        r = Math.min(255, r + amount);
        g = Math.min(255, g + amount);
        b = Math.min(255, b + amount);
        return `rgb(${r},${g},${b})`;
    }

    _drawLabels(ctx, highlightNeighbors) {
        const hasHighlight = this.highlightedNodeId !== null;
        const fontSize = Math.max(8, 10 / this.transform.k);
        ctx.font = `500 ${fontSize}px ${getComputedStyle(document.documentElement).getPropertyValue("--font-family")}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";

        for (const n of this.visibleNodes) {
            if (n.x == null) continue;
            const isHighlighted = highlightNeighbors.has(n.id);
            const isSearchMatch = this.searchMatches.size > 0 && this.searchMatches.has(n.id);

            let alpha = 0.75;
            if (hasHighlight && !isHighlighted) alpha = 0.05;
            if (this.searchMatches.size > 0 && !isSearchMatch && !hasHighlight) alpha = 0.06;

            const r = this._nodeRadius(n);
            const color = this.nodeColors[n.type] || "#78909c";

            ctx.save();
            if (isHighlighted || isSearchMatch) {
                ctx.shadowColor = color;
                ctx.shadowBlur = 6;
            }
            ctx.fillStyle = "#d8e4f0";
            ctx.globalAlpha = alpha;
            ctx.fillText(n.label, n.x, n.y + r + 4);
            ctx.restore();
        }
        ctx.globalAlpha = 1;
    }

    _showTooltip(node, clientX, clientY) {
        if (!node) {
            this._hideTooltip();
            return;
        }
        const color = this.nodeColors[node.type] || "#78909c";
        this.tooltip.innerHTML = `
            <div class="tooltip-title">${this._esc(node.label)}</div>
            <span class="tooltip-type" style="background:${color}">${node.type}</span>
            <div class="tooltip-detail">
                ${node.file_path ? `<div>${this._esc(node.file_path)}${node.line_number ? `:${node.line_number}` : ""}</div>` : ""}
                <div>Connections: ${node.degree || 0}</div>
            </div>
        `;
        this.tooltip.classList.add("visible");
        this.tooltip.setAttribute("aria-hidden", "false");
        this._moveTooltip(clientX, clientY);
    }

    _moveTooltip(cx, cy) {
        const container = this.canvas.parentElement;
        const rect = container.getBoundingClientRect();
        let x = cx - rect.left + 14;
        let y = cy - rect.top + 14;
        const tw = this.tooltip.offsetWidth;
        const th = this.tooltip.offsetHeight;
        if (x + tw > rect.width) x = cx - rect.left - tw - 10;
        if (y + th > rect.height) y = cy - rect.top - th - 10;
        this.tooltip.style.left = x + "px";
        this.tooltip.style.top = y + "px";
    }

    _hideTooltip() {
        this.tooltip.classList.remove("visible");
        this.tooltip.setAttribute("aria-hidden", "true");
    }

    _esc(str) {
        const div = document.createElement("div");
        div.textContent = str;
        return div.innerHTML;
    }

    fitToView() {
        if (this.visibleNodes.length === 0) return;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const n of this.visibleNodes) {
            if (n.x == null) continue;
            minX = Math.min(minX, n.x);
            minY = Math.min(minY, n.y);
            maxX = Math.max(maxX, n.x);
            maxY = Math.max(maxY, n.y);
        }
        if (!isFinite(minX)) return;

        const pad = 40;
        const gw = maxX - minX + pad * 2;
        const gh = maxY - minY + pad * 2;
        const scale = Math.min(this.width / gw, this.height / gh, 2.5);
        const cx = (minX + maxX) / 2;
        const cy = (minY + maxY) / 2;

        const t = d3.zoomIdentity
            .translate(this.width / 2, this.height / 2)
            .scale(scale)
            .translate(-cx, -cy);

        d3.select(this.canvas)
            .transition()
            .duration(600)
            .call(this.zoom.transform, t);
    }

    setNodeTypeVisibility(type, visible) {
        if (visible) this.hiddenNodeTypes.delete(type);
        else this.hiddenNodeTypes.add(type);
        this._applyFilters();
        this._buildSimulation();
    }

    setEdgeTypeVisibility(type, visible) {
        if (visible) this.hiddenEdgeTypes.delete(type);
        else this.hiddenEdgeTypes.add(type);
        this._applyFilters();
        this._buildSimulation();
    }

    setShowLabels(v) {
        this.showLabels = v;
        this._draw();
    }

    setShowArrows(v) {
        this.showArrows = v;
        this._draw();
    }

    setFrozen(v) {
        this.frozen = v;
        if (v) {
            if (this.simulation) this.simulation.stop();
            for (const n of this.visibleNodes) {
                n.fx = n.x;
                n.fy = n.y;
            }
        } else {
            for (const n of this.visibleNodes) {
                n.fx = null;
                n.fy = null;
            }
            if (this.simulation) this.simulation.alpha(0.3).restart();
        }
    }

    setSearchMatches(ids) {
        this.searchMatches = new Set(ids);
        this._draw();
        if (ids.length === 1) {
            const node = this.nodeMap[ids[0]];
            if (node && node.x != null) {
                const t = d3.zoomIdentity
                    .translate(this.width / 2, this.height / 2)
                    .scale(1.5)
                    .translate(-node.x, -node.y);
                d3.select(this.canvas)
                    .transition()
                    .duration(400)
                    .call(this.zoom.transform, t);
            }
        }
    }

    zoomToNode(nodeId) {
        this.highlightedNodeId = nodeId;
        this._draw();
        const node = this.nodeMap[nodeId];
        if (node && node.x != null) {
            const t = d3.zoomIdentity
                .translate(this.width / 2, this.height / 2)
                .scale(1.5)
                .translate(-node.x, -node.y);
            d3.select(this.canvas)
                .transition()
                .duration(400)
                .call(this.zoom.transform, t);
        }
    }

    clearHighlight() {
        this.highlightedNodeId = null;
        this._draw();
    }

    onNodeClick(fn) {
        this._onNodeClick = fn;
    }

    destroy() {
        if (this.simulation) this.simulation.stop();
        if (this._resizeObserver) this._resizeObserver.disconnect();
    }
}
