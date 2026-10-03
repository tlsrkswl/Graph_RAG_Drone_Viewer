(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const ui = {
    loadStatus: $("load-status"),
    statNodes: $("stat-nodes"),
    statEdges: $("stat-edges"),
    statCommunities: $("stat-communities"),
    statLod: $("stat-lod"),
    search: $("search"),
    searchResults: $("search-results"),
    detailMode: $("detail-mode"),
    typeFilter: $("type-filter"),
    communityLevel: $("community-level"),
    zoomIn: $("zoom-in"),
    zoomOut: $("zoom-out"),
    reset: $("reset-view"),
    stage: $("graph-stage"),
    container: $("sigma-container"),
    communityCanvas: $("community-layer"),
    graphError: $("graph-error"),
    legend: $("type-legend"),
    zoomFactor: $("zoom-factor"),
    viewNote: $("view-note"),
    modeKG: $("mode-kg"),
    modeCommunity: $("mode-community"),
    pageTitle: $("page-title"),
    pageSubtitle: $("page-subtitle"),
    graphHelp: $("graph-help"),
    communityStatLabel: $("community-stat-label"),
    communityLevelControl: $("community-level-control"),
    detailsKind: $("details-kind"),
    detailsTitle: $("details-title"),
    detailsBody: $("details-body"),
  };

  const state = {
    payload: null,
    graph: null,
    viewMode: "kg",
    renderer: null,
    initialRatio: 1,
    autoLod: 0,
    currentLod: 0,
    detailMode: "auto",
    typeFilter: "ALL",
    selectedNode: null,
    selectedEdge: null,
    selectedNeighbors: new Set(),
    selectedIncidentEdges: new Set(),
    selectedCommunity: null,
    communityLevelMode: "auto",
    communityMap: new Map(),
    searchMatch: null,
    communityHulls: [],
    communityHullById: new Map(),
    communityFrontiers: [],
    communityFrame: 0,
    layoutMode: "kg",
    zoomFactor: 1,
  };

  const detailNames = ["Overview", "Medium", "Close", "Full"];
  const fmt = new Intl.NumberFormat();

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function setError(message) {
    ui.graphError.textContent = message;
    ui.graphError.hidden = false;
    ui.graphError.style.display = "block";
    ui.loadStatus.textContent = "Load failed";
  }

  function normalizeText(value) {
    return String(value || "").normalize("NFKC").toLocaleLowerCase();
  }

  function communityHue(id) {
    let hash = 2166136261;
    const text = String(id || "community");
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return Math.abs(hash) % 360;
  }

  function colorForCommunity(id, alpha, lightness = 60, saturation = 52) {
    return `hsla(${communityHue(id)}, ${saturation}%, ${lightness}%, ${alpha})`;
  }

  function convexHull(points) {
    if (points.length <= 3) return points.slice();
    const pts = points
      .map((p) => ({ x: p.x, y: p.y }))
      .sort((a, b) => a.x - b.x || a.y - b.y);
    const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    const lower = [];
    for (const p of pts) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
      lower.push(p);
    }
    const upper = [];
    for (let i = pts.length - 1; i >= 0; i--) {
      const p = pts[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
      upper.push(p);
    }
    lower.pop();
    upper.pop();
    return lower.concat(upper);
  }

  function hullDescriptor(community, nodeIds, { frontierLevel = null } = {}) {
    const points = [];
    for (const nodeId of nodeIds || []) {
      if (!state.graph.hasNode(nodeId)) continue;
      const a = state.graph.getNodeAttributes(nodeId);
      points.push({ x: a.x, y: a.y });
    }
    if (!points.length) return null;
    const hull = points.length >= 3 ? convexHull(points) : points.slice();
    return {
      id: String(community.community_id || "community"),
      title: String(community.title || community.community_id || "Community"),
      level: Number(community.level || 0),
      size: points.length,
      fullSize: Number(community.size || (community.nodes || []).length || points.length),
      parentId: community.parent_id || null,
      rootId: community.root_id || community.community_id,
      summary: community.summary || "",
      frontierLevel,
      hull,
    };
  }

  // Builds two structures for the *current layout*:
  // 1) full hulls for every Leiden community (used when a community is selected)
  // 2) hierarchy frontiers for depth 0..N. Every entity belongs to exactly one
  //    visible frontier group: its deepest available community whose level <= depth.
  // This prevents entities from losing their community background when a branch ends
  // before Level 3.
  function buildCommunityHulls() {
    state.communityHulls = [];
    state.communityHullById = new Map();
    state.communityFrontiers = [];
    const communities = state.payload?.communities || [];
    if (!communities.length || !state.graph) return;

    let maxLevel = 0;
    for (const community of communities) {
      maxLevel = Math.max(maxLevel, Number(community.level || 0));
      const descriptor = hullDescriptor(community, community.nodes || []);
      if (!descriptor) continue;
      state.communityHulls.push(descriptor);
      state.communityHullById.set(descriptor.id, descriptor);
    }

    const graphNodes = state.graph.nodes();
    for (let depth = 0; depth <= maxLevel; depth++) {
      const grouped = new Map();
      for (const nodeId of graphNodes) {
        const attrs = state.graph.getNodeAttributes(nodeId);
        const memberships = (attrs.communities || [])
          .filter((c) => Number(c.level || 0) <= depth)
          .sort((a, b) => Number(a.level || 0) - Number(b.level || 0));
        if (!memberships.length) continue;
        const chosen = memberships[memberships.length - 1];
        const id = String(chosen.id);
        if (!grouped.has(id)) grouped.set(id, []);
        grouped.get(id).push(nodeId);
      }

      const frontier = [];
      for (const [id, nodeIds] of grouped) {
        const community = state.communityMap.get(id);
        if (!community) continue;
        const descriptor = hullDescriptor(community, nodeIds, { frontierLevel: depth });
        if (descriptor) frontier.push(descriptor);
      }
      state.communityFrontiers[depth] = frontier;
    }
  }

  function scheduleCommunityDraw() {
    if (state.communityFrame) cancelAnimationFrame(state.communityFrame);
    state.communityFrame = requestAnimationFrame(drawCommunities);
  }

  function activeCommunityLevel() {
    if (state.communityLevelMode !== "auto") return Number(state.communityLevelMode);
    const maxLevel = Math.max(0, state.communityFrontiers.length - 1);
    return Math.min(state.currentLod, maxLevel);
  }

  function makePolygonPath(ctx, points) {
    if (!points.length) return;
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
    ctx.closePath();
  }

  function drawGradientCommunity(ctx, community, viewportPoints, selected) {
    const cx = viewportPoints.reduce((sum, p) => sum + p.x, 0) / viewportPoints.length;
    const cy = viewportPoints.reduce((sum, p) => sum + p.y, 0) / viewportPoints.length;
    const centerAlpha = selected ? 0.30 : 0.19;
    const midAlpha = selected ? 0.17 : 0.10;
    const edgeAlpha = selected ? 0.075 : 0.025;
    const outlineAlpha = selected ? 0.78 : 0.22;

    if (viewportPoints.length === 1) {
      const radius = selected ? 30 : 22;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
      g.addColorStop(0, colorForCommunity(community.id, centerAlpha, 55));
      g.addColorStop(0.48, colorForCommunity(community.id, midAlpha, 62));
      g.addColorStop(0.82, colorForCommunity(community.id, edgeAlpha, 70));
      g.addColorStop(1, colorForCommunity(community.id, 0, 76));
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.fill();
      ctx.strokeStyle = colorForCommunity(community.id, outlineAlpha, 54);
      ctx.lineWidth = selected ? 2.5 : 0.9;
      ctx.stroke();
      return { cx, cy };
    }

    if (viewportPoints.length === 2) {
      const [a, b] = viewportPoints;
      const dx = b.x - a.x, dy = b.y - a.y;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const radius = selected ? 26 : 19;
      const angle = Math.atan2(dy, dx);
      const rx = distance / 2 + radius;
      const ry = radius;
      const gRadius = Math.max(rx, ry) * 1.05;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, gRadius);
      g.addColorStop(0, colorForCommunity(community.id, centerAlpha, 55));
      g.addColorStop(0.50, colorForCommunity(community.id, midAlpha, 62));
      g.addColorStop(0.84, colorForCommunity(community.id, edgeAlpha, 70));
      g.addColorStop(1, colorForCommunity(community.id, 0, 76));
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, angle, 0, Math.PI * 2);
      ctx.fillStyle = g;
      ctx.fill();
      ctx.strokeStyle = colorForCommunity(community.id, outlineAlpha, 54);
      ctx.lineWidth = selected ? 2.5 : 0.9;
      ctx.stroke();
      return { cx, cy };
    }

    const rawRadius = Math.max(...viewportPoints.map((p) => Math.hypot(p.x - cx, p.y - cy)), 1);
    const padding = selected ? 24 : 17;
    const scale = 1 + padding / rawRadius;
    const inflated = viewportPoints.map((p) => ({
      x: cx + (p.x - cx) * scale,
      y: cy + (p.y - cy) * scale,
    }));
    const radius = rawRadius + padding;
    const xs = inflated.map((p) => p.x), ys = inflated.map((p) => p.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);

    ctx.save();
    makePolygonPath(ctx, inflated);
    ctx.clip();
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    g.addColorStop(0, colorForCommunity(community.id, centerAlpha, 55));
    g.addColorStop(0.42, colorForCommunity(community.id, midAlpha, 62));
    g.addColorStop(0.76, colorForCommunity(community.id, edgeAlpha, 70));
    g.addColorStop(1, colorForCommunity(community.id, 0, 76));
    ctx.fillStyle = g;
    ctx.fillRect(minX - 2, minY - 2, maxX - minX + 4, maxY - minY + 4);
    ctx.restore();

    makePolygonPath(ctx, inflated);
    ctx.strokeStyle = colorForCommunity(community.id, outlineAlpha, 54);
    ctx.lineWidth = selected ? 2.6 : 0.9;
    ctx.stroke();
    return { cx, cy };
  }

  function drawCommunities() {
    state.communityFrame = 0;
    const canvas = ui.communityCanvas;
    const rect = ui.stage.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    if (state.viewMode !== "community") return;
    if (!state.renderer || !state.communityFrontiers.length) return;

    const targetLevel = activeCommunityLevel();
    const frontier = state.communityFrontiers[targetLevel] || [];
    const candidates = [];
    const zoomFactor = state.zoomFactor || 1;
    const addCandidate = (community, selected = false) => {
      const viewportPoints = community.hull.map((p) => state.renderer.graphToViewport(p));
      if (!viewportPoints.length) return;
      const xs = viewportPoints.map((p) => p.x);
      const ys = viewportPoints.map((p) => p.y);
      const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
      const margin = 90;
      if (maxX < -margin || minX > width + margin || maxY < -margin || minY > height + margin) return;
      const span = Math.max(maxX - minX, maxY - minY);
      if (!selected) {
        // Tiny/singleton communities are visually meaningless at overview scale and
        // expensive to paint. They appear naturally as the user zooms closer.
        if (community.size === 1 && zoomFactor < 1.9 && targetLevel <= 1) return;
        if (span < 3.5 && zoomFactor < 3.5) return;
      }
      candidates.push({ community, viewportPoints, area: Math.max(1, (maxX - minX) * (maxY - minY)), selected });
    };

    for (const community of frontier) addCandidate(community, community.id === state.selectedCommunity);
    if (state.selectedCommunity && !frontier.some((c) => c.id === state.selectedCommunity)) {
      const selectedHull = state.communityHullById.get(state.selectedCommunity);
      if (selectedHull) addCandidate(selectedHull, true);
    }

    candidates.sort((a, b) => Number(b.selected) - Number(a.selected) || b.area - a.area);
    const maxDraw = targetLevel === 0 ? 700 : targetLevel === 1 ? 850 : targetLevel === 2 ? 1000 : 1200;
    const visible = candidates.slice(0, maxDraw);
    // Draw larger regions first so smaller/finer frontier groups remain legible on top.
    visible.sort((a, b) => Number(a.selected) - Number(b.selected) || b.area - a.area);

    for (const item of visible) {
      const { community, viewportPoints, selected } = item;
      const center = drawGradientCommunity(ctx, community, viewportPoints, selected);
      if (!center) continue;
      const minLabelSize = targetLevel === 0 ? 15 : targetLevel === 1 ? 8 : targetLevel === 2 ? 5 : 3;
      if (selected || community.size >= minLabelSize) {
        ctx.font = selected ? "700 13px system-ui, sans-serif" : "600 11px system-ui, sans-serif";
        ctx.fillStyle = colorForCommunity(community.id, selected ? 0.98 : 0.84, 32, 48);
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const raw = `L${community.level} · ${community.title}`;
        const label = raw.length > 62 ? `${raw.slice(0, 59)}…` : raw;
        ctx.fillText(label, center.cx, center.cy);
      }
    }
  }

  function autoLodForZoom(zoomFactor) {
    if (zoomFactor < 1.6) return 0;
    if (zoomFactor < 3.6) return 1;
    if (zoomFactor < 8.0) return 2;
    return 3;
  }

  function updateZoomState() {
    if (!state.renderer) return;
    const ratio = state.renderer.getCamera().getState().ratio;
    const zoomFactor = state.initialRatio / Math.max(ratio, 1e-9);
    state.zoomFactor = zoomFactor;
    state.autoLod = autoLodForZoom(zoomFactor);
    state.currentLod = state.detailMode === "auto" ? state.autoLod : Number(state.detailMode);
    ui.zoomFactor.textContent = zoomFactor.toFixed(1);
    ui.statLod.textContent = detailNames[state.currentLod];
    state.renderer.refresh({ skipIndexation: true });
    scheduleCommunityDraw();
  }

  function nodePassesType(data) {
    return state.typeFilter === "ALL" || data.entityType === state.typeFilter;
  }

  function nodeIsVisible(node, data) {
    if (!nodePassesType(data)) return node === state.selectedNode;
    if (node === state.selectedNode) return true;
    if (state.selectedNode && state.selectedNeighbors.has(node)) return true;
    if (state.searchMatch === node) return true;
    return Number(data.lod || 0) <= state.currentLod;
  }

  function installReducers() {
    state.renderer.setSetting("nodeReducer", (node, data) => {
      const res = { ...data };
      const visible = nodeIsVisible(node, data);
      if (!visible) {
        res.hidden = true;
        res.label = "";
        return res;
      }

      if (node === state.selectedNode) {
        res.highlighted = true;
        res.forceLabel = true;
        res.size = Math.max(data.size * 1.35, data.size + 2.5);
        return res;
      }

      if (state.selectedNode) {
        if (state.selectedNeighbors.has(node)) {
          res.forceLabel = true;
          res.size = Math.max(data.size * 1.1, data.size + 0.8);
        } else {
          res.color = "#c9d0d6";
          res.label = "";
        }
      } else {
        // Keep labels calmer than nodes: only stronger tiers are named automatically.
        const labelTier = Math.max(0, state.currentLod - 1);
        if (data.lod > labelTier) res.label = "";
      }
      return res;
    });

    state.renderer.setSetting("edgeReducer", (edge, data) => {
      const res = { ...data };
      const source = state.graph.source(edge);
      const target = state.graph.target(edge);
      const sourceData = state.graph.getNodeAttributes(source);
      const targetData = state.graph.getNodeAttributes(target);
      const endpointsVisible = nodeIsVisible(source, sourceData) && nodeIsVisible(target, targetData);
      const incident = state.selectedNode && (source === state.selectedNode || target === state.selectedNode);
      const normalVisible = Number(data.lod || 0) <= state.currentLod && endpointsVisible;

      if (!normalVisible && !incident && edge !== state.selectedEdge) {
        res.hidden = true;
        res.label = "";
        return res;
      }

      if (state.selectedNode) {
        if (incident) {
          res.color = "#355f84";
          res.size = Math.max(1.8, data.size * 1.8);
          res.label = data.relationLabel || "relationship";
          res.forceLabel = true;
        } else {
          res.color = "#e1e5e9";
          res.size = Math.max(0.3, data.size * 0.55);
          res.label = "";
        }
      } else if (edge === state.selectedEdge) {
        res.color = "#355f84";
        res.size = Math.max(2.0, data.size * 2);
        res.label = data.relationLabel || "relationship";
        res.forceLabel = true;
      } else {
        // At extreme zoom, relationship text appears automatically for edges in the viewport.
        const ratio = state.renderer.getCamera().getState().ratio;
        const zoomFactor = state.initialRatio / Math.max(ratio, 1e-9);
        if (state.currentLod === 3 && zoomFactor >= 14) {
          res.label = data.relationLabel || "relationship";
        } else {
          res.label = "";
        }
      }
      return res;
    });
  }

  function clearSelection({ keepSearch = false } = {}) {
    state.selectedNode = null;
    state.selectedEdge = null;
    state.selectedNeighbors.clear();
    state.selectedIncidentEdges.clear();
    state.selectedCommunity = null;
    if (!keepSearch) state.searchMatch = null;
    ui.detailsKind.textContent = "Selection";
    ui.detailsTitle.textContent = "노드 또는 관계를 클릭하세요";
    ui.detailsBody.innerHTML = state.viewMode === "community"
      ? '<p class="muted">Community 배경과 계층을 함께 보면서 Entity와 Relationship을 탐색할 수 있습니다.</p>'
      : '<p class="muted">확대할수록 더 작은 Entity와 Relationship이 단계적으로 나타납니다.</p>';
    state.renderer?.refresh({ skipIndexation: true });
    scheduleCommunityDraw();
  }

  function renderSources(sources) {
    if (!sources || !sources.length) return '<p class="muted">Source chunk 정보 없음</p>';
    return `<div class="chips">${sources.slice(0, 18).map((s) => `<span class="chip">${escapeHtml(s)}</span>`).join("")}</div>`;
  }

  function focusNode(nodeId, ratio = 0.12) {
    if (!state.graph.hasNode(nodeId)) return;
    const attrs = state.graph.getNodeAttributes(nodeId);
    state.renderer.getCamera().animate(
      { x: attrs.x, y: attrs.y, ratio },
      { duration: 550 },
    );
  }

  function selectCommunity(communityId) {
    if (state.viewMode !== "community") return;
    const community = state.communityMap.get(communityId);
    if (!community) return;
    state.selectedNode = null;
    state.selectedEdge = null;
    state.selectedNeighbors.clear();
    state.selectedIncidentEdges.clear();
    state.selectedCommunity = communityId;
    const parent = community.parent_id ? state.communityMap.get(community.parent_id) : null;
    const children = (community.children || []).map((id) => state.communityMap.get(id)).filter(Boolean).slice(0, 30);
    ui.detailsKind.textContent = "Community";
    ui.detailsTitle.textContent = community.title || community.community_id;
    ui.detailsBody.innerHTML = `
      <dl class="meta-grid">
        <dt>ID</dt><dd>${escapeHtml(community.community_id)}</dd>
        <dt>Level</dt><dd>${community.level}</dd>
        <dt>Entities</dt><dd>${fmt.format((community.nodes || []).length)}</dd>
        <dt>Parent</dt><dd>${parent ? `<button class="community-link" type="button" data-community-id="${escapeHtml(parent.community_id)}">${escapeHtml(parent.title || parent.community_id)}</button>` : "Root community"}</dd>
        <dt>Children</dt><dd>${fmt.format((community.children || []).length)}</dd>
      </dl>
      <div class="section-title">Community summary</div>
      ${community.summary ? `<p>${escapeHtml(community.summary)}</p>` : '<p class="muted">요약 없음</p>'}
      ${children.length ? `<div class="section-title">Child communities</div><div>${children.map((c) => `<button class="community-link block-link" type="button" data-community-id="${escapeHtml(c.community_id)}">L${c.level} · ${escapeHtml(c.title || c.community_id)} <span class="muted">(${fmt.format((c.nodes||[]).length)} entities)</span></button>`).join("")}</div>` : ""}
    `;
    for (const button of ui.detailsBody.querySelectorAll("[data-community-id]")) {
      button.addEventListener("click", () => selectCommunity(button.dataset.communityId));
    }
    state.renderer?.refresh({ skipIndexation: true });
    scheduleCommunityDraw();
  }

  function selectNode(nodeId, { focus = false } = {}) {
    if (!state.graph.hasNode(nodeId)) return;
    state.selectedEdge = null;
    state.selectedCommunity = null;
    state.selectedNode = nodeId;
    state.searchMatch = nodeId;
    state.selectedNeighbors = new Set(state.graph.neighbors(nodeId));
    state.selectedIncidentEdges = new Set(state.graph.edges(nodeId));
    const data = state.graph.getNodeAttributes(nodeId);
    const communities = data.communities || [];
    const descriptions = data.descriptions || [];
    const neighbors = [...state.selectedNeighbors]
      .map((id) => ({ id, ...state.graph.getNodeAttributes(id) }))
      .sort((a, b) => (b.degree || 0) - (a.degree || 0))
      .slice(0, 35);

    ui.detailsKind.textContent = "Entity";
    ui.detailsTitle.textContent = data.label || nodeId;
    ui.detailsBody.innerHTML = `
      <dl class="meta-grid">
        <dt>Type</dt><dd>${escapeHtml(data.entityType || "UNKNOWN")}</dd>
        <dt>Degree</dt><dd>${fmt.format(data.degree || 0)}</dd>
        <dt>Weighted degree</dt><dd>${fmt.format(data.weightedDegree || 0)}</dd>
        <dt>Mentions</dt><dd>${fmt.format(data.mentionCount || 0)}</dd>
        <dt>LOD</dt><dd>${detailNames[data.lod || 0]}</dd>
        ${state.viewMode === "community" ? `<dt>Community</dt><dd>${communities.length ? communities.map((c) => `<button class="community-link" type="button" data-community-id="${escapeHtml(c.id)}">L${c.level} · ${escapeHtml(c.title || c.id)}</button>`).join("<br>") : "Not available"}</dd>` : ""}
      </dl>
      <div class="section-title">Description</div>
      ${descriptions.length ? `<ul class="detail-list">${descriptions.map((d) => `<li>${escapeHtml(d)}</li>`).join("")}</ul>` : '<p class="muted">설명 없음</p>'}
      <div class="section-title">1-hop neighbors (${fmt.format(state.selectedNeighbors.size)})</div>
      <div>${neighbors.map((n) => `<button class="neighbor-button" type="button" data-node-id="${escapeHtml(n.id)}">${escapeHtml(n.label || n.id)} <span class="muted">· ${escapeHtml(n.entityType || "UNKNOWN")}</span></button>`).join("") || '<p class="muted">연결된 노드 없음</p>'}</div>
      <div class="section-title">Source chunks</div>
      ${renderSources(data.sources)}
    `;
    for (const button of ui.detailsBody.querySelectorAll("[data-node-id]")) {
      button.addEventListener("click", () => selectNode(button.dataset.nodeId, { focus: true }));
    }
    if (state.viewMode === "community") {
      for (const button of ui.detailsBody.querySelectorAll("[data-community-id]")) {
        button.addEventListener("click", () => selectCommunity(button.dataset.communityId));
      }
    }
    state.renderer.refresh({ skipIndexation: true });
    scheduleCommunityDraw();
    if (focus) focusNode(nodeId);
  }

  function selectEdge(edgeId) {
    if (!state.graph.hasEdge(edgeId)) return;
    state.selectedNode = null;
    state.selectedCommunity = null;
    state.selectedNeighbors.clear();
    state.selectedIncidentEdges.clear();
    state.selectedEdge = edgeId;
    const data = state.graph.getEdgeAttributes(edgeId);
    const source = state.graph.source(edgeId);
    const target = state.graph.target(edgeId);
    const s = state.graph.getNodeAttributes(source);
    const t = state.graph.getNodeAttributes(target);
    const directions = Object.entries(data.directionCounts || {}).sort((a, b) => b[1] - a[1]);

    ui.detailsKind.textContent = "Relationship";
    ui.detailsTitle.textContent = `${s.label || source} ↔ ${t.label || target}`;
    ui.detailsBody.innerHTML = `
      <dl class="meta-grid">
        <dt>Source</dt><dd>${escapeHtml(s.label || source)}</dd>
        <dt>Target</dt><dd>${escapeHtml(t.label || target)}</dd>
        <dt>Weight</dt><dd>${fmt.format(data.weight || 1)}</dd>
        <dt>LOD</dt><dd>${detailNames[data.lod || 0]}</dd>
      </dl>
      <div class="section-title">Relationship description</div>
      ${(data.descriptions || []).length ? `<ul class="detail-list">${data.descriptions.map((d) => `<li>${escapeHtml(d)}</li>`).join("")}</ul>` : '<p class="muted">설명 없음</p>'}
      ${directions.length ? `<div class="section-title">Extracted direction records</div><ul class="detail-list">${directions.map(([d, count]) => `<li>${escapeHtml(d)} <span class="muted">×${count}</span></li>`).join("")}</ul>` : ""}
      <div class="section-title">Source chunks</div>
      ${renderSources(data.sources)}
    `;
    state.renderer.refresh({ skipIndexation: true });
    scheduleCommunityDraw();
  }

  function renderSearchResults(query) {
    const q = normalizeText(query.trim());
    if (!q) {
      ui.searchResults.hidden = true;
      ui.searchResults.innerHTML = "";
      return;
    }
    const starts = [];
    const contains = [];
    for (const node of state.graph.nodes()) {
      const data = state.graph.getNodeAttributes(node);
      const label = normalizeText(data.label);
      if (label.startsWith(q)) starts.push({ id: node, data });
      else if (label.includes(q) || normalizeText(node).includes(q)) contains.push({ id: node, data });
      if (starts.length + contains.length > 80) break;
    }
    const results = starts.concat(contains)
      .sort((a, b) => (a.data.rank || 999999) - (b.data.rank || 999999))
      .slice(0, 10);
    if (!results.length) {
      ui.searchResults.innerHTML = '<div class="search-result"><span>검색 결과 없음</span></div>';
      ui.searchResults.hidden = false;
      return;
    }
    ui.searchResults.innerHTML = results.map(({ id, data }) => `
      <button class="search-result" type="button" data-search-id="${escapeHtml(id)}">
        <span>${escapeHtml(data.label || id)}</span>
        <small>${escapeHtml(data.entityType || "UNKNOWN")} · degree ${data.degree || 0}</small>
      </button>
    `).join("");
    ui.searchResults.hidden = false;
    for (const button of ui.searchResults.querySelectorAll("[data-search-id]")) {
      button.addEventListener("click", () => {
        const id = button.dataset.searchId;
        ui.search.value = state.graph.getNodeAttribute(id, "label") || id;
        ui.searchResults.hidden = true;
        state.searchMatch = id;
        selectNode(id, { focus: true });
      });
    }
  }

  function applyLayout(mode, { resetCamera = true } = {}) {
    if (!state.graph || !state.renderer) return;
    const target = mode === "community" ? "community" : "kg";
    if (state.layoutMode === target) return;
    state.layoutMode = target;

    for (const nodeId of state.graph.nodes()) {
      const a = state.graph.getNodeAttributes(nodeId);
      const x = target === "community" ? a.communityX : a.kgX;
      const y = target === "community" ? a.communityY : a.kgY;
      state.graph.mergeNodeAttributes(nodeId, { x, y });
    }

    // A full refresh recomputes Sigma's spatial index/normalization for the new fixed layout.
    state.renderer.refresh();
    buildCommunityHulls();
    scheduleCommunityDraw();
    if (resetCamera) {
      state.renderer.getCamera().animatedReset({ duration: 420 });
    }
  }

  function setViewMode(mode, { updateHash = true, resetCommunitySelection = true, resetCamera = true } = {}) {
    const next = mode === "community" ? "community" : "kg";
    state.viewMode = next;
    document.body.dataset.view = next;
    applyLayout(next, { resetCamera });

    const isCommunity = next === "community";
    ui.modeKG.classList.toggle("active", !isCommunity);
    ui.modeCommunity.classList.toggle("active", isCommunity);
    ui.modeKG.setAttribute("aria-pressed", String(!isCommunity));
    ui.modeCommunity.setAttribute("aria-pressed", String(isCommunity));
    ui.communityLevel.disabled = !isCommunity;
    ui.communityLevelControl.hidden = !isCommunity;
    ui.communityCanvas.hidden = !isCommunity;

    if (isCommunity) {
      ui.pageSubtitle.textContent = "Entity · Relationship · Hierarchical Leiden Community · Frontier Semantic Zoom";
      ui.communityStatLabel.textContent = "Communities";
      ui.statCommunities.textContent = state.payload?.meta?.has_communities
        ? fmt.format(state.payload.meta.community_count || 0)
        : "Pending";
      ui.graphHelp.textContent = "Wheel: zoom · Drag: pan · Community frontier changes with zoom · Node positions stay fixed";
      ui.viewNote.textContent = state.payload?.meta?.has_communities
        ? `Community KG 모드입니다. 같은 Community의 Entity가 공간적으로 가까워지도록 별도 고정 layout을 사용합니다. Auto에서는 확대할수록 각 Entity가 가진 가장 깊은 Community까지만 L0 → L1 → L2 → L3으로 세분화되는 hierarchy frontier를 표시합니다.`
        : "Community KG 모드이지만 Community 데이터가 없습니다.";
    } else {
      ui.pageSubtitle.textContent = "Entity · Relationship · Semantic Zoom";
      ui.communityStatLabel.textContent = "Community layer";
      ui.statCommunities.textContent = "Off";
      ui.graphHelp.textContent = "Wheel: zoom · Drag: pan · Click node/relationship: details";
      ui.viewNote.textContent = "Knowledge Graph 모드입니다. Community 배경은 숨기고 Entity와 Relationship만 표시합니다.";
    }

    if (resetCommunitySelection && state.selectedCommunity) {
      state.selectedCommunity = null;
      clearSelection({ keepSearch: true });
    } else if (state.selectedNode) {
      selectNode(state.selectedNode);
    } else if (state.selectedEdge) {
      selectEdge(state.selectedEdge);
    }

    state.renderer?.refresh({ skipIndexation: true });
    scheduleCommunityDraw();

    if (updateHash) {
      const hash = isCommunity ? "#community" : "#kg";
      if (location.hash !== hash) history.replaceState(null, "", hash);
    }
  }

  function populateTypeControls(payload) {
    const typeCounts = payload.meta.type_counts || {};
    for (const [type, count] of Object.entries(typeCounts)) {
      const option = document.createElement("option");
      option.value = type;
      option.textContent = `${type} (${fmt.format(count)})`;
      ui.typeFilter.appendChild(option);
    }

    const colors = new Map();
    for (const node of payload.nodes) {
      if (!colors.has(node.type)) colors.set(node.type, node.color);
    }
    ui.legend.innerHTML = [...colors.entries()].slice(0, 12).map(([type, color]) => `
      <span class="legend-item"><span class="legend-swatch" style="background:${escapeHtml(color)}"></span>${escapeHtml(type)}</span>
    `).join("");
  }

  function buildGraph(payload) {
    const GraphCtor = window.graphology?.Graph;
    if (!GraphCtor || !window.Sigma) {
      throw new Error("Sigma.js 또는 Graphology CDN을 불러오지 못했습니다. 인터넷 연결/CDN 접근을 확인하세요.");
    }
    const graph = new GraphCtor({ type: "undirected", multi: false, allowSelfLoops: false });
    for (const node of payload.nodes) {
      graph.addNode(node.id, {
        label: node.label,
        x: node.x,
        y: node.y,
        kgX: node.x,
        kgY: node.y,
        communityX: Number.isFinite(node.community_x) ? node.community_x : node.x,
        communityY: Number.isFinite(node.community_y) ? node.community_y : node.y,
        size: node.size,
        color: node.color,
        entityType: node.type,
        lod: node.lod,
        rank: node.rank,
        degree: node.degree,
        weightedDegree: node.weighted_degree,
        mentionCount: node.mention_count,
        descriptions: node.descriptions || [],
        sources: node.sources || [],
        communities: node.communities || [],
      });
    }
    for (const edge of payload.edges) {
      if (!graph.hasNode(edge.source) || !graph.hasNode(edge.target)) continue;
      if (graph.hasEdge(edge.source, edge.target)) continue;
      graph.addEdgeWithKey(edge.id, edge.source, edge.target, {
        size: edge.size,
        color: "#b7c0c8",
        type: "line",
        label: "",
        relationLabel: edge.label,
        lod: edge.lod,
        weight: edge.weight,
        descriptions: edge.descriptions || [],
        sources: edge.sources || [],
        directionCounts: edge.direction_counts || {},
      });
    }
    return graph;
  }

  async function init() {
    // Never allow the error UI to cover the graph canvas. It is a non-blocking banner only.
    ui.graphError.hidden = true;
    ui.graphError.style.display = "none";
    ui.graphError.textContent = "";
    try {
      const response = await fetch("./data/graph.json", { cache: "no-cache" });
      if (!response.ok) throw new Error(`graph.json HTTP ${response.status}`);
      const payload = await response.json();
      state.payload = payload;
      state.communityMap = new Map((payload.communities || []).map((c) => [c.community_id, c]));
      state.graph = buildGraph(payload);

      ui.statNodes.textContent = fmt.format(payload.meta.node_count || state.graph.order);
      ui.statEdges.textContent = fmt.format(payload.meta.edge_count || state.graph.size);
      ui.loadStatus.textContent = `${fmt.format(state.graph.order)} entities loaded`;
      populateTypeControls(payload);

      const renderer = new window.Sigma(state.graph, ui.container, {
        renderLabels: true,
        renderEdgeLabels: true,
        enableEdgeEvents: true,
        hideEdgesOnMove: true,
        hideLabelsOnMove: true,
        labelFont: "system-ui, sans-serif",
        labelSize: 12,
        labelWeight: "500",
        labelColor: { color: "#26333f" },
        edgeLabelFont: "system-ui, sans-serif",
        edgeLabelSize: 10,
        edgeLabelColor: { color: "#52616e" },
        labelDensity: 0.7,
        labelGridCellSize: 120,
        labelRenderedSizeThreshold: 5,
        minCameraRatio: 0.025,
        maxCameraRatio: 2.8,
        zIndex: true,
      });
      state.renderer = renderer;
      state.initialRatio = renderer.getCamera().getState().ratio || 1;
      installReducers();
      buildCommunityHulls();

      const initialMode = location.hash.toLowerCase() === "#community" ? "community" : "kg";
      setViewMode(initialMode, { updateHash: false, resetCommunitySelection: false, resetCamera: false });
      updateZoomState();

      renderer.on("clickNode", ({ node }) => selectNode(node));
      renderer.on("clickEdge", ({ edge }) => selectEdge(edge));
      renderer.on("clickStage", () => clearSelection({ keepSearch: true }));
      renderer.getCamera().on("updated", updateZoomState);

      ui.modeKG.addEventListener("click", () => setViewMode("kg"));
      ui.modeCommunity.addEventListener("click", () => setViewMode("community"));
      window.addEventListener("hashchange", () => {
        setViewMode(location.hash.toLowerCase() === "#community" ? "community" : "kg", { updateHash: false });
      });

      ui.zoomIn.addEventListener("click", () => renderer.getCamera().animatedZoom(1.7));
      ui.zoomOut.addEventListener("click", () => renderer.getCamera().animatedUnzoom(1.7));
      ui.reset.addEventListener("click", async () => {
        clearSelection();
        ui.search.value = "";
        ui.searchResults.hidden = true;
        await renderer.getCamera().animatedReset({ duration: 450 });
      });
      ui.detailMode.addEventListener("change", () => {
        state.detailMode = ui.detailMode.value;
        updateZoomState();
      });
      ui.communityLevel.addEventListener("change", () => {
        state.communityLevelMode = ui.communityLevel.value;
        if (state.viewMode === "community") scheduleCommunityDraw();
      });
      ui.typeFilter.addEventListener("change", () => {
        state.typeFilter = ui.typeFilter.value;
        renderer.refresh({ skipIndexation: true });
        scheduleCommunityDraw();
      });
      ui.search.addEventListener("input", () => renderSearchResults(ui.search.value));
      ui.search.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        const first = ui.searchResults.querySelector("[data-search-id]");
        if (first) {
          event.preventDefault();
          first.click();
        }
      });
      document.addEventListener("click", (event) => {
        if (!ui.searchResults.contains(event.target) && event.target !== ui.search) ui.searchResults.hidden = true;
      });
      window.addEventListener("resize", scheduleCommunityDraw, { passive: true });

      ui.graphError.hidden = true;
      ui.graphError.style.display = "none";
      ui.loadStatus.textContent = payload.meta.has_communities ? "Graph + hierarchy frontier ready · v2" : "Graph ready · communities pending";
    } catch (error) {
      console.error(error);
      const fileHint = location.protocol === "file:"
        ? "\n\n이 페이지는 file:// 로 직접 열지 말고 GitHub Pages 또는 로컬 HTTP 서버에서 여세요.\n예: python -m http.server 8000 -d docs"
        : "";
      setError(`KG Viewer를 시작하지 못했습니다.\n${error.message}${fileHint}`);
    }
  }

  init();
})();
