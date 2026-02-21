/**
 * Main application: wires the sidebar, graph renderer, detail panel, and API together.
 */
(function () {
    "use strict";

    const canvas = document.getElementById("graph-canvas");
    const tooltip = document.getElementById("tooltip");
    const repoInput = document.getElementById("repo-path");
    const analyzeBtn = document.getElementById("analyze-btn");
    const saveBtn = document.getElementById("save-btn");
    const loadBtn = document.getElementById("load-btn");
    const loadFileInput = document.getElementById("load-file-input");
    const statusMsg = document.getElementById("status-msg");
    const loadingOverlay = document.getElementById("loading-overlay");
    const detailPanelEl = document.getElementById("detail-panel");

    const renderer = new GraphRenderer(canvas, tooltip);
    const sidebar = new SidebarController(renderer);
    const detailPanel = new DetailPanel(detailPanelEl, {
        onNavigate: (nodeId) => {
            renderer.zoomToNode(nodeId);
        },
    });

    let currentGraphData = null;

    renderer.onNodeClick((node) => {
        if (renderer.highlightedNodeId === null) {
            detailPanel.close();
        } else {
            detailPanel.show(node.id);
        }
    });

    analyzeBtn.addEventListener("click", () => startAnalysis());
    repoInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") startAnalysis();
    });

    saveBtn.addEventListener("click", () => saveGraph());
    loadBtn.addEventListener("click", () => loadFileInput.click());
    loadFileInput.addEventListener("change", (e) => loadGraph(e));

    async function startAnalysis() {
        const repoPath = repoInput.value.trim();
        if (!repoPath) {
            setStatus("Please enter a repository path.", true);
            return;
        }

        analyzeBtn.disabled = true;
        loadingOverlay.style.display = "";
        setStatus("Analyzing...");

        try {
            const resp = await fetch("/api/analyze", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ repo_path: repoPath }),
            });

            if (!resp.ok) {
                const err = await resp.json().catch(() => ({ detail: resp.statusText }));
                throw new Error(err.detail || "Analysis failed");
            }

            const data = await resp.json();

            if (!data.nodes || data.nodes.length === 0) {
                setStatus("No analyzable files found in the repository.", true);
                loadingOverlay.style.display = "none";
                analyzeBtn.disabled = false;
                return;
            }

            displayGraph(data);
            setStatus(`Loaded ${data.stats.total_nodes} nodes, ${data.stats.total_edges} edges`);
        } catch (err) {
            setStatus(err.message, true);
        } finally {
            loadingOverlay.style.display = "none";
            analyzeBtn.disabled = false;
        }
    }

    function displayGraph(data) {
        currentGraphData = data;
        detailPanel.close();
        renderer.setData(data);
        sidebar.populate(data);
        detailPanel.setGraphData(data);
        saveBtn.disabled = false;
    }

    function saveGraph() {
        if (!currentGraphData) return;
        const json = JSON.stringify(currentGraphData, null, 2);
        const blob = new Blob([json], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        const name = (currentGraphData.repo_name || "code_graph") + ".json";
        a.download = name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        setStatus("Graph saved to " + name);
    }

    function loadGraph(event) {
        const file = event.target.files[0];
        if (!file) return;

        loadingOverlay.style.display = "";
        setStatus("Loading...");

        const reader = new FileReader();
        reader.onload = function (e) {
            try {
                const data = JSON.parse(e.target.result);
                if (!data.nodes || !Array.isArray(data.nodes)) {
                    throw new Error("Invalid graph JSON: missing nodes array");
                }
                if (!data.edges || !Array.isArray(data.edges)) {
                    throw new Error("Invalid graph JSON: missing edges array");
                }
                displayGraph(data);
                setStatus(`Loaded ${data.stats?.total_nodes || data.nodes.length} nodes, ${data.stats?.total_edges || data.edges.length} edges from file`);
            } catch (err) {
                setStatus("Failed to load: " + err.message, true);
            } finally {
                loadingOverlay.style.display = "none";
                loadFileInput.value = "";
            }
        };
        reader.onerror = function () {
            setStatus("Failed to read file", true);
            loadingOverlay.style.display = "none";
        };
        reader.readAsText(file);
    }

    function setStatus(msg, isError) {
        statusMsg.textContent = msg;
        statusMsg.className = "status-msg" + (isError ? " error" : "");
    }

    initMobileToggle();

    function initMobileToggle() {
        const sidebar = document.getElementById("sidebar");
        const btn = document.createElement("button");
        btn.className = "mobile-toggle";
        btn.setAttribute("aria-label", "Toggle sidebar");
        btn.textContent = "\u2630";
        document.body.appendChild(btn);

        btn.addEventListener("click", () => {
            sidebar.classList.toggle("open");
        });
    }
})();
