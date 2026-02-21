/**
 * Sidebar controls: node/edge type filters, search, display options, stats.
 */
class SidebarController {
    constructor(graphRenderer) {
        this.graph = graphRenderer;
        this.graphData = null;

        this.nodeTypesSection = document.getElementById("node-types-section");
        this.edgeTypesSection = document.getElementById("edge-types-section");
        this.displaySection = document.getElementById("display-options-section");
        this.statsSection = document.getElementById("stats-section");

        this.nodeTypesList = document.getElementById("node-types-list");
        this.edgeTypesList = document.getElementById("edge-types-list");
        this.statsContent = document.getElementById("stats-content");
        this.searchInput = document.getElementById("search-input");

        this._initDisplayToggles();
        this._initSearch();
    }

    populate(graphData) {
        this.graphData = graphData;
        this._buildNodeTypeFilters(graphData);
        this._buildEdgeTypeFilters(graphData);
        this._buildStats(graphData);

        this.nodeTypesSection.style.display = "";
        this.edgeTypesSection.style.display = "";
        this.displaySection.style.display = "";
        this.statsSection.style.display = "";
    }

    _buildNodeTypeFilters(data) {
        const counts = data.node_type_counts || {};
        const colors = data.node_colors || {};
        this.nodeTypesList.innerHTML = "";

        const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
        for (const [type, count] of sorted) {
            const color = colors[type] || "#78909c";
            const row = this._createFilterRow(type, color, count, true, (checked) => {
                this.graph.setNodeTypeVisibility(type, checked);
            });
            this.nodeTypesList.appendChild(row);
        }
    }

    _buildEdgeTypeFilters(data) {
        const counts = data.edge_type_counts || {};
        const colors = data.edge_colors || {};
        this.edgeTypesList.innerHTML = "";

        const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
        for (const [type, count] of sorted) {
            const color = colors[type] || "#90a4ae";
            const row = this._createFilterRow(type, color, count, true, (checked) => {
                this.graph.setEdgeTypeVisibility(type, checked);
            });
            this.edgeTypesList.appendChild(row);
        }
    }

    _createFilterRow(label, color, count, checked, onChange) {
        const row = document.createElement("label");
        row.className = "filter-row";
        row.setAttribute("aria-label", `Toggle ${label} visibility`);

        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = checked;
        cb.setAttribute("aria-label", `${label} filter`);
        cb.addEventListener("change", () => onChange(cb.checked));

        const swatch = document.createElement("span");
        swatch.className = "filter-swatch";
        swatch.style.background = color;
        swatch.style.boxShadow = `0 0 6px ${color}`;

        const labelEl = document.createElement("span");
        labelEl.className = "filter-label";
        labelEl.textContent = label;

        const countEl = document.createElement("span");
        countEl.className = "filter-count";
        countEl.textContent = count;

        row.appendChild(cb);
        row.appendChild(swatch);
        row.appendChild(labelEl);
        row.appendChild(countEl);
        return row;
    }

    _buildStats(data) {
        const stats = data.stats || {};
        const nodeTypes = Object.keys(data.node_type_counts || {}).length;
        const edgeTypes = Object.keys(data.edge_type_counts || {}).length;

        this.statsContent.innerHTML = `
            <div>Nodes: <span class="stat-value">${stats.total_nodes || 0}</span></div>
            <div>Edges: <span class="stat-value">${stats.total_edges || 0}</span></div>
            <div>Node types: <span class="stat-value">${nodeTypes}</span></div>
            <div>Edge types: <span class="stat-value">${edgeTypes}</span></div>
        `;
    }

    _initDisplayToggles() {
        document.getElementById("toggle-labels").addEventListener("change", (e) => {
            this.graph.setShowLabels(e.target.checked);
        });
        document.getElementById("toggle-arrows").addEventListener("change", (e) => {
            this.graph.setShowArrows(e.target.checked);
        });
        document.getElementById("toggle-freeze").addEventListener("change", (e) => {
            this.graph.setFrozen(e.target.checked);
        });
    }

    _initSearch() {
        let debounce = null;
        this.searchInput.addEventListener("input", () => {
            clearTimeout(debounce);
            debounce = setTimeout(() => this._performSearch(), 200);
        });
    }

    _performSearch() {
        const query = this.searchInput.value.trim().toLowerCase();
        if (!query || !this.graphData) {
            this.graph.setSearchMatches([]);
            return;
        }

        const matches = [];
        for (const n of this.graphData.nodes) {
            const label = (n.label || "").toLowerCase();
            const path = (n.file_path || "").toLowerCase();
            if (label.includes(query) || path.includes(query)) {
                matches.push(n.id);
            }
        }
        this.graph.setSearchMatches(matches);
    }
}
