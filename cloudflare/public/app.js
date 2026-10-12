const root = document.querySelector("#root");
const toastRegion = document.querySelector("#toast-region");

const ICON_PATHS = {
  home: '<path d="m3 11 9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  chat: '<path d="M20 15a4 4 0 0 1-4 4H9l-5 3v-7a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4h12a4 4 0 0 1 4 4z"/><path d="M7 9h.01M12 9h.01M17 9h.01"/>',
  schema: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v7c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12v7c0 1.7 3.6 3 8 3s8-1.3 8-3v-7"/>',
  book: '<path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v18H6.5A2.5 2.5 0 0 0 4 22z"/><path d="M4 4.5V20"/>',
  template: '<path d="M8 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-3M14 3h7v7M10 14 21 3"/>',
  insight: '<path d="M4 19V9M10 19V5M16 19v-7M22 19H2"/>',
  usage: '<path d="M4 19V9M10 19V5M16 19v-3M22 19H2"/><path d="M4 5h12"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  shield: '<path d="M12 22s8-3.7 8-10V5l-8-3-8 3v7c0 6.3 8 10 8 10"/><path d="m9 12 2 2 4-4"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.12 2.12-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V20.3h-3v-.08A1.7 1.7 0 0 0 10.67 18.66a1.7 1.7 0 0 0-1.88.34l-.06.06-2.12-2.12.06-.06A1.7 1.7 0 0 0 7 15a1.7 1.7 0 0 0-1.56-1.03h-.08v-3h.08A1.7 1.7 0 0 0 7 9.93a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.12-2.12.06.06a1.7 1.7 0 0 0 1.88.34 1.7 1.7 0 0 0 1.03-1.56V4.6h3v.08a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.88-.34l.06-.06 2.12 2.12-.06.06A1.7 1.7 0 0 0 19.4 9.9a1.7 1.7 0 0 0 1.56 1.03h.08v3h-.08A1.7 1.7 0 0 0 19.4 15Z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="m20 20-4.2-4.2"/>',
  more: '<circle cx="5" cy="12" r="1" fill="currentColor"/><circle cx="12" cy="12" r="1" fill="currentColor"/><circle cx="19" cy="12" r="1" fill="currentColor"/>',
  pin: '<path d="M12 17v5M7 3h10l-2 6 3 3H6l3-3z"/>',
  archive: '<path d="M3 7h18v14H3zM2 3h20v4H2zM10 12h4"/>',
  edit: '<path d="m4 20 4.2-1 10.6-10.6a2.1 2.1 0 0 0-3-3L5.2 16zM14.5 6.7l3 3"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M9 7l1-3h4l1 3M6 7l1 14h10l1-14"/>',
  export: '<path d="M12 3v12M8 11l4 4 4-4M4 21h16"/>',
  copy: '<rect x="8" y="8" width="11" height="11" rx="1"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  send: '<path d="m21 3-8.6 18-2.2-7.2L3 11.6z"/><path d="m10.2 13.8 4.5-4.5"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  warning: '<path d="M12 3 2.8 20h18.4zM12 9v4M12 17h.01"/>',
  logout: '<path d="M10 17l5-5-5-5M15 12H3M21 19V5a2 2 0 0 0-2-2h-5"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 3v5h5M12 7v5l3 2"/>',
  branch: '<path d="M6 3v12M6 7h12M6 15h12"/><circle cx="6" cy="3" r="2"/><circle cx="18" cy="7" r="2"/><circle cx="18" cy="15" r="2"/>',
};

const CAPABILITY_LABELS = {
  chat: "AI 對話與唯讀查詢", view_schema: "查看資料綱要", view_dictionary: "查看商業字典", view_templates: "使用查詢範本",
  manage_own_sessions: "管理自己的對話", manage_own_insights: "管理自己的洞察", view_own_usage: "查看個人用量",
  export: "匯出 CSV", manage_templates: "維護查詢範本", manage_dictionary: "維護商業字典",
  refresh_schema: "重新掃描 D1 Schema", manage_users: "管理工作區與成員",
};
const ROLE_NAMES = ["viewer", "analyst", "editor", "dba", "owner"];
Object.assign(CAPABILITY_LABELS, {
  view_semantics: "檢視語意治理",
  manage_semantic_drafts: "管理語意草稿",
  review_semantics: "審查語意定義",
});
const PRODUCT_CAPABILITIES = Object.keys(CAPABILITY_LABELS);
const PAGE_TITLES = {
  dashboard: ["工作總覽", "個人資料分析工作台"], chat: ["Ask QueryMind", "以自然語言探索單一受控 D1"],
  history: ["History", "找回並繼續先前的資料分析對話"], library: ["Library", "查詢範本、已儲存洞察與商業詞彙"],
  schema: ["資料綱要", "AI 可理解的資料結構與關聯概念"], dictionary: ["資料字典", "工作區共用的商業定義"],
  templates: ["查詢範本", "可重複使用的資料問題"], insights: ["我的洞察", "個人已儲存的資料探索"],
  usage: ["我的用量", "滾動 24 小時使用摘要"], source: ["資料來源", "單一受控的 Cloudflare D1"],
  "admin-overview": ["管理總覽", "Owner 專用工作區管理"], "admin-users": ["使用者", "帳號、角色與 API Key 管理"],
  "admin-roles": ["角色與權限", "五個內建角色與產品能力"], "admin-semantic-authorities": ["Semantic Authorities", "具名的人類 RACI 與核准範圍"], "admin-semantic-policies": ["Approval Policies", "風險、quorum 與 Separation of Duties"], "admin-invitations": ["邀請", "新成員加入工作區"],
  "admin-audit": ["稽核紀錄", "最近 200 筆工作區活動"], "admin-system": ["系統設定", "Cloudflare Free 相容的執行狀態"],
  profile: ["個人設定", "帳戶與安全性"],
};
const state = {
  user: null, page: "chat", navRoute: "chat", sessions: [], activeSession: null, messages: [], result: null, cache: new Map(),
  sidebarOpen: false, pendingPrompt: "", chatDraft: "", chatFailure: null, sending: false, archiveMode: false, resultTabs: new Map(), renderId: 0,
  userFilter: "", roleFilter: "all", inviteToken: "", savedAnalysisRuns: new Set(), savingAnalysisRuns: new Set(),
};
Object.assign(PAGE_TITLES, {
  semantics: ["Definitions", "以草稿與審查流程維護企業語意定義"],
  definitions: ["Definitions", "以草稿與審查流程維護企業語意定義"],
  "needs-review": ["Needs Review", "查看等待治理審查的語意定義"],
});
Object.assign(state, {
  semanticFilters: { search: "", type: "", assetStatus: "", revisionStatus: "", domain: "", page: 1, limit: 25 },
  semanticAssetId: null,
  semanticDetailTab: "overview",
  semanticMutationPending: false,
  semanticWorkspace: "assets",
  semanticSuggestionFilters: { status: "OPEN", type: "", stale: "", page: 1, limit: 30 },
});

function icon(name, cls = "") { return `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICON_PATHS[name] || ""}</svg>`; }
function esc(value) { return String(value ?? "").replace(/[&<>'"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[ch]); }
function inlineMarkdown(value) {
  let html = esc(value);
  html = html.replace(/`([^`\n]+)`/gu, "<code>$1</code>");
  html = html.replace(/\*\*([^*\n]+)\*\*/gu, "<strong>$1</strong>");
  html = html.replace(/__([^_\n]+)__/gu, "<strong>$1</strong>");
  html = html.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/gu, "$1<em>$2</em>");
  return html;
}
function renderMarkdown(value) {
  const lines = String(value ?? "").split(/\r?\n/u);
  const output = [];
  let listType = null;
  const closeList = () => { if (listType) { output.push(`</${listType}>`); listType = null; } };
  for (const line of lines) {
    const unordered = /^\s*[-*]\s+(.+)$/u.exec(line);
    const ordered = /^\s*\d+[.)]\s+(.+)$/u.exec(line);
    const item = unordered || ordered;
    if (item) {
      const nextType = unordered ? "ul" : "ol";
      if (listType !== nextType) { closeList(); output.push(`<${nextType}>`); listType = nextType; }
      output.push(`<li>${inlineMarkdown(item[1])}</li>`);
    } else if (line.trim()) {
      closeList();
      output.push(`<p>${inlineMarkdown(line)}</p>`);
    } else {
      closeList();
    }
  }
  closeList();
  return output.join("");
}
function has(capability) { return Boolean(state.user?.capabilities?.includes("*") || state.user?.capabilities?.includes(capability)); }
function fmtDate(value, empty = "—") { return value ? new Intl.DateTimeFormat("zh-TW", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : empty; }
function shortDate(value) { return value ? new Intl.DateTimeFormat("zh-TW", { month: "short", day: "numeric" }).format(new Date(value)) : "—"; }
function toast(message, tone = "ok") { const item = document.createElement("div"); item.className = `toast ${tone}`; item.innerHTML = `${icon(tone === "error" ? "warning" : "check")}${esc(message)}`; toastRegion.append(item); setTimeout(() => item.remove(), 4600); }
const ROUTE_ALIASES = { ask: "chat", dashboard: "chat", definitions: "semantics", "needs-review": "semantics" };
const PAGE_CAPABILITIES = { chat: "chat", history: "manage_own_sessions", schema: "view_schema", dictionary: "view_dictionary", templates: "view_templates", insights: "manage_own_insights", usage: "view_own_usage", source: "refresh_schema", "admin-overview": "manage_users", "admin-users": "manage_users", "admin-roles": "manage_users", "admin-semantic-authorities": "manage_semantic_governance", "admin-semantic-policies": "manage_semantic_governance", "admin-invitations": "manage_users", "admin-audit": "manage_users", "admin-system": "manage_users", definitions: "view_semantics" };
Object.assign(PAGE_CAPABILITIES, { semantics: "view_semantics" });
function pageAllowed(page) {
  const target = ROUTE_ALIASES[page] || page;
  if (page === "library") return has("view_templates") || has("manage_own_insights") || has("view_dictionary");
  if (page === "needs-review") return has("view_semantics") && has("review_semantics");
  const capability = PAGE_CAPABILITIES[page] || PAGE_CAPABILITIES[target];
  return Boolean(PAGE_TITLES[page] || PAGE_TITLES[target]) && (!capability || has(capability));
}
function defaultPage() { return pageAllowed("chat") ? "chat" : "profile"; }
function prepareRoute(route) {
  state.navRoute = route;
  if (route === "needs-review") {
    state.semanticWorkspace = "assets"; state.semanticAssetId = null; state.semanticDetailTab = "overview";
    state.semanticFilters = { ...state.semanticFilters, revisionStatus: "IN_REVIEW", page: 1 };
  } else if (route === "definitions" || route === "semantics") {
    state.semanticWorkspace = "assets"; state.semanticAssetId = null; state.semanticDetailTab = "overview";
    if (state.semanticFilters.revisionStatus === "IN_REVIEW") state.semanticFilters = { ...state.semanticFilters, revisionStatus: "", page: 1 };
  }
}
function pageFromLocation() {
  const route = location.hash.replace(/^#\/?/u, "") || "chat";
  if (!pageAllowed(route)) {
    const fallback = defaultPage(); state.navRoute = fallback;
    history.replaceState({}, "", `${location.pathname}#/${fallback}`);
    return fallback;
  }
  prepareRoute(route);
  if (!location.hash) history.replaceState({}, "", `${location.pathname}#/${route}`);
  return ROUTE_ALIASES[route] || route;
}
function go(page, options = {}) {
  const route = options.route || page;
  if (!pageAllowed(route)) { toast("你的角色無法使用此功能", "error"); return; }
  if (options.pendingPrompt !== undefined) state.pendingPrompt = options.pendingPrompt;
  if (options.resetSession) { state.activeSession = null; state.messages = []; state.result = null; state.chatFailure = null; state.chatDraft = options.pendingPrompt || ""; }
  prepareRoute(route);
  const hash = `#/${route}`;
  if (location.hash === hash) { state.page = ROUTE_ALIASES[route] || route; void render(); } else location.hash = hash;
}
function invalidate(...keys) { keys.forEach((key) => state.cache.delete(key)); }

async function api(path, options = {}) {
  const response = await fetch(path, { credentials: "same-origin", headers: { "content-type": "application/json", ...(options.headers || {}) }, ...options });
  if (!response.ok) { const data = await response.json().catch(() => ({})); const error = new Error(data.message || `HTTP ${response.status}`); error.code = data.error; error.referenceId = data.referenceId; if (response.status === 401 && state.user) { state.user = null; state.cache.clear(); state.activeSession = null; state.messages = []; state.result = null; error.authExpired = true; showAuth(); toast("登入已過期，請重新登入", "error"); } throw error; }
  const type = response.headers.get("content-type") || "";
  return type.includes("application/json") ? response.json() : response.text();
}
async function load(key, endpoint) { if (!state.cache.has(key)) state.cache.set(key, api(endpoint)); try { return await state.cache.get(key); } catch (error) { state.cache.delete(key); throw error; } }
async function loadSessions() { const data = await api(`/api/v1/sessions${state.archiveMode ? "?archived=true" : ""}`); state.sessions = data.sessions || []; }
async function loadMessages(id) { const data = await api(`/api/v1/sessions/${id}/messages`); state.messages = (data.messages || []).map((message) => ({ ...message, metadata: parseMetadata(message.metadata_json) })); }
function parseMetadata(value) { try { const parsed = JSON.parse(value || "{}"); return parsed && typeof parsed === "object" ? parsed : {}; } catch { return {}; } }

const NAVIGATION = [
  {
    id: "business", label: "Business Workspace", items: [
      { id: "ask", label: "Ask QueryMind", icon: "chat", page: "chat", route: "chat", requiredCapabilities: ["chat"], activeRoutes: ["chat", "ask", "dashboard"] },
      { id: "history", label: "History", icon: "history", page: "history", route: "history", requiredCapabilities: ["manage_own_sessions"] },
      { id: "library", label: "Library", icon: "book", page: "library", route: "library", anyCapabilities: ["view_templates", "manage_own_insights", "view_dictionary"], activeRoutes: ["library", "templates", "insights", "dictionary"] },
    ],
  },
  {
    id: "governance", label: "Governance", kind: "disclosure", icon: "layers", children: [
      { id: "definitions", label: "Definitions", icon: "layers", page: "semantics", route: "definitions", requiredCapabilities: ["view_semantics"], activeRoutes: ["definitions", "semantics"] },
      { id: "needs-review", label: "Needs Review", icon: "check", page: "semantics", route: "needs-review", requiredCapabilities: ["view_semantics", "review_semantics"] },
      { id: "data-sources", label: "Data Sources", kind: "disclosure", icon: "schema", children: [
        { id: "schema", label: "Schema Catalog", icon: "schema", page: "schema", route: "schema", requiredCapabilities: ["view_schema"] },
        { id: "source", label: "Connection Status", icon: "settings", page: "source", route: "source", requiredCapabilities: ["refresh_schema"] },
      ] },
      { id: "access", label: "Access", kind: "disclosure", icon: "users", children: [
        { id: "admin-users", label: "Users & API Keys", icon: "users", page: "admin-users", route: "admin-users", requiredCapabilities: ["manage_users"] },
        { id: "admin-roles", label: "Roles & Permissions", icon: "shield", page: "admin-roles", route: "admin-roles", requiredCapabilities: ["manage_users"] },
        { id: "admin-invitations", label: "Invitations", icon: "plus", page: "admin-invitations", route: "admin-invitations", requiredCapabilities: ["manage_users"] },
      ] },
      { id: "audit-system", label: "Audit & System", kind: "disclosure", icon: "settings", children: [
        { id: "admin-overview", label: "Workspace Overview", icon: "home", page: "admin-overview", route: "admin-overview", requiredCapabilities: ["manage_users"] },
        { id: "admin-audit", label: "Audit Log", icon: "usage", page: "admin-audit", route: "admin-audit", requiredCapabilities: ["manage_users"] },
        { id: "admin-system", label: "System Status", icon: "settings", page: "admin-system", route: "admin-system", requiredCapabilities: ["manage_users"] },
        { id: "admin-semantic-authorities", label: "Semantic Authorities", icon: "users", page: "admin-semantic-authorities", route: "admin-semantic-authorities", requiredCapabilities: ["manage_semantic_governance"] },
        { id: "admin-semantic-policies", label: "Approval Policies", icon: "shield", page: "admin-semantic-policies", route: "admin-semantic-policies", requiredCapabilities: ["manage_semantic_governance"] },
      ] },
    ],
  },
];
function navNodeAllowed(node) {
  if (node.children) return node.children.some(navNodeAllowed);
  if ((node.requiredCapabilities || []).some((capability) => !has(capability))) return false;
  if (node.anyCapabilities?.length && !node.anyCapabilities.some(has)) return false;
  return true;
}
function navNodeActive(node) {
  if (node.children) return node.children.some(navNodeActive);
  return (node.activeRoutes || [node.route]).includes(state.navRoute);
}
function navItem(item, nested = false) {
  const active = navNodeActive(item);
  return `<button class="nav-item${nested ? " nav-item-nested" : ""}${active ? " active" : ""}" data-page="${item.page}" data-route="${item.route}" aria-current="${active ? "page" : "false"}">${icon(item.icon)}<span>${esc(item.label)}</span></button>`;
}
function navDisclosure(node, nested = false) {
  const children = node.children.filter(navNodeAllowed);
  if (!children.length) return "";
  const active = children.some(navNodeActive);
  const className = `nav-disclosure${nested ? " nav-disclosure-nested" : " nav-disclosure-primary"}${active ? " has-active" : ""}`;
  return `<details class="${className}" data-nav-group="${node.id}" ${active ? "open" : ""}><summary><span class="nav-disclosure-label">${icon(node.icon)}<span>${esc(node.label)}</span></span><span class="nav-disclosure-chevron" aria-hidden="true">›</span></summary><div class="nav-children">${children.map((child) => child.children ? navDisclosure(child, true) : navItem(child, true)).join("")}</div></details>`;
}
function navigationMarkup() {
  const business = NAVIGATION.find((group) => group.id === "business");
  const governance = NAVIGATION.find((group) => group.id === "governance");
  return `<div class="nav-section">${esc(business.label)}</div>${business.items.filter(navNodeAllowed).map((item) => navItem(item)).join("")}${navDisclosure(governance)}`;
}
function shell(content, page = state.page) {
  const [title, subtitle] = PAGE_TITLES[page] || PAGE_TITLES.dashboard;
  const initial = esc((state.user?.displayName || state.user?.email || "Q").slice(0, 1).toUpperCase());
  return `<div class="app-shell ${state.sidebarOpen ? "sidebar-open" : ""}">
    <button class="scrim" data-action="close-sidebar" aria-label="關閉選單"></button>
    <aside class="sidebar"><div class="brand"><span class="brand-mark">Q</span><span>QueryMind</span></div>
      <nav aria-label="主要選單">${navigationMarkup()}</nav>
      <button class="account-card${["profile", "usage"].includes(state.page) ? " active" : ""}" data-page="profile" aria-current="${["profile", "usage"].includes(state.page) ? "page" : "false"}"><span class="avatar">${initial}</span><span><b>${esc(state.user?.displayName || "QueryMind user")}</b><small>${esc(state.user?.roleName || "member")}</small></span>${icon("chevron")}</button>
    </aside>
    <main class="main"><header class="topbar"><div class="topbar-left"><button class="mobile-menu" data-action="open-sidebar" aria-label="開啟選單">${icon("more")}</button><div><h1>${title}</h1><p>${subtitle}</p></div></div><div class="topbar-right"><span class="readonly-chip">${icon("shield")}唯讀 D1</span><button class="profile-trigger" data-page="profile" aria-label="開啟個人設定"><span class="avatar">${initial}</span></button></div></header><div class="page">${content}</div></main></div>`;
}
function empty(title, detail, action = "") { return `<section class="empty"><span class="empty-icon">${icon("insight")}</span><h2>${esc(title)}</h2><p>${esc(detail)}</p>${action}</section>`; }
const RESULT_COLUMN_LABELS = {
  product: "商品",
  product_name: "商品名稱",
  sales_amount: "銷售額",
  sales_revenue: "銷售額",
  revenue: "營收",
  order_count: "訂單數量",
  count: "數量",
  shipping_city: "出貨城市",
  city: "城市",
  customer_name: "客戶名稱",
  status: "狀態",
};
function resultColumnLabel(column) {
  const key = String(column ?? "").replace(/^.*\./u, "").toLowerCase();
  if (RESULT_COLUMN_LABELS[key]) return RESULT_COLUMN_LABELS[key];
  return key.replace(/[_-]+/gu, " ").replace(/\b\w/gu, (match) => match.toUpperCase()) || "欄位";
}
function table(headers, rows, className = "") { return `<div class="table-wrap"><table class="${className}"><thead><tr>${headers.map((head) => `<th>${esc(head)}</th>`).join("")}</tr></thead><tbody>${rows || `<tr><td colspan="${headers.length}" class="table-empty">目前沒有資料</td></tr>`}</tbody></table></div>`; }
function button(label, options = {}) { return `<button class="button ${options.kind || "secondary"}" ${options.attrs || ""}>${options.icon ? icon(options.icon) : ""}${label}</button>`; }
function status(text, tone = "neutral") { return `<span class="status ${tone}">${esc(text)}</span>`; }
const FEEDBACK_TARGET_LABELS = { WHOLE_ANSWER: "整體回答", INTENT: "問題理解", METRIC: "指標", DIMENSION: "維度", FILTER: "篩選條件", SOURCE: "資料來源", CALCULATION: "計算方式", PRESENTATION: "結果呈現" };
const FEEDBACK_CATEGORY_LABELS = { interpretation: "問題理解不正確", metric: "指標定義不符合需求", dimension: "維度不正確", filter: "篩選條件不正確或遺漏", source: "資料來源不符合需求", calculation: "計算方式有問題", incomplete: "結果資料不完整", scope: "資料範圍不符合需求", presentation: "結果呈現需要改善", other: "其他" };
function feedbackTargetOptions(explain, selected = "WHOLE_ANSWER::") {
  const options = [{ type: "WHOLE_ANSWER", ref: "", label: FEEDBACK_TARGET_LABELS.WHOLE_ANSWER }];
  const understanding = explain.understanding || {};
  if (understanding.intent) options.push({ type: "INTENT", ref: understanding.intent, label: FEEDBACK_TARGET_LABELS.INTENT });
  for (const metric of Array.isArray(understanding.metrics) ? understanding.metrics : []) options.push({ type: "METRIC", ref: metric, label: `${FEEDBACK_TARGET_LABELS.METRIC}：${metric}` });
  for (const dimension of Array.isArray(understanding.dimensions) ? understanding.dimensions : []) options.push({ type: "DIMENSION", ref: dimension, label: `${FEEDBACK_TARGET_LABELS.DIMENSION}：${dimension}` });
  for (const filter of Array.isArray(understanding.filters) ? understanding.filters : []) options.push({ type: "FILTER", ref: filter, label: `${FEEDBACK_TARGET_LABELS.FILTER}：${filter}` });
  for (const source of Array.isArray(explain.sources?.tables) ? explain.sources.tables : []) if (source?.name) options.push({ type: "SOURCE", ref: source.name, label: `${FEEDBACK_TARGET_LABELS.SOURCE}：${source.label || source.name}` });
  if (explain.explanation?.business) options.push({ type: "CALCULATION", ref: "calculation", label: FEEDBACK_TARGET_LABELS.CALCULATION });
  if (explain.summary?.headline) options.push({ type: "PRESENTATION", ref: "result", label: FEEDBACK_TARGET_LABELS.PRESENTATION });
  return options.map((option) => { const value = `${option.type}::${encodeURIComponent(option.ref)}`; return `<option value="${esc(value)}" ${value === selected ? "selected" : ""}>${esc(option.label)}</option>`; }).join("");
}
function feedbackCategoryOptions() { return Object.entries(FEEDBACK_CATEGORY_LABELS).map(([value, label]) => `<option value="${value}">${label}</option>`).join(""); }
function feedbackTargetValue(type, ref = "") { return `${type}::${encodeURIComponent(ref)}`; }
function parseFeedbackTarget(value) { const separator = value.indexOf("::"); const type = separator < 0 ? "WHOLE_ANSWER" : value.slice(0, separator); const encoded = separator < 0 ? "" : value.slice(separator + 2); return { type, ref: encoded ? decodeURIComponent(encoded) : null }; }
function feedbackStatus(box, message, tone = "ok") {
  let statusNode = box.querySelector("[data-feedback-status]");
  if (!statusNode) { statusNode = document.createElement("small"); statusNode.dataset.feedbackStatus = "true"; box.append(statusNode); }
  statusNode.className = `feedback-status ${tone}`; statusNode.textContent = message; statusNode.setAttribute("role", tone === "error" ? "alert" : "status");
}
async function submitFeedback(box) {
  if (!box || box.dataset.feedbackState === "SUBMITTING" || box.dataset.feedbackState === "SUBMITTED") return;
  const runId = box.dataset.feedbackBox;
  const rating = box.dataset.feedbackRating || "NEEDS_ADJUSTMENT";
  const targetValue = box.querySelector("[data-feedback-target]")?.value || feedbackTargetValue("WHOLE_ANSWER");
  const target = parseFeedbackTarget(targetValue);
  const category = box.querySelector("[data-feedback-category]")?.value || null;
  const correction = box.querySelector("[data-feedback-correction]")?.value || "";
  const comment = box.querySelector("[data-feedback-comment]")?.value || "";
  if (rating === "NEEDS_ADJUSTMENT" && !category && target.type === "WHOLE_ANSWER" && !correction.trim() && !comment.trim()) { feedbackStatus(box, "請選擇需要調整的部分，或補充希望的調整方式。", "error"); return; }
  box.dataset.feedbackState = "SUBMITTING";
  box.querySelectorAll("button, select, textarea").forEach((control) => { control.disabled = true; });
  feedbackStatus(box, "正在記錄回饋…");
  try {
    await api(`/api/v1/query-runs/${encodeURIComponent(runId)}/feedback`, { method: "POST", body: JSON.stringify({ version: "p1.2", rating, target, category, comment, correction }) });
    box.dataset.feedbackState = "SUBMITTED";
    box.innerHTML = `<div class="feedback-complete" role="status"><span aria-hidden="true">✓</span><b>${rating === "POSITIVE" ? "已記錄，謝謝你的回饋。" : "已記錄這次調整建議。"}</b><small>這份回饋已與本次查詢連結，供後續品質檢視使用。</small></div>`;
    toast("回饋已記錄");
  } catch (error) {
    box.dataset.feedbackState = "ERROR";
    box.querySelectorAll("button, select, textarea").forEach((control) => { control.disabled = false; });
    feedbackStatus(box, error.message || "回饋送出失敗，請稍後再試。", "error");
    let retry = box.querySelector("[data-feedback-retry]");
    if (!retry) { retry = document.createElement("button"); retry.type = "button"; retry.className = "text-button feedback-retry"; retry.dataset.feedbackRetry = "true"; retry.textContent = "重試"; box.append(retry); }
    // The retry control is created after the page has been bound. Keep a direct
    // handler as a resilient fallback for browsers/extensions that stop
    // delegated events at dynamically replaced nodes.
    retry.onclick = () => { void submitFeedback(box); };
    toast(error.message || "回饋送出失敗", "error");
  }
}
root.addEventListener("click", (event) => {
  const inline = event.target.closest?.("[data-feedback-inline]");
  if (inline) { event.preventDefault(); const box = [...root.querySelectorAll("[data-feedback-box]")].find((item) => item.dataset.feedbackBox === inline.dataset.feedbackRun); if (!box) return; box.dataset.feedbackRating = "NEEDS_ADJUSTMENT"; box.dataset.feedbackState = "EXPANDED"; box.querySelector(".feedback-negative")?.removeAttribute("hidden"); const target = box.querySelector("[data-feedback-target]"); if (target) target.value = feedbackTargetValue(inline.dataset.feedbackTargetType, inline.dataset.feedbackTargetRef || ""); target?.focus(); return; }
  const rating = event.target.closest?.("[data-feedback-rating]");
  if (rating) { event.preventDefault(); const box = rating.closest("[data-feedback-box]"); if (!box) return; box.dataset.feedbackRating = rating.dataset.feedbackRating === "positive" ? "POSITIVE" : "NEEDS_ADJUSTMENT"; if (box.dataset.feedbackRating === "NEEDS_ADJUSTMENT") { box.dataset.feedbackState = "EXPANDED"; box.querySelector(".feedback-negative")?.removeAttribute("hidden"); box.querySelector("[data-feedback-target]")?.focus(); } else void submitFeedback(box); return; }
  const submit = event.target.closest?.("[data-feedback-submit]");
  if (submit) { event.preventDefault(); void submitFeedback(submit.closest("[data-feedback-box]")); return; }
  const retry = event.target.closest?.("[data-feedback-retry]");
  if (retry) { event.preventDefault(); void submitFeedback(retry.closest("[data-feedback-box]")); }
});

async function renderDashboard() {
  const data = await load("dashboard", "/api/v1/dashboard"); const summary = data.summary; const recent = data.recent.map((item) => `<li><span class="activity-dot"></span><div><b>${esc(item.event_type)}</b><small>${esc(item.resource_type || "系統事件")}</small></div><time>${shortDate(item.created_at)}</time></li>`).join("");
  return shell(`<section class="dashboard-hero"><div><span class="eyebrow">QueryMind workspace</span><h2>今天想從資料中了解什麼？</h2><p>以自然語言提問，系統會先理解受控 Schema，再驗證唯讀 SQLite 查詢並遮罩敏感欄位。</p><div class="hero-actions">${button("開始 AI 對話", { kind: "primary", icon: "chat", attrs: 'data-page="chat"' })}${button("瀏覽查詢範本", { attrs: 'data-page="templates"' })}</div></div><aside class="safety-card"><span>${icon("shield")}</span><div><b>受控分析工作區</b><p>單一 D1、無 ETL、無寫入操作；每筆結果均遵守遮罩與列數限制。</p></div></aside></section>
  <section class="metric-grid"><article><small>進行中的對話</small><strong>${summary.sessions}</strong><span>可釘選、封存與刪除</span></article><article><small>已儲存洞察</small><strong>${summary.insights}</strong><span>可直接重跑或編輯</span></article><article><small>近 30 日提問</small><strong>${summary.requestsLast30Days}</strong><span>受個人與全域限額保護</span></article><article><small>近 30 日結果列數</small><strong>${Number(summary.resultRowsLast30Days).toLocaleString()}</strong><span>回傳資料已套用遮罩</span></article></section>
  <section class="content-grid"><article class="panel"><header class="panel-head"><div><span class="eyebrow">快速開始</span><h2>從成熟的分析問題出發</h2></div></header><div class="quick-list"><button data-prompt="請整理目前各商品的營收與未取消訂單數量。"><span>${icon("insight")}</span><span><b>商品營收與訂單總覽</b><small>依商品找出主要銷售來源</small></span>${icon("chevron")}</button><button data-prompt="請彙整每位客戶的訂單數與消費金額。"><span>${icon("users")}</span><span><b>客戶訂單概況</b><small>檢視客戶交易分布</small></span>${icon("chevron")}</button><button data-page="templates"><span>${icon("template")}</span><span><b>使用已儲存範本</b><small>重複使用團隊驗證過的提問</small></span>${icon("chevron")}</button></div></article><article class="panel"><header class="panel-head"><div><span class="eyebrow">活動紀錄</span><h2>最近工作區操作</h2></div>${has("manage_users") ? `<button class="text-button" data-page="admin-audit">查看全部</button>` : ""}</header><ul class="activity-list">${recent || '<li class="activity-empty">完成第一次查詢後，這裡會顯示近期活動。</li>'}</ul></article></section>`, "dashboard");
}

function chartFor(rows) {
  if (!rows?.length) return "";
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))]; const numeric = columns.find((column) => rows.some((row) => Number.isFinite(Number(row[column]))));
  if (!numeric) return '<p class="chart-empty">此結果沒有可視覺化的數值欄位。</p>';
  const label = columns.find((column) => column !== numeric) || "項目"; const items = rows.slice(0, 12).map((row) => ({ label: String(row[label] ?? "—"), value: Number(row[numeric]) || 0 })); const max = Math.max(...items.map((item) => Math.abs(item.value)), 1);
  return `<div class="chart" aria-label="${esc(numeric)} 圖表">${items.map((item) => `<div class="chart-row"><span title="${esc(item.label)}">${esc(item.label)}</span><div class="chart-track"><progress max="100" value="${Math.max(2, Math.round(Math.abs(item.value) / max * 100))}" aria-label="${esc(item.label)}：${esc(item.value)}"></progress></div><b>${esc(new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 2 }).format(item.value))}</b></div>`).join("")}</div>`;
}
function legacyResultPanel(result, key) {
  return resultPanel(result, key);
}

function sessionRow(session) { return `<div class="session-item ${session.id === state.activeSession ? "selected" : ""}"><button class="session-main" data-session="${session.id}"><span><b>${esc(session.title || "未命名對話")}</b><small>${session.pinned ? "已釘選 · " : ""}${shortDate(session.updatedAt)}</small></span></button><div class="session-actions"><button title="${session.pinned ? "取消釘選" : "釘選"}" aria-label="${session.pinned ? "取消釘選" : "釘選"}" data-session-action="pin" data-session-id="${session.id}" data-session-value="${session.pinned}">${icon("pin")}</button><button title="重新命名" aria-label="重新命名" data-session-action="rename" data-session-id="${session.id}">${icon("edit")}</button><button title="${state.archiveMode ? "還原對話" : "封存對話"}" aria-label="${state.archiveMode ? "還原對話" : "封存對話"}" data-session-action="archive" data-session-id="${session.id}" data-session-value="${state.archiveMode}">${icon("archive")}</button>${state.archiveMode ? `<button title="永久刪除" aria-label="永久刪除" data-session-action="delete" data-session-id="${session.id}">${icon("trash")}</button>` : ""}</div></div>`; }
function evidenceValue(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  const businessLabels = { "sales amount": "銷售額", product: "商品", order_count: "訂單數量", revenue: "營收" };
  const label = businessLabels[normalized] || value;
  return `<span>${esc(label)}</span>`;
}

function explainabilityPanel(result) {
  const explain = result.explainability;
  if (!explain) return "";
  const understanding = explain.understanding || {};
  const sources = explain.sources || {};
  const governance = sources.governance || {};
  const summary = explain.summary || {};
  const feedbackId = explain.feedback?.supported ? explain.feedback.queryRunId : "";
  const explanationSql = typeof explain.explanation?.sql === "string" && explain.explanation.sql.trim() ? explain.explanation.sql.trim() : undefined;
  const feedbackAction = (type, value) => feedbackId && value ? `<button type="button" class="evidence-feedback" data-feedback-inline data-feedback-run="${esc(feedbackId)}" data-feedback-target-type="${type}" data-feedback-target-ref="${esc(value)}" aria-label="針對${esc(value)}提出調整">調整</button>` : "";
  const values = (items, type) => Array.isArray(items) ? items.filter((value) => typeof value === "string" && value.trim()).map((value) => `<li>${evidenceValue(value)}${feedbackAction(type, value)}</li>`).join("") : "";
  const fact = (label, items, type) => {
    const content = values(items, type);
    return content ? `<div><dt>${label}</dt><dd><ul>${content}</ul></dd></div>` : "";
  };
  const understandingFacts = [
    fact("指標", understanding.metrics, "METRIC"),
    fact("依據分組", understanding.dimensions, "DIMENSION"),
    fact("條件", understanding.filters, "FILTER"),
    understanding.timeRange ? `<div><dt>時間</dt><dd>${esc(understanding.timeRange)}</dd></div>` : "",
  ].filter(Boolean).join("");
  const understandingSection = understandingFacts ? `<section class="evidence-section"><h3>問題理解</h3><dl class="explain-facts">${understandingFacts}</dl></section>` : "";
  const sourceRows = (Array.isArray(sources.tables) ? sources.tables : []).filter((source) => source?.name || source?.label).map((source) => `<li><span><b>${esc(source.label || source.name)}</b><small>${esc(source.name || "")}</small></span>${feedbackAction("SOURCE", source.name)}</li>`).join("");
  const semantic = explain.semanticEvidence;
  const semanticSection = semantic?.mode === "USED" && Array.isArray(semantic.selections) && semantic.selections.length
    ? `<div class="definition-evidence"><h4>使用的已核准定義</h4><ul>${semantic.selections.map((selection) => {
      const semanticSources = (selection.sources || []).map((source) => `${source.table}${source.column ? `.${source.column}` : ""}`).join("、");
      const detail = selection.metricAstSummary || selection.definition || (selection.relationshipRefs || []).join("、");
      return `<li><div><b>${esc(selection.label || selection.canonicalName)}</b><small>${esc(selection.semanticType)}${selection.domain ? ` · ${esc(selection.domain)}` : ""}</small>${detail ? `<p>${esc(detail)}</p>` : ""}${semanticSources ? `<small>來源：${esc(semanticSources)}</small>` : ""}</div><details><summary>追溯資料</summary><dl><div><dt>Asset</dt><dd>${esc(selection.assetId)}</dd></div><div><dt>Revision</dt><dd>${esc(selection.revisionId)}</dd></div><div><dt>Registry version</dt><dd>${esc(semantic.registryVersion)}</dd></div>${semantic.schemaSnapshotId ? `<div><dt>Schema snapshot</dt><dd>${esc(semantic.schemaSnapshotId)}</dd></div>` : ""}</dl></details></li>`;
    }).join("")}</ul></div>`
    : semantic?.mode === "NOT_USED" ? `<p class="semantic-not-used">本次查詢未使用已核准的企業定義。</p>` : "";
  const dataSection = sourceRows || semanticSection ? `<section class="evidence-section"><h3>使用的資料</h3>${sourceRows ? `<ul class="source-list">${sourceRows}</ul>` : ""}${semanticSection}</section>` : "";
  const governanceItems = [
    governance.scopeApplied === true ? "資料範圍已套用" : "",
    governance.rowPolicyApplied === true ? "資料列範圍規則已套用" : "",
    governance.columnPolicyApplied === true ? "欄位權限已檢查" : "",
    governance.dlpApplied === true ? "敏感資料檢查已完成" : "",
  ].filter(Boolean);
  const governanceSection = governanceItems.length ? `<section class="evidence-section"><h3>治理檢查</h3><ul class="governance-chips">${governanceItems.map((item) => `<li>${icon("check")}<span>${esc(item)}</span></li>`).join("")}</ul></section>` : "";
  const highlights = Array.isArray(summary.highlights) ? summary.highlights.filter((item) => typeof item === "string" && item.trim()) : [];
  const caveats = Array.isArray(summary.caveats) ? summary.caveats.filter((item) => typeof item === "string" && item.trim()) : [];
  const calculation = explain.explanation?.business;
  const calculationSection = calculation || highlights.length || caveats.length ? `<section class="evidence-section"><h3>計算與備註</h3>${calculation ? `<p class="calculation-copy">${esc(calculation)}${feedbackAction("CALCULATION", "calculation")}</p>` : ""}${highlights.length ? `<ul class="summary-list">${highlights.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>` : ""}${caveats.length ? `<ul class="explain-caveats">${caveats.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>` : ""}</section>` : "";
  const sqlAvailable = explain.explanation?.rawSqlAvailable === true && typeof explanationSql === "string";
  const advanced = sqlAvailable ? `<details class="sql-disclosure advanced-disclosure"><summary>進階 · 已驗證 SQL</summary><div class="advanced-sql-content"><button class="copy-sql" data-copy-sql="${encodeURIComponent(explanationSql)}">${icon("copy")}複製 SQL</button><pre>${esc(explanationSql)}</pre></div></details>` : "";
  const metrics = Array.isArray(understanding.metrics) ? understanding.metrics.filter(Boolean) : [];
  const dimensions = Array.isArray(understanding.dimensions) ? understanding.dimensions.filter(Boolean) : [];
  const preview = [metrics.length ? `指標：${metrics.map((value) => value === "sales amount" ? "銷售額" : value).join("、")}` : "", dimensions.length ? `依${dimensions.map((value) => value === "product" ? "商品" : value).join("、")}分組` : ""].filter(Boolean).join(" · ") || "查看資料來源與治理檢查";
  return `<details class="query-explainability" data-explainability><summary class="explain-summary"><span><b>為什麼是這個答案？</b><small>${esc(preview)}</small></span><span class="explain-toggle-label">查看依據</span></summary><div class="explainability-body">${understandingSection}${dataSection}${governanceSection}${calculationSection}${advanced}</div></details>`;
}

function feedbackPanel(explain) {
  const feedbackId = explain?.feedback?.supported ? explain.feedback.queryRunId : "";
  if (!feedbackId) return "";
  return `<div class="query-feedback" data-feedback-box="${esc(feedbackId)}" data-feedback-state="IDLE"><div class="feedback-intro"><b>這個回答有幫助嗎？</b><small>回饋只連結到本次成功查詢，不會改變資料權限。</small></div><div class="feedback-actions"><button type="button" class="button compact" data-feedback-rating="positive" aria-label="符合需求">✓ 符合需求</button><button type="button" class="button compact" data-feedback-rating="negative" aria-label="調整這份結果">調整一下</button></div><div class="feedback-negative" hidden><label>哪一部分需要調整？<select data-feedback-target aria-label="選擇需要調整的部分">${feedbackTargetOptions(explain)}</select></label><label>問題類型（選填）<select data-feedback-category aria-label="選擇問題類型"><option value="">未指定</option>${feedbackCategoryOptions()}</select></label><label class="feedback-correction-field">你希望怎麼調整？（選填）<textarea data-feedback-correction maxlength="1000" placeholder="例如：我想看排除取消訂單後的銷售額"></textarea></label><button type="button" class="button primary compact" data-feedback-submit>送出回饋</button></div></div>`;
}

function resultPanel(result, key) {
  const rows = Array.isArray(result.rows) ? result.rows : []; const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const rawSqlAvailable = result.explainability ? Boolean(result.explainability.explanation?.rawSqlAvailable) : has("view_schema");
  const sqlCandidate = rawSqlAvailable ? (result.explainability?.explanation?.sql || result.sql) : undefined;
  const sql = typeof sqlCandidate === "string" && sqlCandidate.trim() ? sqlCandidate.trim() : undefined;
  const rowsHtml = rows.slice(0, 100).map((row) => `<tr>${columns.map((column) => `<td>${esc(row[column])}</td>`).join("")}</tr>`).join("");
  const canChart = Boolean(rows.length && columns.some((column) => rows.some((row) => Number.isFinite(Number(row[column])))));
  const current = state.resultTabs.get(key) === "chart" && canChart ? "chart" : "table";
  const count = Number(result.rowCount ?? rows.length);
  const noRows = rows.length === 0 && count === 0;
  const resultContent = noRows
    ? `<div class="result-empty-state"><b>查詢成功，沒有符合條件的資料。</b><p>可以調整條件，或接著提出另一個問題。</p></div>`
    : rows.length === 0 ? `<div class="result-empty-state"><b>查詢完成，但沒有可供顯示的結果列。</b></div>`
      : current === "chart" ? chartFor(rows) : `${table(columns.map(resultColumnLabel), rowsHtml, "query-table")}<small class="table-scroll-hint">左右滑動檢視完整表格</small>`;
  const tabs = rows.length ? `<nav class="result-tabs" aria-label="查詢結果檢視"><button class="result-tab ${current === "table" ? "active" : ""}" data-result-tab="${key}:table">表格</button><button class="result-tab ${current === "chart" ? "active" : ""}" data-result-tab="${key}:chart" ${!canChart ? "disabled" : ""}>圖表</button></nav>` : "";
  const truncationNote = result.truncated ? " · 僅顯示前 100 筆" : "";
  const masked = result.maskedColumns?.length ? status(`已遮罩 ${result.maskedColumns.length} 欄`, "safe") : "";
  const exportAction = has("export") && sql ? `<button class="icon-button" title="匯出 CSV" aria-label="匯出 CSV" data-export="${encodeURIComponent(sql)}">${icon("export")}</button>` : "";
  const queryRunId = result.queryRunId || result.explainability?.queryRunId || "";
  const saveAction = has("manage_own_insights") && queryRunId
    ? state.savedAnalysisRuns.has(queryRunId)
      ? `<span class="saved-analysis-status" role="status">已儲存</span><a class="text-button" href="#/library" data-saved-analysis-run="${esc(queryRunId)}">查看 Library</a>`
      : `<button class="text-button save-analysis-action" data-save-query-run="${esc(queryRunId)}" data-save-prompt="${esc(result.prompt || "")}" ${state.savingAnalysisRuns.has(queryRunId) ? "disabled" : ""}>儲存至 Library</button>`
    : "";
  return `<section class="query-result answer-result" data-query-result><header><div><span class="result-kicker">結果</span><b>${count.toLocaleString()} 筆資料</b>${truncationNote ? `<small>${truncationNote}</small>` : ""}</div><div class="result-actions">${masked}${saveAction}${exportAction}</div></header>${tabs}<div class="result-content">${resultContent}</div></section>${explainabilityPanel(result)}${feedbackPanel(result.explainability)}`;
}

async function renderChat() {
  await loadSessions();
  if (state.activeSession && !state.messages.length) await loadMessages(state.activeSession);
  const failurePanel = state.chatFailure
    ? `<section class="chat-failure" role="alert"><div><b>這次提問沒有完成</b><p>${esc(state.chatFailure.message)}</p><small>錯誤代碼：${esc(state.chatFailure.code)}${state.chatFailure.referenceId ? ` · 參考編號：<code>${esc(state.chatFailure.referenceId)}</code>` : ""}</small></div></section>`
    : "";
  const transcript = !state.activeSession
    ? `${empty("開始一個資料問題", "輸入自然語言問題，QueryMind 會使用已同步的 Schema 和商業字典產生受控的唯讀查詢。", `<div class="suggestions"><button data-prompt="請依商品列出銷售額">依商品列出銷售額</button><button data-prompt="目前有多少筆未取消訂單？">未取消訂單數</button><button data-prompt="請找出最近處理中的客服案件">客服案件概況</button></div>`)}${failurePanel}`
    : `${state.messages.map((message, index) => {
      const previousPrompt = [...state.messages.slice(0, index)].reverse().find((item) => item.role === "user")?.content || "";
      const metadata = message.metadata?.sql ? { ...message.metadata, prompt: previousPrompt } : message.metadata;
      return `<article class="message ${message.role}"><div class="message-avatar">${message.role === "user" ? esc((state.user?.displayName || "你").slice(0, 1)) : "Q"}</div><div class="message-content"><div class="message-meta"><b>${message.role === "user" ? "你" : "QueryMind"}</b><time>${shortDate(message.created_at)}</time></div>${message.role === "assistant" ? `<div class="message-answer">${renderMarkdown(message.content)}</div>` : `<p>${esc(message.content)}</p>`}${metadata?.sql ? resultPanel(metadata, message.id || `stored-${index}`) : ""}</div></article>`;
    }).join("")}${failurePanel}${state.result ? `<article class="message assistant"><div class="message-avatar">Q</div><div class="message-content"><div class="message-meta"><b>QueryMind</b><time>剛剛</time></div><div class="message-answer">${renderMarkdown(state.result.answer || "查詢完成。")}</div>${resultPanel(state.result, state.result.id || "transient")}</div></article>` : ""}${state.sending ? `<article class="message assistant thinking"><div class="message-avatar">Q</div><div class="message-content"><b>QueryMind 正在分析資料</b><span><i></i><i></i><i></i></span></div></article>` : ""}`;
  const sessionList = state.sessions.map(sessionRow).join("") || `<p class="rail-empty">${state.archiveMode ? "沒有封存的對話" : "尚無對話紀錄"}</p>`;
  return shell(`<section class="chat-workspace"><aside class="session-rail"><header><div><span class="eyebrow">${state.archiveMode ? "封存對話" : "對話紀錄"}</span><b>${state.archiveMode ? "已封存" : "Sessions"}</b></div><button class="icon-button" data-action="create-session" aria-label="建立新對話" title="建立新對話">${icon("plus")}</button></header><div class="session-list">${sessionList}</div><button class="archive-toggle" data-action="toggle-archive">${icon("archive")}${state.archiveMode ? "返回目前對話" : "查看封存對話"}</button></aside><div class="chat-canvas"><header class="chat-head"><div><span class="eyebrow">AI analyst</span><h2>${state.activeSession ? esc(state.sessions.find((session) => session.id === state.activeSession)?.title || "分析對話") : "Ask your data"}</h2></div>${state.activeSession ? `<button class="button secondary compact" data-action="create-session">${icon("plus")}新對話</button>` : ""}</header><div class="conversation" aria-live="polite">${transcript}</div><form id="chat-form" class="composer"><label class="sr-only" for="chat-prompt">輸入資料問題</label><textarea id="chat-prompt" name="prompt" placeholder="請輸入你的問題…" maxlength="8000" ${state.sending || state.archiveMode ? "disabled" : ""}>${esc(state.chatDraft)}</textarea><div><small>${state.archiveMode ? "請先返回目前對話才能提問" : "結果限於唯讀 D1；敏感欄位會自動遮罩。"}</small><button class="button primary send-button" ${state.sending || state.archiveMode ? "disabled" : ""}>${state.sending ? "分析中…" : state.chatFailure ? "重新送出" : `${icon("send")}送出`}</button></div></form></div></section>`, "chat");
}

async function renderHistory() {
  await loadSessions();
  const sessionList = state.sessions.map(sessionRow).join("") || `<p class="rail-empty">${state.archiveMode ? "沒有封存的對話" : "尚無對話紀錄"}</p>`;
  return shell(`<section class="history-workspace"><aside class="session-rail"><header><div><span class="eyebrow">Conversation history</span><b>${state.archiveMode ? "已封存" : "History"}</b></div><button class="icon-button" data-action="create-session" aria-label="開始新對話" title="開始新對話">${icon("plus")}</button></header><div class="session-list">${sessionList}</div><button class="archive-toggle" data-action="toggle-archive">${icon("archive")}${state.archiveMode ? "返回目前對話" : "查看封存對話"}</button></aside></section>`, "history");
}

async function renderLibrary() {
  const [insightData, templateData] = await Promise.all([
    has("manage_own_insights") ? load("insights", "/api/v1/insights") : Promise.resolve({ insights: [] }),
    has("view_templates") ? load("templates", "/api/v1/templates") : Promise.resolve({ templates: [] }),
  ]);
  const insights = [...(insightData.insights || [])].sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  const templates = templateData.templates || [];
  const analysisCards = insights.map((item) => `<article class="saved-analysis-card" data-insight-item="${esc(item.id)}"><div class="saved-analysis-copy"><span class="eyebrow">Saved analysis · 儲存於 ${esc(fmtDate(item.createdAt))}</span><h3 title="${esc(item.title)}">${esc(item.title)}</h3><p class="saved-analysis-question">${esc(item.prompt || "原始問題未提供")}</p>${item.description ? `<p class="saved-analysis-note">${esc(item.description)}</p>` : ""}</div><div class="saved-analysis-actions"><button class="button secondary compact" data-run-insight="${esc(item.id)}">重新執行</button><button class="text-button" data-rename-insight="${esc(item.id)}">重新命名</button><button class="text-button danger-text" data-delete-insight="${esc(item.id)}">刪除</button></div></article>`).join("");
  const savedAnalysis = has("manage_own_insights")
    ? `<section class="panel saved-analysis-section"><header class="panel-head"><div><span class="eyebrow">Personal Library</span><h2>已儲存的分析</h2><p>保存問題與來源脈絡；重新執行時會依你目前的權限重新驗證。</p></div><div class="library-section-head-actions"><span class="saved-count">${insights.length} 項</span>${button("進階管理", { attrs: 'data-page="insights"' })}</div></header>${analysisCards ? `<div class="saved-analysis-list">${analysisCards}</div>` : `<div class="library-empty"><b>還沒有已儲存的分析</b><p>先提出一個資料問題；遇到有用的結果時，可以直接從答案旁儲存到這裡。</p>${button("Ask QueryMind", { kind: "primary", attrs: 'data-page="chat"', icon: "chat" })}</div>`}</section>`
    : "";
  const templateSection = has("view_templates")
    ? `<section class="panel library-section"><header class="panel-head"><div><span class="eyebrow">Reusable starting points</span><h2>查詢範本</h2><p>範本是可重複使用的問題起點，與個人已儲存的分析分開管理。</p></div><span class="saved-count">${templates.length} 項</span></header><div class="library-section-footer">${button("瀏覽查詢範本", { attrs: 'data-page="templates"' })}</div></section>`
    : "";
  const dictionarySection = has("view_dictionary")
    ? `<details class="panel library-legacy"><summary><span><span class="eyebrow">Legacy / secondary</span><b>商業詞彙字典</b><small>相容性入口；不等同已核准的 Semantic 定義。</small></span><span class="library-legacy-chevron" aria-hidden="true">展開</span></summary><div class="library-legacy-content"><p>此頁保留既有工作區詞彙管理，不代表已核准的 Semantic 定義。</p>${button("開啟字典", { attrs: 'data-page="dictionary"' })}</div></details>`
    : "";
  return shell(`<div class="library-workspace">${savedAnalysis}${templateSection}${dictionarySection}</div>`, "library");
}

async function renderSchema() { const schema = await load("schema", "/api/v1/schema"); const lines = (schema.context || "").split("\n").filter(Boolean); return shell(`<section class="panel"><header class="panel-head"><div><span class="eyebrow">Schema-aware AI</span><h2>受控 D1 Schema Catalog</h2><p>這是 AI 產生查詢前取得的第一層結構描述；平台內部表已排除。</p></div>${has("refresh_schema") ? button("重新掃描 D1", { attrs: 'data-action="refresh-schema"', icon: "schema" }) : ""}</header><div class="schema-list">${lines.map((line) => { const [name, fields] = line.split("("); return `<article><b>${esc(name)}</b><span>${esc((fields || "").replace(/\)$/u, ""))}</span></article>`; }).join("") || '<p class="muted">尚未建立 Schema Catalog。</p>'}</div></section>`, "schema"); }
async function renderDictionary() { const data = await load("dictionary", "/api/v1/dictionary"); const rows = data.entries.map((item) => `<tr><td><b>${esc(item.term)}</b></td><td>${esc(item.definition)}</td><td>${status(item.category)}</td><td>${esc(item.examples || "—")}</td>${has("manage_dictionary") ? `<td class="row-actions"><button class="icon-button" aria-label="編輯詞彙" title="編輯" data-edit-dictionary="${item.id}">${icon("edit")}</button><button class="icon-button danger" aria-label="刪除詞彙" title="刪除" data-delete-dictionary="${item.id}">${icon("trash")}</button></td>` : ""}</tr>`).join(""); return shell(`<section class="panel"><header class="panel-head"><div><span class="eyebrow">Shared vocabulary</span><h2>商業語意字典</h2><p>字典會一併提供給 AI，確保「營收」、「有效訂單」等定義一致。</p></div>${has("manage_dictionary") ? button("新增詞彙", { kind: "primary", icon: "plus", attrs: 'data-action="add-dictionary"' }) : ""}</header>${table(["詞彙", "定義", "分類", "範例", ...(has("manage_dictionary") ? ["操作"] : [])], rows)}</section>`, "dictionary"); }
async function renderTemplates() { const data = await load("templates", "/api/v1/templates"); const cards = data.templates.map((item) => `<article class="template-card"><header><span>${esc(item.category || "一般")}</span><div>${item.is_pinned ? status("置頂", "safe") : ""}${item.is_shared ? status("共用") : ""}</div></header><h2>${esc(item.title)}</h2><p>${esc(item.description || item.prompt)}</p><footer><button class="text-button" data-use-template="${item.id}">在對話中使用 ${icon("chevron")}</button>${has("manage_templates") ? `<span><button class="icon-button" title="編輯範本" aria-label="編輯範本" data-edit-template="${item.id}">${icon("edit")}</button><button class="icon-button danger" title="刪除範本" aria-label="刪除範本" data-delete-template="${item.id}">${icon("trash")}</button></span>` : ""}</footer></article>`).join(""); return shell(`<section class="panel panel-open"><header class="panel-head"><div><span class="eyebrow">Reusable prompts</span><h2>查詢範本</h2><p>保存團隊常用的問題，讓分析流程可被重複使用與治理。</p></div>${has("manage_templates") ? button("新增範本", { kind: "primary", icon: "plus", attrs: 'data-action="add-template"' }) : ""}</header><div class="template-grid">${cards || empty("沒有可用範本", "建立第一份供工作區使用的查詢範本。")}</div></section>`, "templates"); }
async function renderInsights() { const data = await load("insights", "/api/v1/insights"); const rows = data.insights.map((item) => `<tr><td><b>${esc(item.title)}</b><small>${esc(item.description || item.prompt || "未提供說明")}</small></td><td>${status(item.chartType)}</td><td>${item.isFavorite ? status("已收藏", "safe") : "—"}</td><td>${fmtDate(item.updatedAt)}</td><td class="row-actions"><button class="text-button" data-run-insight="${item.id}">開啟</button><button class="icon-button" aria-label="${item.isFavorite ? "取消收藏" : "收藏"}" title="${item.isFavorite ? "取消收藏" : "收藏"}" data-favorite-insight="${item.id}">★</button><button class="icon-button" aria-label="編輯洞察" title="編輯" data-edit-insight="${item.id}">${icon("edit")}</button><button class="icon-button danger" aria-label="刪除洞察" title="刪除" data-delete-insight="${item.id}">${icon("trash")}</button></td></tr>`).join(""); return shell(`<section class="panel"><header class="panel-head"><div><span class="eyebrow">Saved analysis</span><h2>我的洞察</h2><p>儲存問題、驗證過的 SQL 與視覺化偏好；可隨時重新執行。</p></div>${button("新增洞察", { kind: "primary", icon: "plus", attrs: 'data-action="add-insight"' })}</header>${table(["洞察", "視覺化", "收藏", "更新時間", "操作"], rows)}</section>`, "insights"); }
async function renderUsage() { const data = await load("usage", "/api/v1/usage"); return shell(`<section class="metric-grid"><article><small>近 24 小時提問</small><strong>${data.requests}</strong><span>滾動 24 小時計算</span></article><article><small>成功請求</small><strong>${data.successfulRequests}</strong><span>已完成受控分析</span></article><article><small>供應商呼叫</small><strong>${data.providerRequests}</strong><span>Gateway／Mock 呼叫數</span></article><article><small>結果列數</small><strong>${Number(data.queryRows).toLocaleString()}</strong><span>已經過結果上限</span></article></section><section class="panel info-panel"><span class="panel-icon">${icon("shield")}</span><div><h2>用量與成本保護</h2><p>Worker 端會同時套用個人與全域限額；實際 OpenAI 請求將透過 AI Gateway BYOK 傳送，API Key 不會存入 D1。</p></div></section>`, "usage"); }
async function renderSource() { const data = await load("source", "/api/v1/admin/connection"); const source = data.source; return shell(`<section class="source-card"><div class="source-symbol">${icon("schema")}</div><div><span class="eyebrow">Controlled data source</span><h2>${esc(source.name)}</h2><p>${esc(source.message)}</p><dl><div><dt>類型</dt><dd>${esc(source.type)}</dd></div><div><dt>模式</dt><dd>${status(source.mode, "safe")}</dd></div><div><dt>Schema 表數</dt><dd>${source.tableCount}</dd></div><div><dt>最後掃描</dt><dd>${fmtDate(source.schemaRefreshedAt)}</dd></div></dl></div></section>`, "source"); }
async function renderAdminOverview() { const data = await load("admin-overview", "/api/v1/admin/overview"); const recent = data.recent.map((item) => `<li><span class="activity-dot"></span><div><b>${esc(item.event_type)}</b><small>${esc(item.email || "系統")}</small></div><time>${shortDate(item.created_at)}</time></li>`).join(""); return shell(`<section class="metric-grid"><article><small>啟用使用者</small><strong>${data.summary.activeUsers}</strong><span>目前可登入帳號</span></article><article><small>本週活躍使用者</small><strong>${data.summary.weeklyActiveUsers}</strong><span>七日內活動</span></article><article><small>近 7 天 AI 請求</small><strong>${data.summary.aiRequestsLast7Days}</strong><span>受 Gateway 限制</span></article></section><section class="content-grid"><article class="panel"><span class="eyebrow">Workspace governance</span><h2>產品權限與資料邊界</h2><p>角色決定可操作的產品模組；商業資料不使用表級 RBAC，而是由 Worker 統一強制唯讀與結果遮罩。</p>${button("管理使用者", { kind: "primary", icon: "users", attrs: 'data-page="admin-users"' })}</article><article class="panel"><header class="panel-head"><div><span class="eyebrow">Audit trail</span><h2>最近稽核活動</h2></div><button class="text-button" data-page="admin-audit">查看全部</button></header><ul class="activity-list">${recent || '<li class="activity-empty">尚無工作區活動。</li>'}</ul></article></section>`, "admin-overview"); }
async function renderAdminUsers() { const data = await load("admin-users", "/api/v1/admin/users"); const needle = state.userFilter.trim().toLowerCase(); const filtered = data.users.filter((user) => (!needle || `${user.displayName} ${user.email}`.toLowerCase().includes(needle)) && (state.roleFilter === "all" || user.roleName === state.roleFilter)); const rows = filtered.map((user) => `<tr><td><span class="user-cell"><span class="avatar small">${esc((user.displayName || user.email).slice(0, 1).toUpperCase())}</span><span><b>${esc(user.displayName)}</b><small>${esc(user.email)}</small></span></span></td><td><select data-role-user="${user.id}" aria-label="${esc(user.email)} 的角色">${ROLE_NAMES.map((role) => `<option value="${role}" ${role === user.roleName ? "selected" : ""}>${role}</option>`).join("")}</select></td><td>${status(user.isActive ? "啟用中" : "已停用", user.isActive ? "safe" : "danger")}</td><td>${fmtDate(user.lastSeenAt, "尚未登入")}</td><td class="row-actions"><button class="text-button" data-toggle-user="${user.id}" data-active="${user.isActive}">${user.isActive ? "停用" : "啟用"}</button>${user.id === state.user?.id ? "" : `<button class="text-button" data-reset-user="${user.id}" data-reset-email="${esc(user.email)}">重設密碼</button>`}<button class="text-button" data-keys-user="${user.id}">API Keys</button></td></tr>`).join(""); return shell(`<section class="panel"><header class="panel-head"><div><span class="eyebrow">Team access</span><h2>使用者與權限</h2><p>角色管理產品功能，不含資料表級權限。</p></div>${button("邀請使用者", { kind: "primary", icon: "plus", attrs: 'data-action="invite-user"' })}</header><div class="filter-bar"><label>${icon("search")}<input data-user-search value="${esc(state.userFilter)}" placeholder="搜尋名稱或 Email"></label><select data-role-filter aria-label="角色篩選"><option value="all">所有角色</option>${ROLE_NAMES.map((role) => `<option value="${role}" ${state.roleFilter === role ? "selected" : ""}>${role}</option>`).join("")}</select><small>顯示 ${filtered.length} / ${data.users.length} 位使用者</small></div>${table(["使用者", "角色", "狀態", "最近活動", "操作"], rows)}</section>`, "admin-users"); }
async function renderAdminRoles() { const data = await load("admin-roles", "/api/v1/admin/roles"); const cards = data.roles.map((role) => `<article class="role-card"><header><div><span class="eyebrow">${esc(role.roleName)}</span><h2>${esc(role.displayName)}</h2></div>${status(`${Number(role.maxRowsPerQuery).toLocaleString()} 列上限`, "safe")}</header><p>${esc(role.description)}</p><ul>${role.capabilities.includes("*") ? "<li>完整工作區管理能力</li>" : role.capabilities.map((capability) => `<li>${esc(CAPABILITY_LABELS[capability] || capability)}</li>`).join("")}</ul><footer><small>${role.isSystem ? "內建角色" : "自訂角色"}</small><button class="text-button" data-edit-role="${role.roleName}">調整設定</button></footer></article>`).join(""); return shell(`<section class="panel panel-open"><header class="panel-head"><div><span class="eyebrow">Role policy</span><h2>角色與權限</h2><p>每個 API 皆會再次驗證能力；介面隱藏不等於授權。</p></div></header><div class="roles-grid">${cards}</div></section>`, "admin-roles"); }
async function governanceConfig() { return load("admin-semantic-governance", "/api/v1/semantics/governance/policies"); }
async function governanceUsers() { try { return (await load("admin-semantic-users", "/api/v1/admin/users")).users || []; } catch { return []; } }
function governanceScope(item) { return item.scopeKind === "ASSET" || item.scope_kind === "ASSET" ? `ASSET · ${item.assetId || item.asset_id || "—"}` : `DOMAIN · ${item.domain || "—"}`; }
function governanceState(isActive) { return status(isActive ? "啟用中" : "已停用", isActive ? "safe" : "danger"); }
async function renderAdminSemanticAuthorities() {
  const [config, users] = await Promise.all([governanceConfig(), governanceUsers()]);
  const userById = new Map(users.map((user) => [user.id, user]));
  const rows = (config.authorities || []).map((item) => {
    const user = userById.get(item.user_id);
    const active = Number(item.is_active) === 1;
    return `<tr><td><b>${esc(user?.displayName || "Unknown user")}</b><small>${esc(user?.email || item.user_id)}</small></td><td>${esc(governanceScope(item))}</td><td>${status(item.raci_role || "—")}</td><td>${item.can_approve ? status("可核准", "safe") : status("不可核准")}</td><td>${item.can_govern_runtime ? status("可治理 runtime", "warning") : "—"}</td><td>${governanceState(active)}</td><td>${fmtDate(item.created_at)}<small>${item.updated_at && item.updated_at !== item.created_at ? `更新 ${fmtDate(item.updated_at)}` : ""}</small></td><td class="row-actions">${active ? `<button class="text-button" data-replace-semantic-authority="${esc(item.authority_id)}">Replace</button>` : ""}<button class="text-button ${active ? "danger" : ""}" data-toggle-semantic-authority="${esc(item.authority_id)}" data-active="${active}">${active ? "停用" : "啟用"}</button></td></tr>`;
  }).join("");
  return shell(`<section class="panel panel-open governance-panel"><header class="panel-head"><div><span class="eyebrow">Semantic Governance · Authorities</span><h2>Authorities</h2><p>Role != Semantic Authority。只有具名、具範圍的 authority record 才能提供核准能力。</p></div>${button("新增 Authority", { kind: "primary", icon: "plus", attrs: 'data-action="create-semantic-authority"' })}</header><div class="governance-boundary-note">此頁只管理 P2-E 的人類 RACI 指派，不會修改內建角色、不會建立 Semantic asset，也不會啟用 Runtime。</div>${table(["使用者", "Scope", "RACI", "Approval", "Runtime", "狀態", "建立 / 更新", "操作"], rows, "governance-table")}</section>`, "admin-semantic-authorities");
}
async function renderAdminSemanticPolicies() {
  const config = await governanceConfig();
  const rows = (config.policies || []).map((item) => {
    const active = Number(item.is_active) === 1;
    const risk = item.risk_class || "—";
    return `<tr><td>${esc(governanceScope(item))}</td><td>${status(risk, risk === "HIGH" || risk === "CRITICAL" ? "warning" : "neutral")}</td><td><b>${Number(item.required_approvals)}</b><small>distinct human approvals</small></td><td>${item.allow_proposer_self_approval ? status("允許", "warning") : status("禁止", "safe")}</td><td>${item.allow_emergency_publication ? status("允許", "warning") : status("禁止", "safe")}</td><td>${Number(item.post_review_due_hours)} 小時</td><td>${governanceState(active)}</td><td>${fmtDate(item.created_at)}<small>${item.updated_at && item.updated_at !== item.created_at ? `更新 ${fmtDate(item.updated_at)}` : ""}</small></td><td class="row-actions">${active ? `<button class="text-button" data-replace-semantic-policy="${esc(item.policy_id)}">Replace</button>` : ""}<button class="text-button ${active ? "danger" : ""}" data-toggle-semantic-policy="${esc(item.policy_id)}" data-active="${active}">${active ? "停用" : "啟用"}</button></td></tr>`;
  }).join("");
  return shell(`<section class="panel panel-open governance-panel"><header class="panel-head"><div><span class="eyebrow">Semantic Governance · Approval Policies</span><h2>Approval Policies</h2><p>Policy 內容受 P2-E risk、quorum 與 Separation of Duties 驗證；本頁不會建立或修改 Semantic asset。</p></div>${button("新增 Approval Policy", { kind: "primary", icon: "plus", attrs: 'data-action="create-semantic-policy"' })}</header><div class="governance-boundary-note">高風險與 critical policy 的最低 quorum 由 backend 強制為兩位不同的人類核准者；AI 不會填補 approval slot。</div>${table(["Scope", "Risk", "Quorum", "Proposer self-approval", "Emergency", "Post-review", "狀態", "建立 / 更新", "操作"], rows, "governance-table")}</section>`, "admin-semantic-policies");
}
async function renderAdminInvitations() { const data = await load("admin-invitations", "/api/v1/admin/invitations"); const rows = data.invitations.map((invite) => `<tr><td><b>${esc(invite.email)}</b><small>由 ${esc(invite.invitedByEmail || "Owner")} 建立</small></td><td>${status(invite.roleName)}</td><td>${invite.acceptedAt ? status("已接受", "safe") : invite.revokedAt ? status("已撤銷", "danger") : status("待接受", "warning")}</td><td>${fmtDate(invite.expiresAt)}</td><td>${!invite.acceptedAt && !invite.revokedAt ? `<button class="text-button danger" data-revoke-invite="${invite.id}">撤銷</button>` : "—"}</td></tr>`).join(""); return shell(`<section class="panel"><header class="panel-head"><div><span class="eyebrow">Secure onboarding</span><h2>邀請</h2><p>建立後會產生一次性完整邀請連結；請以安全管道傳遞給受邀者。</p></div>${button("建立邀請", { kind: "primary", icon: "plus", attrs: 'data-action="invite-user"' })}</header>${table(["電子郵件", "角色", "狀態", "到期時間", "操作"], rows)}</section>`, "admin-invitations"); }
async function renderAdminAudit() { const data = await load("admin-audit", "/api/v1/admin/audit"); const rows = data.events.map((event) => `<tr><td>${fmtDate(event.createdAt)}</td><td><b>${esc(event.eventType)}</b></td><td>${esc(event.actorEmail || "系統")}</td><td>${esc(event.resourceType || "—")}</td><td><code>${esc(event.resourceId || "—")}</code></td></tr>`).join(""); return shell(`<section class="panel"><header class="panel-head"><div><span class="eyebrow">Immutable activity</span><h2>稽核紀錄</h2><p>查詢、角色、邀請、API Key 與治理操作皆會被記錄。</p></div></header>${table(["時間", "事件", "操作者", "資源", "ID"], rows)}</section>`, "admin-audit"); }
async function renderAdminSystem() { const data = await load("admin-system", "/api/v1/admin/system"); return shell(`<section class="system-grid"><article class="panel"><span class="eyebrow">Runtime</span><h2>系統狀態</h2><dl class="definition-grid"><div><dt>部署環境</dt><dd>${esc(data.environment)}</dd></div><div><dt>應用資料庫</dt><dd>${esc(data.database.app)}</dd></div><div><dt>商業資料庫</dt><dd>${esc(data.database.data)}</dd></div><div><dt>Schema 表數</dt><dd>${data.database.schemaTables}</dd></div><div><dt>AI Gateway</dt><dd>${data.aiGatewayConfigured ? status("已設定", "safe") : status("待設定", "warning")}</dd></div></dl></article><article class="panel"><span class="eyebrow">Design boundary</span><h2>架構限制</h2><ul class="plain-list">${data.limitations.map((item) => `<li>${icon("check")}${esc(item)}</li>`).join("")}</ul></article></section>`, "admin-system"); }
function renderProfile() { return shell(`<section class="profile-layout"><article class="profile-summary"><span class="avatar profile-avatar">${esc((state.user?.displayName || state.user?.email || "Q").slice(0, 1).toUpperCase())}</span><span class="eyebrow">Account</span><h2>${esc(state.user?.displayName || "QueryMind user")}</h2><p>${esc(state.user?.email)}</p>${status(state.user?.roleName || "member", "safe")}<p class="muted">每次查詢最多 ${Number(state.user?.permissions?.maxRowsPerQuery || 0).toLocaleString()} 列。</p>${has("view_own_usage") ? button("查看我的用量", { attrs: 'data-page="usage"' }) : ""}</article><article class="panel"><span class="eyebrow">Security</span><h2>變更密碼</h2><p>密碼最少 12 個字元；變更後目前瀏覽器工作階段仍可使用。</p><form id="password-form" class="form-grid"><label>目前密碼<input name="currentPassword" type="password" autocomplete="current-password" minlength="12" required></label><label>新密碼<input name="newPassword" type="password" autocomplete="new-password" minlength="12" required></label><button class="button primary">${icon("check")}更新密碼</button></form><hr><button class="button danger-outline" data-action="logout">${icon("logout")}登出</button></article></section>`, "profile"); }

const SEMANTIC_TYPES = ["TERM", "DIMENSION", "METRIC", "RELATIONSHIP"];
const SEMANTIC_ASSET_STATUSES = ["ACTIVE", "DEPRECATED"];
const SEMANTIC_REVISION_STATUSES = ["DRAFT", "IN_REVIEW", "APPROVED", "REJECTED"];
const SEMANTIC_UNITS = ["COUNT", "CURRENCY", "QUANTITY", "PERCENT", "RATING", "UNKNOWN"];
const SEMANTIC_CARDINALITIES = ["ONE_TO_ONE", "ONE_TO_MANY", "MANY_TO_ONE", "MANY_TO_MANY"];
const SEMANTIC_FILTER_OPERATORS = ["EQ", "NEQ", "IN", "NOT_IN", "IS_NULL", "IS_NOT_NULL"];

function semanticTone(value) {
  if (value === "APPROVED" || value === "ACTIVE") return "safe";
  if (value === "IN_REVIEW") return "warning";
  if (value === "REJECTED" || value === "DEPRECATED") return "danger";
  return "neutral";
}
function semanticStatus(value) { return status(value || "—", semanticTone(value)); }
function semanticError(error) {
  if (error?.code === "RBAC_FORBIDDEN") return "你沒有執行此語意治理操作的權限。";
  if (error?.code === "SEMANTIC_AUTHORITY_INVALID") return "Authority 必須指向啟用中的人類使用者，且只有 SEMANTIC_APPROVER 可取得核准能力。";
  if (error?.code === "SEMANTIC_AUTHORITY_NOT_FOUND") return "找不到此 Semantic Authority，請重新整理後再試。";
  if (error?.code === "SEMANTIC_GOVERNANCE_POLICY_INVALID") return "Approval Policy 欄位未通過 P2-E 的 risk、quorum 或期限驗證。";
  if (error?.code === "SEMANTIC_GOVERNANCE_POLICY_NOT_FOUND") return "找不到此 Approval Policy，請重新整理後再試。";
  if (error?.code === "SEMANTIC_GOVERNANCE_POLICY_CONFLICT") return "此 scope 已有治理 policy；請直接使用現有 policy。";
  if (error?.code === "API_KEY_RESTRICTED") return "語意治理異動必須使用瀏覽器登入工作階段。";
  if (error?.code === "SEMANTIC_STATE_CONFLICT") return "伺服器狀態已變更；請重新整理後再試。";
  if (error?.code === "SEMANTIC_SCHEMA_UNAVAILABLE") return "Schema Catalog 尚未就緒，暫時無法建立或送審語意定義。";
  if (error?.code === "SUGGESTION_STALE") return "這項 AI 建議所依據的 Schema 已變更，請重新產生建議。";
  if (error?.code === "SUGGESTION_DUPLICATE") return "已有相同類型、名稱與領域的 Semantic Asset，請調整草稿後再試。";
  if (error?.code === "SUGGESTION_SOURCE_FORBIDDEN") return "目前角色已無法存取此建議的所有來源欄位。";
  if (error?.code === "SUGGESTION_CANDIDATES_EMPTY") return "所選資料表沒有可安全建立的語意候選項目。";
  if (error?.code === "AI_NOT_CONFIGURED" || error?.code === "AI_GATEWAY_ERROR" || error?.code === "AI_GATEWAY_TIMEOUT") return "AI Gateway 暫時無法產生建議；未建立任何部分結果。";
  if (error?.code === "SUGGESTION_OUTPUT_INVALID") return "AI 回覆未通過受控結構驗證；未建立任何建議。";
  if (error?.code === "SEMANTIC_VALIDATION_ERROR" || error?.code === "SEMANTIC_CATALOG_REFERENCE_INVALID") return "請檢查語意定義、來源欄位與生命週期狀態。";
  return "語意治理操作未完成，請確認輸入後再試。";
}
function invalidateSemantics() {
  for (const key of state.cache.keys()) if (String(key).startsWith("semantics")) state.cache.delete(key);
}
function semanticSourceValue(source) { return source?.table && source?.column ? `${source.table}.${source.column}` : ""; }
function semanticSourceFromValue(value, field = "來源欄位") {
  const match = /^([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)$/u.exec(String(value || ""));
  if (!match) throw new Error(`${field} 必須選擇 Schema Catalog 中的欄位。`);
  return { table: match[1], column: match[2] };
}
function semanticCatalogFromContext(context) {
  const tables = [];
  for (const line of String(context || "").split("\n")) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\((.*)\)/u.exec(line.trim());
    if (!match) continue;
    const columns = match[2].split(",").map((item) => /^\s*([A-Za-z_][A-Za-z0-9_]*)/u.exec(item)?.[1]).filter(Boolean);
    if (columns.length) tables.push({ table: match[1], columns });
  }
  return tables;
}
async function semanticCatalog() {
  if (!has("view_schema")) return [];
  try { return semanticCatalogFromContext((await load("semantics-schema", "/api/v1/schema")).context); } catch { return []; }
}
async function semanticSuggestionCatalog() {
  const data = await api("/api/v1/semantics/suggestions/catalog");
  return data.tables || [];
}
function semanticOption(value, label, selected = false) { return `<option value="${esc(value)}" ${selected ? "selected" : ""}>${esc(label)}</option>`; }
function semanticSourceSelect(name, catalog, value = "", options = {}) {
  const required = options.required ? "required" : "";
  const disabled = !catalog.length ? "disabled" : "";
  const blank = options.blank === false ? "" : semanticOption("", options.placeholder || "選擇欄位", !value);
  const values = catalog.flatMap(({ table: tableName, columns }) => columns.map((column) => {
    const source = `${tableName}.${column}`;
    return semanticOption(source, source, source === value);
  })).join("");
  return `<select name="${esc(name)}" data-semantic-source ${required} ${disabled}>${blank}${values}</select>`;
}
function semanticTableSelect(name, catalog, value = "", required = true) {
  const disabled = !catalog.length ? "disabled" : "";
  return `<select name="${esc(name)}" ${required ? "required" : ""} ${disabled}>${semanticOption("", "選擇資料表", !value)}${catalog.map((item) => semanticOption(item.table, item.table, item.table === value)).join("")}</select>`;
}
function semanticDefaultContract(type, asset = {}) {
  const common = { canonicalName: asset.canonicalName || "", displayName: asset.displayName || "", definition: "", domain: asset.domain || "", semanticDependencies: [] };
  if (type === "TERM") return common;
  if (type === "DIMENSION") return { ...common, source: {}, dataType: "TEXT", allowedOperations: ["GROUP", "FILTER"] };
  if (type === "METRIC") return { ...common, sources: [], expression: { kind: "SUM", argument: { kind: "COLUMN", source: {} } }, defaultFilters: [], nativeGrain: { kind: "ENTITY", key: "entity", source: { table: "", keyColumns: [] } }, unit: "COUNT" };
  return { ...common, leftTable: "", rightTable: "", cardinality: "ONE_TO_MANY", joinKeys: [] };
}
function semanticExpressionText(expression) {
  if (!expression || typeof expression !== "object") return "—";
  if (expression.kind === "COLUMN") return `${expression.source?.table || "?"}.${expression.source?.column || "?"}`;
  if (expression.kind === "LITERAL") return String(expression.value);
  if (expression.kind === "COUNT") return expression.mode === "ROWS" ? "COUNT(rows)" : `COUNT(${semanticExpressionText({ kind: "COLUMN", source: expression.source })})`;
  if (expression.kind === "COUNT_DISTINCT") return `COUNT DISTINCT ${semanticExpressionText({ kind: "COLUMN", source: expression.source })}`;
  if (["SUM", "AVG", "MIN", "MAX"].includes(expression.kind)) return `${expression.kind}(${semanticExpressionText(expression.argument)})`;
  if (["ADD", "SUBTRACT", "MULTIPLY", "DIVIDE"].includes(expression.kind)) return `${expression.kind}(${semanticExpressionText(expression.left)}, ${semanticExpressionText(expression.right)})`;
  return "Bounded expression";
}
function semanticDefinition(contract, assetType) {
  if (!contract) return "";
  const common = `<section class="semantic-section"><h3>Business definition</h3><p>${esc(contract.definition || "尚未提供定義。")}</p></section>`;
  if (assetType === "TERM") return `${common}${contract.source ? `<section class="semantic-section"><h3>Source mapping</h3><code>${esc(semanticSourceValue(contract.source))}</code></section>` : ""}`;
  if (assetType === "DIMENSION") return `${common}<section class="semantic-section"><h3>Dimension contract</h3><dl class="definition-grid semantic-definition-grid"><div><dt>Source</dt><dd><code>${esc(semanticSourceValue(contract.source))}</code></dd></div><div><dt>Data type</dt><dd>${esc(contract.dataType)}</dd></div><div><dt>Allowed operations</dt><dd>${esc((contract.allowedOperations || []).join(", "))}</dd></div></dl></section>${semanticGrainSummary(contract.nativeGrain)}`;
  if (assetType === "METRIC") return `${common}<section class="semantic-section"><h3>Metric Contract</h3><dl class="definition-grid semantic-definition-grid"><div><dt>Formula</dt><dd><code>${esc(semanticExpressionText(contract.expression))}</code></dd></div><div><dt>Unit</dt><dd>${esc(contract.unit || "—")}${contract.currency ? ` · ${esc(contract.currency)}` : ""}</dd></div><div><dt>Default filters</dt><dd>${esc((contract.defaultFilters || []).map((item) => `${semanticSourceValue(item.field)} ${item.operator}`).join(", ") || "None")}</dd></div></dl></section>${semanticGrainSummary(contract.nativeGrain)}`;
  return `${common}<section class="semantic-section"><h3>Relationship Contract</h3><dl class="definition-grid semantic-definition-grid"><div><dt>Left entity</dt><dd><code>${esc(contract.leftTable)}</code></dd></div><div><dt>Right entity</dt><dd><code>${esc(contract.rightTable)}</code></dd></div><div><dt>Cardinality</dt><dd>${esc(contract.cardinality)}</dd></div></dl><div class="semantic-key-list">${(contract.joinKeys || []).map((key, index) => `<div><span>${index + 1}</span><code>${esc(`${key.leftTable}.${key.leftColumn}`)}</code><b>→</b><code>${esc(`${key.rightTable}.${key.rightColumn}`)}</code></div>`).join("") || '<p class="muted">No join keys.</p>'}</div></section>`;
}
function semanticGrainSummary(grain) {
  if (!grain) return "";
  const source = grain.kind === "ENTITY" ? `${grain.source?.table || "?"}.${(grain.source?.keyColumns || []).join(", ")}` : semanticSourceValue(grain.source);
  return `<section class="semantic-section"><h3>Native grain</h3><dl class="definition-grid semantic-definition-grid"><div><dt>Kind</dt><dd>${esc(grain.kind)}</dd></div><div><dt>Key</dt><dd><code>${esc(grain.key)}</code></dd></div><div><dt>Physical anchor</dt><dd><code>${esc(source)}</code></dd></div>${grain.timeUnit ? `<div><dt>Time unit</dt><dd>${esc(grain.timeUnit)}</dd></div>` : ""}</dl></section>`;
}

function semanticQueryString() {
  const filter = state.semanticFilters;
  const query = new URLSearchParams({ page: String(filter.page), limit: String(filter.limit) });
  for (const [key, value] of Object.entries({ search: filter.search, type: filter.type, assetStatus: filter.assetStatus, revisionStatus: filter.revisionStatus, domain: filter.domain })) if (value) query.set(key, value);
  return query.toString();
}
function semanticShellPage() { return state.navRoute === "needs-review" ? "needs-review" : "semantics"; }
function semanticFilterSelect(name, values, selected, label) { return `<select name="${name}" aria-label="${esc(label)}">${semanticOption("", `所有${label}`, !selected)}${values.map((value) => semanticOption(value, value, value === selected)).join("")}</select>`; }
function semanticWorkspaceTabs() { return `<nav class="semantic-tabs semantic-workspace-tabs" aria-label="Semantic Registry workspace"><button class="${state.semanticWorkspace === "assets" ? "active" : ""}" data-semantic-workspace="assets" aria-selected="${state.semanticWorkspace === "assets"}">Semantic Assets</button>${has("manage_semantic_drafts") ? `<button class="${state.semanticWorkspace === "suggestions" ? "active" : ""}" data-semantic-workspace="suggestions" aria-selected="${state.semanticWorkspace === "suggestions"}">AI Suggestions</button>` : ""}</nav>`; }
function semanticRuntimeReadinessPanel(readiness) { const checks = readiness?.checks || {}; const statusText = value => value === "PASS" ? "Ready" : value === "NOT_READY" ? "Not ready" : value === "BLOCKED" ? "Blocked" : "Manual"; const item = (label, check) => `<div><span>${esc(label)}</span><b>${esc(statusText(check?.status))}</b><small>${esc(check?.code || "—")}</small></div>`; return `<section class="semantic-runtime-readiness"><header><div><span class="eyebrow">P2-H · Read-only activation gate</span><h3>Semantic Runtime Readiness</h3><p>This view assesses a future activation only. It cannot change configuration, semantic assets, or data access.</p></div><span class="governance-badge">${esc(readiness?.status || "NOT_READY")}</span></header><dl>${item("Runtime capability", { status: "PASS", code: readiness?.runtimeCapability || "AVAILABLE" })}${item("Activation flag", checks.featureFlag)}${item("Schema", checks.schemaSnapshot)}${item("Policy engine", checks.policyEngine)}${item("Evidence", checks.evidenceHook)}${item("Semantic content", checks.registry)}</dl>${readiness?.blockers?.length ? `<p class="semantic-runtime-blockers">Blockers: ${esc(readiness.blockers.join(" · "))}</p>` : ""}</section>`; }
async function renderSemanticRegistry() {
  const key = `semantics-list:${semanticQueryString()}`;
  const [data, readiness] = await Promise.all([load(key, `/api/v1/semantics?${semanticQueryString()}`), load("semantics-runtime-readiness", "/api/v1/admin/semantic-runtime/readiness")]);
  const items = data.items || [];
  const filter = state.semanticFilters;
  const create = has("manage_semantic_drafts") ? button("Create Semantic Asset", { kind: "primary", icon: "plus", attrs: 'data-action="create-semantic"' }) : "";
  const toolbar = `<form class="filter-bar semantic-filter-bar" data-semantic-filters><label>${icon("search")}<input name="search" aria-label="搜尋語意定義" value="${esc(filter.search)}" maxlength="120" placeholder="搜尋名稱、領域或標籤"></label>${semanticFilterSelect("type", SEMANTIC_TYPES, filter.type, "類型")}${semanticFilterSelect("assetStatus", SEMANTIC_ASSET_STATUSES, filter.assetStatus, "Asset 狀態")}${semanticFilterSelect("revisionStatus", SEMANTIC_REVISION_STATUSES, filter.revisionStatus, "Revision 狀態")}<input class="semantic-domain-filter" name="domain" aria-label="依領域篩選" value="${esc(filter.domain)}" maxlength="80" placeholder="領域"><button class="button secondary compact" type="submit">篩選</button></form>`;
  if (!items.length) return shell(`<section class="panel panel-open semantic-registry"><header class="panel-head"><div><span class="eyebrow">Governed design-time metadata</span><h2>Definitions</h2><p>集中維護指標、維度、詞彙與關聯的企業定義。此模組不會參與目前的查詢執行期。</p></div></header>${semanticWorkspaceTabs()}${semanticRuntimeReadinessPanel(readiness)}${toolbar}${empty(state.navRoute === "needs-review" ? "目前沒有待審查的定義" : "尚未建立語意定義", state.navRoute === "needs-review" ? "所有需要你審查的定義都已處理，或尚未有項目送交審查。" : "Definitions 用於維護企業一致的指標、維度、詞彙與關聯；建立草稿後仍須經過治理流程。", create)}</section>`, semanticShellPage());
  const rows = items.map((item) => `<tr><td><button class="semantic-name-button" data-open-semantic="${esc(item.assetId)}"><b>${esc(item.displayName)}</b><small>${esc(item.canonicalName)}</small></button></td><td>${semanticStatus(item.assetType)}</td><td>${esc(item.domain || "—")}</td><td><code>${esc(item.ownerUserId)}</code></td><td>${semanticStatus(item.assetStatus)}</td><td>${semanticStatus(item.latestRevision?.status)}</td><td>${item.latestRevision ? `v${esc(item.latestRevision.revisionNumber)}` : "—"}</td><td class="row-actions"><button class="text-button" data-open-semantic="${esc(item.assetId)}">檢視</button></td></tr>`).join("");
  const page = data.page || { page: 1, total: items.length, hasNext: false };
  const pagination = `<footer class="semantic-pagination"><small>第 ${Number(page.page).toLocaleString()} 頁 · 共 ${Number(page.total).toLocaleString()} 個 Assets</small><span><button class="button secondary compact" data-semantic-page="${Math.max(1, Number(page.page) - 1)}" ${Number(page.page) <= 1 ? "disabled" : ""}>上一頁</button><button class="button secondary compact" data-semantic-page="${Number(page.page) + 1}" ${page.hasNext ? "" : "disabled"}>下一頁</button></span></footer>`;
  return shell(`<section class="panel panel-open semantic-registry"><header class="panel-head"><div><span class="eyebrow">Governed design-time metadata</span><h2>Definitions</h2><p>在不改變 AI、SQL 或資料執行期的前提下，建立可追溯的企業語意定義。</p></div>${create}</header>${semanticWorkspaceTabs()}${semanticRuntimeReadinessPanel(readiness)}${toolbar}${table(["Name", "Type", "Domain", "Owner", "Asset", "Latest revision", "Version", ""], rows, "semantic-table")}${pagination}</section>`, semanticShellPage());
}
function semanticSuggestionQueryString() {
  const filter = state.semanticSuggestionFilters;
  const query = new URLSearchParams({ page: String(filter.page), limit: String(filter.limit) });
  for (const [key, value] of Object.entries({ status: filter.status, type: filter.type, stale: filter.stale })) if (value) query.set(key, value);
  return query.toString();
}
function suggestionEvidence(item) {
  const evidence = item.suggestion?.evidence || { tables: [], columns: [], foreignKeys: [] };
  const fields = [...(evidence.columns || []), ...(evidence.tables || []).filter((table) => !(evidence.columns || []).some((column) => column.startsWith(`${table}.`)))];
  return `<div class="semantic-source-list">${fields.map((field) => `<div><span>${semanticStatus(field.includes(".") ? "COLUMN" : "TABLE")}</span><code>${esc(field)}</code><small>catalog evidence</small></div>`).join("") || '<p class="muted">No physical source mapping.</p>'}</div>${(evidence.foreignKeys || []).length ? `<div class="semantic-key-list">${evidence.foreignKeys.map((key, index) => `<div><span>${index + 1}</span><code>${esc(`${key.referencedTable}.${key.referencedColumn}`)}</code><b>→</b><code>${esc(`${key.table}.${key.column}`)}</code></div>`).join("")}</div>` : ""}`;
}
function suggestionCard(item) {
  const suggestion = item.suggestion || {};
  const contract = suggestion.contract || {};
  const active = item.status === "OPEN" && !item.isStale;
  const action = active ? `<div class="semantic-actions"><button class="button secondary" data-use-suggestion="${esc(item.suggestionId)}">${icon("edit")}使用此建議建立草稿</button><button class="button danger-outline" data-dismiss-suggestion="${esc(item.suggestionId)}">Dismiss</button></div>` : "";
  const uncertainty = `<div class="suggestion-uncertainty"><section><h4>Assumptions</h4><ul>${(suggestion.assumptions || []).map((value) => `<li>${esc(value)}</li>`).join("") || "<li>None recorded.</li>"}</ul></section><section><h4>Open questions</h4><ul>${(suggestion.openQuestions || []).map((value) => `<li>${esc(value)}</li>`).join("") || "<li>None recorded.</li>"}</ul></section></div>`;
  return `<article class="semantic-suggestion-card" data-suggestion-card="${esc(item.suggestionId)}"><header><div><span class="suggestion-badge">AI Suggested</span><h3>${esc(item.displayName)}</h3><p><code>${esc(item.canonicalName)}</code> · ${semanticStatus(item.suggestionType)} · ${semanticStatus(item.confidence)}</p></div><div>${semanticStatus(item.isStale ? "STALE" : item.status)}</div></header><p class="suggestion-disclaimer">AI 建議僅依目前可授權存取的 Schema Metadata 產生，不代表企業正式定義。建立草稿後仍需經人工治理流程。</p><section><h4>Definition</h4><p>${esc(suggestion.definition || "—")}</p></section>${contract.expression ? `<section><h4>Metric AST</h4><code>${esc(semanticExpressionText(contract.expression))}</code>${semanticGrainSummary(contract.nativeGrain)}</section>` : ""}${contract.joinKeys ? `<section><h4>Relationship</h4>${suggestionEvidence(item)}</section>` : `<section><h4>Sources & evidence</h4>${suggestionEvidence(item)}</section>`}${uncertainty}<footer><small>Schema snapshot <code>${esc(item.schemaSnapshotId)}</code> · ${fmtDate(item.createdAt)}</small>${action}</footer></article>`;
}
async function renderSemanticSuggestions() {
  const key = `semantics-suggestions:${semanticSuggestionQueryString()}`;
  const data = await load(key, `/api/v1/semantics/suggestions?${semanticSuggestionQueryString()}`);
  const filter = state.semanticSuggestionFilters;
  const toolbar = `<form class="filter-bar semantic-filter-bar suggestion-filter-bar" data-suggestion-filters>${semanticFilterSelect("status", ["OPEN", "ACCEPTED", "DISMISSED"], filter.status, "狀態")}${semanticFilterSelect("type", SEMANTIC_TYPES, filter.type, "類型")}${semanticFilterSelect("stale", ["true", "false"], filter.stale, "Stale")}<button class="button secondary compact" type="submit">篩選</button></form>`;
  const generate = button("Generate Suggestions", { kind: "primary", icon: "plus", attrs: 'data-action="generate-semantic-suggestions"' });
  const cards = (data.items || []).map(suggestionCard).join("");
  return shell(`<section class="panel panel-open semantic-registry semantic-suggestions"><header class="panel-head"><div><span class="eyebrow">Governed design-time AI</span><h2>AI Schema Suggestions</h2><p>只以目前可授權的結構化 Schema Metadata 產生草稿建議；不會查詢資料列、不會執行 SQL，也不會自動發佈語意定義。</p></div>${generate}</header>${semanticWorkspaceTabs()}${toolbar}${cards || empty("尚無 AI 語意建議", "選擇少量已授權資料表後，系統會產出需人工檢閱的草稿建議。", generate)}</section>`, semanticShellPage());
}
function semanticTab(id, label, active) { return `<button class="${active ? "active" : ""}" data-semantic-tab="${id}" aria-selected="${active}">${esc(label)}</button>`; }
function semanticApprovalSummary(readiness, history, latest) {
  const policy = readiness.policy;
  const publication = history?.publication;
  const failures = (readiness.failures || []).map((failure) => `<li><code>${esc(failure.code)}</code><span>${esc(failure.message)}</span></li>`).join("");
  const quorum = policy ? `<dl class="definition-grid semantic-definition-grid"><div><dt>Risk</dt><dd>${semanticStatus(policy.riskClass)}</dd></div><div><dt>Required approvals</dt><dd>${Number(policy.requiredApprovals).toLocaleString()}</dd></div><div><dt>Completed</dt><dd>${Number(policy.completedApprovals).toLocaleString()}</dd></div><div><dt>Remaining</dt><dd>${Number(policy.remainingApprovals).toLocaleString()}</dd></div><div><dt>SoD</dt><dd>${policy.allowProposerSelfApproval ? "Explicit low-risk self-approval allowed" : "Proposer self-approval prohibited"}</dd></div><div><dt>Schema snapshot</dt><dd><code>${esc(readiness.schemaSnapshotId || latest.schemaSnapshotId || "—")}</code></dd></div></dl>` : `<p class="muted">尚未設定可適用的 approval policy；系統將維持 fail-closed。</p>`;
  const publicationInfo = publication ? `<section class="semantic-section"><h3>Publication evidence</h3><dl class="definition-grid semantic-definition-grid"><div><dt>Mode</dt><dd>${semanticStatus(publication.publication_mode)}</dd></div><div><dt>Registry version</dt><dd>${esc(publication.registry_version_before)} → ${esc(publication.registry_version_after)}</dd></div><div><dt>Runtime eligibility</dt><dd>${semanticStatus(publication.runtime_eligibility)}</dd></div><div><dt>Post-review</dt><dd>${semanticStatus(publication.post_review_status)}</dd></div></dl>${publication.publication_mode === "EMERGENCY" ? `<p class="semantic-emergency-note">Emergency publication requires a governed post-review by <time>${fmtDate(publication.review_due_at)}</time>.</p>` : ""}</section>` : "";
  const decisions = (history?.decisions || []).map((decision) => `<li>${semanticStatus(decision.decision)} · ${fmtDate(decision.created_at)} · Human approval slot ${esc(decision.approval_slot)}</li>`).join("");
  return `<section class="semantic-section semantic-approval"><header><div><span class="eyebrow">Human publication governance</span><h3>Approval readiness</h3></div>${semanticStatus(readiness.status)}</header>${quorum}${readiness.status === "BLOCKED" ? `<ul class="semantic-validation-list">${failures || `<li><code>${esc(readiness.code)}</code><span>${esc(readiness.message)}</span></li>`}</ul>` : `<p class="semantic-ready-note">Deterministic validation passed. A human authority decision is still required.</p>`}${publicationInfo}<section class="semantic-section"><h3>Approval history</h3><ul class="semantic-history-list">${decisions || "<li>No approval decision recorded.</li>"}</ul></section><p class="semantic-ai-boundary">AI Review Suggestions are advisory only. They cannot approve, publish, suspend, resume, or satisfy quorum.</p></section>`;
}
async function renderSemanticDetail(assetId) {
  const [detail, revisions] = await Promise.all([
    load(`semantics-detail:${assetId}`, `/api/v1/semantics/${encodeURIComponent(assetId)}`),
    load(`semantics-revisions:${assetId}`, `/api/v1/semantics/${encodeURIComponent(assetId)}/revisions`),
  ]);
  const latest = detail.latestRevision;
  const tabs = ["overview", "definition", "sources", "aliases", "history", "approval"];
  if (has("review_semantics")) tabs.push("review");
  if (!tabs.includes(state.semanticDetailTab)) state.semanticDetailTab = "overview";
  const canManage = has("manage_semantic_drafts");
  const canReview = has("review_semantics");
  const actions = `${canManage ? `<button class="button secondary" data-new-semantic-revision="${esc(assetId)}">${icon("plus")}New Draft Revision</button>` : ""}${canManage && latest.status === "DRAFT" ? `<button class="button secondary" data-edit-semantic="${esc(assetId)}">${icon("edit")}Edit Draft</button><button class="button primary" data-submit-semantic="${esc(assetId)}" data-revision-id="${esc(latest.revisionId)}">Submit for Review</button>` : ""}${canReview && latest.status === "IN_REVIEW" ? `<button class="button secondary" data-review-semantic="request-changes" data-asset-id="${esc(assetId)}" data-revision-id="${esc(latest.revisionId)}">Request Changes</button><button class="button danger-outline" data-review-semantic="reject" data-asset-id="${esc(assetId)}" data-revision-id="${esc(latest.revisionId)}">Reject</button>` : ""}${has("approve_semantics") && latest.status === "IN_REVIEW" ? `<button class="button primary" data-approve-semantic="${esc(assetId)}" data-revision-id="${esc(latest.revisionId)}">Approve</button>` : ""}${has("emergency_publish_semantics") && latest.status === "IN_REVIEW" ? `<button class="button danger-outline" data-emergency-semantic="${esc(assetId)}" data-revision-id="${esc(latest.revisionId)}">Emergency Publish</button>` : ""}`;
  let panel = "";
  if (state.semanticDetailTab === "overview") panel = `<section class="semantic-detail-grid"><article class="semantic-section"><h3>Asset</h3><dl class="definition-grid semantic-definition-grid"><div><dt>Canonical name</dt><dd><code>${esc(detail.asset.canonicalName)}</code></dd></div><div><dt>Type</dt><dd>${semanticStatus(detail.asset.assetType)}</dd></div><div><dt>Domain</dt><dd>${esc(detail.asset.domain || "—")}</dd></div><div><dt>Owner</dt><dd><code>${esc(detail.asset.ownerUserId)}</code></dd></div><div><dt>Asset status</dt><dd>${semanticStatus(detail.asset.assetStatus)}</dd></div><div><dt>Created</dt><dd>${fmtDate(detail.asset.createdAt)}</dd></div><div><dt>Updated</dt><dd>${fmtDate(detail.asset.updatedAt)}</dd></div></dl></article><article class="semantic-section"><h3>Revision summary</h3><dl class="definition-grid semantic-definition-grid"><div><dt>Latest revision</dt><dd>v${esc(latest.revisionNumber)} · ${semanticStatus(latest.status)}</dd></div><div><dt>Schema Snapshot</dt><dd><code>${esc(latest.schemaSnapshotId)}</code></dd></div><div><dt>Change reason</dt><dd>${esc(latest.changeReason || "—")}</dd></div><div><dt>Current approved</dt><dd>${detail.currentApprovedRevision ? `v${esc(detail.currentApprovedRevision.revisionNumber)}` : "None"}</dd></div></dl></article></section><section class="semantic-section"><h3>Asset description</h3><p>${esc(detail.asset.description || "尚未提供 Asset 說明。")}</p></section>`;
  if (state.semanticDetailTab === "definition") panel = semanticDefinition(latest.contract, detail.asset.assetType);
  if (state.semanticDetailTab === "sources") panel = `<section class="semantic-section"><h3>Provenance and source mappings</h3><div class="semantic-source-list">${(detail.normalizedSources || []).map((source) => `<div><span>${semanticStatus(source.sourceKind)}</span><code>${source.sourceKind === "SEMANTIC_DEPENDENCY" ? `${source.referencedAssetId} / ${source.referencedRevisionId}` : source.columnName ? `${source.tableName}.${source.columnName}` : source.tableName}</code><small>${esc(source.role)}</small></div>`).join("") || '<p class="muted">No normalized source mappings.</p>'}</div>${detail.relationshipKeys?.length ? `<div class="semantic-key-list">${detail.relationshipKeys.map((key) => `<div><span>${key.ordinalPosition + 1}</span><code>${esc(`${key.leftTable}.${key.leftColumn}`)}</code><b>→</b><code>${esc(`${key.rightTable}.${key.rightColumn}`)}</code></div>`).join("")}</div>` : ""}</section>`;
  if (state.semanticDetailTab === "aliases") panel = `<section class="semantic-section"><h3>Aliases</h3><div class="semantic-alias-list">${(detail.aliases || []).map((alias) => `<span>${esc(alias.alias)}${alias.locale ? `<small>${esc(alias.locale)}</small>` : ""}</span>`).join("") || '<p class="muted">No aliases.</p>'}</div></section>`;
  if (state.semanticDetailTab === "history") panel = `<section class="semantic-section"><h3>Revision history</h3>${table(["Version", "Status", "Schema Snapshot", "Created", "Submitted", "Change reason"], (revisions.items || []).map((revision) => `<tr><td>v${esc(revision.revisionNumber)}</td><td>${semanticStatus(revision.status)}</td><td><code>${esc(revision.schemaSnapshotId)}</code></td><td>${fmtDate(revision.createdAt)}</td><td>${fmtDate(revision.submittedAt)}</td><td>${esc(revision.changeReason || "—")}</td></tr>`).join(""), "semantic-table")}</section>`;
  if (state.semanticDetailTab === "review") {
    const reviews = await load(`semantics-reviews:${assetId}:${latest.revisionId}`, `/api/v1/semantics/${encodeURIComponent(assetId)}/revisions/${encodeURIComponent(latest.revisionId)}/reviews`);
    panel = `<section class="semantic-section"><h3>Review history</h3><div class="semantic-review-list">${(reviews.items || []).map((review) => `<article><header>${semanticStatus(review.action)}<time>${fmtDate(review.createdAt)}</time></header><p>${esc(review.comment || "No comment")}</p><small>Reviewer: <code>${esc(review.reviewerUserId)}</code></small></article>`).join("") || '<p class="muted">No review activity.</p>'}</div></section>`;
  }
  if (state.semanticDetailTab === "approval") {
    const [readiness, history] = await Promise.all([
      api(`/api/v1/semantics/${encodeURIComponent(assetId)}/revisions/${encodeURIComponent(latest.revisionId)}/approval`).catch((error) => ({ status: "BLOCKED", code: error.code || "SEMANTIC_APPROVAL_UNAVAILABLE", message: semanticError(error), failures: [], policy: null })),
      api(`/api/v1/semantics/${encodeURIComponent(assetId)}/revisions/${encodeURIComponent(latest.revisionId)}/approval-history`).catch(() => null),
    ]);
    panel = semanticApprovalSummary(readiness, history, latest);
    if (history?.publication && latest.status === "APPROVED") {
      const runtimeAction = history.publication.runtime_eligibility === "SUSPENDED" ? (has("resume_semantics_runtime") ? `<button class="button secondary" data-resume-semantic="${esc(assetId)}" data-revision-id="${esc(latest.revisionId)}">Resume runtime eligibility</button>` : "") : (has("suspend_semantics_runtime") ? `<button class="button danger-outline" data-suspend-semantic="${esc(assetId)}" data-revision-id="${esc(latest.revisionId)}">Suspend runtime eligibility</button>` : "");
      panel += `<div class="semantic-actions">${runtimeAction}${history.publication.publication_mode === "EMERGENCY" && history.publication.post_review_status === "PENDING" ? `<button class="button secondary" data-post-review-semantic="${esc(assetId)}" data-revision-id="${esc(latest.revisionId)}">Resolve emergency post-review</button>` : ""}</div>`;
    }
  }
  return shell(`<section class="semantic-detail"><header class="semantic-detail-head"><div><button class="text-button semantic-back" data-semantic-back>${icon("chevron")}Back to Definitions</button><span class="eyebrow">Semantic Asset</span><h2>${esc(detail.asset.displayName)}</h2><p>${esc(detail.asset.domain || "Unassigned domain")} · ${semanticStatus(detail.asset.assetType)} ${semanticStatus(detail.asset.assetStatus)}</p></div><div class="semantic-actions">${actions}</div></header><nav class="semantic-tabs" aria-label="Semantic asset sections">${tabs.map((tab) => semanticTab(tab, tab === "overview" ? "Overview" : tab === "definition" ? "Definition" : tab === "sources" ? "Sources" : tab === "aliases" ? "Aliases" : tab === "history" ? "Revision History" : tab === "review" ? "Review" : "Approval", state.semanticDetailTab === tab)).join("")}</nav>${panel}</section>`, semanticShellPage());
}
async function renderSemantics() { return state.semanticAssetId ? renderSemanticDetail(state.semanticAssetId) : state.semanticWorkspace === "suggestions" && has("manage_semantic_drafts") ? renderSemanticSuggestions() : renderSemanticRegistry(); }

function semanticAliasRows(aliases = []) {
  return aliases.map((item) => `<div class="semantic-repeat-row" data-semantic-alias><label>Alias<input name="semantic-alias" maxlength="120" value="${esc(item.alias || "")}" required></label><label>Locale<input name="semantic-alias-locale" maxlength="16" value="${esc(item.locale || "")}" placeholder="zh-TW"></label><button class="icon-button danger" type="button" data-remove-semantic-row aria-label="移除別名">${icon("trash")}</button></div>`).join("");
}
function semanticDependencyRows(dependencies = []) {
  return dependencies.map((item) => `<div class="semantic-repeat-row" data-semantic-dependency><label>Asset ID<input name="semantic-dependency-asset" maxlength="128" value="${esc(item.referencedAssetId || "")}" required></label><label>Revision ID<input name="semantic-dependency-revision" maxlength="128" value="${esc(item.referencedRevisionId || "")}" required></label><button class="icon-button danger" type="button" data-remove-semantic-row aria-label="移除相依性">${icon("trash")}</button></div>`).join("");
}
function semanticGrainFields(prefix, grain, catalog, optional = false) {
  const entity = grain?.kind === "ENTITY";
  const selected = entity ? (grain.source?.keyColumns || []).map((column) => `${grain.source?.table}.${column}`) : [semanticSourceValue(grain?.source)].filter(Boolean);
  const values = catalog.flatMap(({ table: tableName, columns }) => columns.map((column) => semanticOption(`${tableName}.${column}`, `${tableName}.${column}`, selected.includes(`${tableName}.${column}`)))).join("");
  const none = optional ? semanticOption("", "不設定", !grain) : "";
  return `<fieldset class="semantic-fieldset" data-semantic-grain="${prefix}"><legend>${optional ? "Native grain（選填）" : "Native grain"}</legend><div class="semantic-inline-fields"><label>Kind<select name="${prefix}-grain-kind" ${!catalog.length ? "disabled" : ""}>${none}${semanticOption("ENTITY", "ENTITY", entity)}${semanticOption("TIME", "TIME", grain?.kind === "TIME")}</select></label><label>Key<input name="${prefix}-grain-key" maxlength="120" value="${esc(grain?.key || "")}" ${optional ? "" : "required"} placeholder="order_item"></label><label>Physical columns<select name="${prefix}-grain-columns" multiple ${!catalog.length ? "disabled" : ""} ${optional ? "" : "required"}>${values}</select></label><label>Time unit<select name="${prefix}-grain-time-unit" ${!catalog.length ? "disabled" : ""}>${["day", "week", "month", "quarter", "year"].map((item) => semanticOption(item, item, grain?.timeUnit === item)).join("")}</select></label></div><small class="semantic-help">ENTITY 支援同一資料表中的多欄位鍵；TIME 使用一個時間欄位。</small></fieldset>`;
}
function semanticExpressionNode(expression, catalog, depth = 1) {
  const value = expression || { kind: "COLUMN", source: {} };
  const kind = value.kind || "COLUMN";
  const kinds = ["COLUMN", "LITERAL", "ADD", "SUBTRACT", "MULTIPLY", "DIVIDE", "SUM", "COUNT", "COUNT_DISTINCT", "AVG", "MIN", "MAX"];
  let body = "";
  if (kind === "COLUMN" || kind === "COUNT_DISTINCT") body = `<label>Column${semanticSourceSelect("semantic-expression-source", catalog, semanticSourceValue(value.source), { required: true })}</label>`;
  if (kind === "LITERAL") body = `<label>Numeric literal<input data-expression-literal type="number" step="any" value="${Number.isFinite(Number(value.value)) ? esc(value.value) : "0"}" required></label>`;
  if (["ADD", "SUBTRACT", "MULTIPLY", "DIVIDE"].includes(kind)) body = `<div class="semantic-expression-children"><div data-expression-child="left">${semanticExpressionNode(value.left, catalog, depth + 1)}</div><div data-expression-child="right">${semanticExpressionNode(value.right, catalog, depth + 1)}</div></div>${kind === "DIVIDE" ? '<small class="semantic-help">Division by zero returns NULL.</small>' : ""}`;
  if (["SUM", "AVG", "MIN", "MAX"].includes(kind)) body = `<div class="semantic-expression-children"><div data-expression-child="argument">${semanticExpressionNode(value.argument, catalog, depth + 1)}</div></div>`;
  if (kind === "COUNT") body = `<label>Count mode<select data-expression-count-mode><option value="ROWS" ${value.mode === "ROWS" ? "selected" : ""}>ROWS</option><option value="COLUMN" ${value.mode === "COLUMN" ? "selected" : ""}>COLUMN</option></select></label>${value.mode === "COLUMN" ? `<label>Column${semanticSourceSelect("semantic-expression-source", catalog, semanticSourceValue(value.source), { required: true })}</label>` : ""}`;
  return `<div class="semantic-expression" data-expression-node data-expression-depth="${depth}"><div class="semantic-expression-head"><span>Expression</span><select data-expression-kind ${depth >= 12 ? "disabled" : ""}>${kinds.map((item) => semanticOption(item, item, item === kind)).join("")}</select></div><div class="semantic-expression-body">${body}</div></div>`;
}
function semanticMetricSourceRow(source, catalog) {
  return `<div class="semantic-repeat-row semantic-metric-source-row" data-semantic-metric-source><label>Source${semanticSourceSelect("semantic-metric-source", catalog, semanticSourceValue(source?.ref), { required: true })}</label><label>Role<select data-metric-source-role>${["value", "join", "filter", "time"].map((role) => semanticOption(role, role, source?.role === role)).join("")}</select></label><button class="icon-button danger" type="button" data-remove-semantic-row aria-label="移除來源">${icon("trash")}</button></div>`;
}
function semanticFilterRow(filter, catalog) {
  const value = Array.isArray(filter?.value) ? filter.value.join(", ") : filter?.value ?? "";
  return `<div class="semantic-repeat-row semantic-filter-row" data-semantic-filter><label>Field${semanticSourceSelect("semantic-filter-source", catalog, semanticSourceValue(filter?.field), { required: true })}</label><label>Operator<select data-semantic-filter-operator>${SEMANTIC_FILTER_OPERATORS.map((operator) => semanticOption(operator, operator, filter?.operator === operator)).join("")}</select></label><label>Value<input data-semantic-filter-value maxlength="240" value="${esc(value)}" placeholder="逗號分隔 IN 值"></label><button class="icon-button danger" type="button" data-remove-semantic-row aria-label="移除篩選">${icon("trash")}</button></div>`;
}
function semanticRelationshipKeyRow(key, catalog) {
  return `<div class="semantic-repeat-row semantic-relationship-key" data-semantic-relationship-key><label>Left column${semanticSourceSelect("semantic-left-key", catalog, semanticSourceValue(key && { table: key.leftTable, column: key.leftColumn }), { required: true })}</label><label>Right column${semanticSourceSelect("semantic-right-key", catalog, semanticSourceValue(key && { table: key.rightTable, column: key.rightColumn }), { required: true })}</label><button class="icon-button danger" type="button" data-remove-semantic-row aria-label="移除 Join key">${icon("trash")}</button></div>`;
}
function semanticContractFields(type, contract, catalog) {
  const common = `<label>Business definition<textarea name="semantic-definition" maxlength="2000" required>${esc(contract.definition || "")}</textarea></label>`;
  const dependencies = `<fieldset class="semantic-fieldset"><legend>Pinned semantic dependencies</legend><p class="semantic-help">每個相依性必須明確 pin 至 Asset ID 與已核准的 Revision ID；不會自動解析 latest。</p><div data-semantic-dependencies>${semanticDependencyRows(contract.semanticDependencies || [])}</div><button type="button" class="button secondary compact" data-add-semantic-dependency>${icon("plus")}Add dependency</button></fieldset>`;
  if (type === "TERM") return `${common}<fieldset class="semantic-fieldset"><legend>Source mapping</legend><label>Source column（選填）${semanticSourceSelect("semantic-term-source", catalog, semanticSourceValue(contract.source))}</label></fieldset>${dependencies}`;
  if (type === "DIMENSION") return `${common}<fieldset class="semantic-fieldset"><legend>Dimension structure</legend><div class="semantic-inline-fields"><label>Source column${semanticSourceSelect("semantic-dimension-source", catalog, semanticSourceValue(contract.source), { required: true })}</label><label>Data type<input name="semantic-dimension-data-type" maxlength="80" value="${esc(contract.dataType || "TEXT")}" required></label></div><fieldset class="semantic-checkbox-group"><legend>Allowed operations</legend>${["GROUP", "FILTER", "ORDER"].map((operation) => `<label class="check"><input type="checkbox" name="semantic-dimension-operation" value="${operation}" ${(contract.allowedOperations || []).includes(operation) ? "checked" : ""}> ${operation}</label>`).join("")}</fieldset></fieldset>${semanticGrainFields("semantic-dimension", contract.nativeGrain, catalog, true)}${dependencies}`;
  if (type === "METRIC") return `${common}<fieldset class="semantic-fieldset"><legend>Metric sources</legend><div data-semantic-metric-sources>${(contract.sources || []).map((source) => semanticMetricSourceRow(source, catalog)).join("")}</div><button type="button" class="button secondary compact" data-add-metric-source>${icon("plus")}Add source</button></fieldset><fieldset class="semantic-fieldset"><legend>Formula Builder</legend><p class="semantic-help">僅能建立受限結構式 AST；不支援 SQL 表達式。</p><div data-semantic-expression-root>${semanticExpressionNode(contract.expression, catalog)}</div></fieldset><fieldset class="semantic-fieldset"><legend>Default filters</legend><div data-semantic-filters>${(contract.defaultFilters || []).map((filter) => semanticFilterRow(filter, catalog)).join("")}</div><button type="button" class="button secondary compact" data-add-semantic-filter>${icon("plus")}Add filter</button></fieldset>${semanticGrainFields("semantic-metric", contract.nativeGrain, catalog)}<fieldset class="semantic-fieldset"><legend>Metric metadata</legend><div class="semantic-inline-fields"><label>Time dimension（選填）${semanticSourceSelect("semantic-metric-time-dimension", catalog, semanticSourceValue(contract.timeDimension))}</label><label>Unit<select name="semantic-metric-unit">${SEMANTIC_UNITS.map((unit) => semanticOption(unit, unit, contract.unit === unit)).join("")}</select></label><label>Currency<input name="semantic-metric-currency" maxlength="12" value="${esc(contract.currency || "")}" placeholder="TWD"></label></div></fieldset>${dependencies}`;
  return `${common}<fieldset class="semantic-fieldset"><legend>Relationship structure</legend><div class="semantic-inline-fields"><label>Left table${semanticTableSelect("semantic-relationship-left-table", catalog, contract.leftTable)}</label><label>Right table${semanticTableSelect("semantic-relationship-right-table", catalog, contract.rightTable)}</label><label>Cardinality<select name="semantic-relationship-cardinality">${SEMANTIC_CARDINALITIES.map((value) => semanticOption(value, value, value === contract.cardinality)).join("")}</select></label></div><div data-semantic-relationship-keys>${(contract.joinKeys || []).map((key) => semanticRelationshipKeyRow(key, catalog)).join("")}</div><button type="button" class="button secondary compact" data-add-semantic-relationship-key>${icon("plus")}Add ordered join key</button></fieldset>${dependencies}`;
}
function semanticIdentityFields(mode, asset, contract) {
  const editable = mode === "create" || mode === "suggestion";
  if (!editable) return `<section class="semantic-form-summary"><span class="eyebrow">Asset identity is immutable here</span><h3>${esc(asset.displayName)}</h3><p><code>${esc(asset.canonicalName)}</code> · ${esc(asset.domain || "Unassigned domain")}</p></section>`;
  const typeControl = mode === "suggestion" ? `<input type="hidden" name="semantic-asset-type" value="${esc(asset.assetType)}"><span class="semantic-fixed-value">${esc(asset.assetType)}</span>` : `<select name="semantic-asset-type" required>${SEMANTIC_TYPES.map((value) => semanticOption(value, value, value === asset.assetType)).join("")}</select>`;
  return `<fieldset class="semantic-fieldset"><legend>Asset identity</legend><div class="semantic-inline-fields"><label>Semantic type${typeControl}</label><label>Canonical name<input name="semantic-canonical-name" pattern="[a-z][a-z0-9_]*" maxlength="120" value="${esc(contract.canonicalName || "")}" required placeholder="sales_revenue"></label><label>Display name<input name="semantic-display-name" maxlength="160" value="${esc(contract.displayName || "")}" required></label><label>Domain<input name="semantic-domain" maxlength="80" value="${esc(contract.domain || "")}"></label></div><label>Asset description<textarea name="semantic-asset-description" maxlength="2000">${esc(asset.description || "")}</textarea></label></fieldset>`;
}
function semanticFormMarkup(mode, asset, revision, catalog) {
  const type = asset.assetType || "TERM";
  const contract = revision?.contract || semanticDefaultContract(type, asset);
  const title = mode === "create" ? "Create Semantic Asset" : mode === "suggestion" ? "Review AI suggestion as Draft" : mode === "edit" ? `Edit Draft v${revision.revisionNumber}` : `Create Draft v${Number(revision.revisionNumber) + 1}`;
  const body = mode === "suggestion" ? "請檢閱並調整 AI 建議後，再明確建立 DRAFT。原始建議會保留且不會被改寫。" : mode === "create" ? "建立 Asset 與第一版 DRAFT。此操作不會改變查詢執行期。" : "目前已核准的定義保持不變；此草稿只在治理流程中存在。";
  const action = mode === "edit" ? "Save Draft" : mode === "create" || mode === "suggestion" ? "Create Draft" : "Create Draft Revision";
  return `<form class="modal-form semantic-form" data-semantic-form><span class="eyebrow">Design-time governance only</span><h2>${esc(title)}</h2><p>${body}</p>${semanticIdentityFields(mode, asset, contract)}<div data-semantic-contract-fields>${semanticContractFields(type, contract, catalog)}</div><fieldset class="semantic-fieldset"><legend>Aliases</legend><div data-semantic-aliases>${semanticAliasRows(revision?.aliases || [])}</div><button type="button" class="button secondary compact" data-add-semantic-alias>${icon("plus")}Add alias</button></fieldset><label>Change reason（選填）<textarea name="semantic-change-reason" maxlength="1000">${esc(revision?.changeReason || "")}</textarea></label><p class="semantic-form-error" data-semantic-form-error role="alert" hidden></p><button class="button primary" type="submit">${icon("check")}${action}</button></form>`;
}
function appendSemanticRow(container, html) { container.insertAdjacentHTML("beforeend", html); }
function bindSemanticComposer(dialog, context, catalog) {
  const form = dialog.querySelector("[data-semantic-form]");
  if (!form) return;
  const setDirty = () => { form.dataset.dirty = "true"; };
  form.addEventListener("input", setDirty);
  form.addEventListener("change", setDirty);
  const contractFields = form.querySelector("[data-semantic-contract-fields]");
  form.querySelector('[name="semantic-asset-type"]')?.addEventListener("change", (event) => {
    const type = event.target.value;
    contractFields.innerHTML = semanticContractFields(type, semanticDefaultContract(type, { canonicalName: form.elements["semantic-canonical-name"]?.value || "", displayName: form.elements["semantic-display-name"]?.value || "", domain: form.elements["semantic-domain"]?.value || "" }), catalog);
    bindSemanticComposerDynamic(form, catalog);
  });
  bindSemanticComposerDynamic(form, catalog);
  dialog.querySelector(".modal-close").onclick = () => { if (!form.dataset.dirty || confirm("尚有未儲存的語意草稿，確定離開嗎？")) dialog.close(); };
  form.addEventListener("submit", (event) => { event.preventDefault(); void submitSemanticForm(dialog, form, context); });
}
function bindSemanticComposerDynamic(form, catalog) {
  form.querySelectorAll("[data-remove-semantic-row]").forEach((button) => { button.onclick = () => { button.closest(".semantic-repeat-row")?.remove(); }; });
  const addRow = (selector, row) => {
    const button = form.querySelector(selector);
    if (!button) return;
    button.onclick = () => { appendSemanticRow(form.querySelector(row.container), row.markup()); bindSemanticComposerDynamic(form, catalog); };
  };
  addRow("[data-add-semantic-alias]", { container: "[data-semantic-aliases]", markup: () => semanticAliasRows([{ alias: "", locale: "" }]) });
  addRow("[data-add-semantic-dependency]", { container: "[data-semantic-dependencies]", markup: () => semanticDependencyRows([{ referencedAssetId: "", referencedRevisionId: "" }]) });
  addRow("[data-add-metric-source]", { container: "[data-semantic-metric-sources]", markup: () => semanticMetricSourceRow({}, catalog) });
  addRow("[data-add-semantic-filter]", { container: "[data-semantic-filters]", markup: () => semanticFilterRow({}, catalog) });
  addRow("[data-add-semantic-relationship-key]", { container: "[data-semantic-relationship-keys]", markup: () => semanticRelationshipKeyRow({}, catalog) });
  form.querySelectorAll("[data-expression-kind], [data-expression-count-mode]").forEach((select) => {
    select.onchange = () => {
      const node = select.closest("[data-expression-node]");
      const kind = node.querySelector("[data-expression-kind]")?.value || "COLUMN";
      const countMode = node.querySelector("[data-expression-count-mode]")?.value;
      const next = { kind, ...(kind === "COUNT" ? { mode: countMode || "ROWS" } : {}) };
      node.outerHTML = semanticExpressionNode(next, catalog, Number(node.dataset.expressionDepth || 1));
      bindSemanticComposerDynamic(form, catalog);
    };
  });
}
function readSemanticAliases(form) {
  return [...form.querySelectorAll("[data-semantic-alias]")].map((row) => ({ alias: row.querySelector('[name="semantic-alias"]')?.value.trim() || "", locale: row.querySelector('[name="semantic-alias-locale"]')?.value.trim() || undefined }));
}
function readSemanticDependencies(form) {
  return [...form.querySelectorAll("[data-semantic-dependency]")].map((row) => ({ referencedAssetId: row.querySelector('[name="semantic-dependency-asset"]')?.value.trim() || "", referencedRevisionId: row.querySelector('[name="semantic-dependency-revision"]')?.value.trim() || "" }));
}
function readSemanticGrain(form, prefix, required) {
  const kind = form.elements[`${prefix}-grain-kind`]?.value || "";
  if (!kind) { if (required) throw new Error("必須設定 Native grain。"); return undefined; }
  const key = form.elements[`${prefix}-grain-key`]?.value.trim();
  const selected = [...form.querySelector(`[name="${prefix}-grain-columns"]`)?.selectedOptions || []].map((option) => semanticSourceFromValue(option.value, "Grain anchor"));
  if (!key || !selected.length) throw new Error("Native grain 必須包含 key 與實體 Schema 欄位。");
  if (kind === "TIME") return { kind, key, source: selected[0], timeUnit: form.elements[`${prefix}-grain-time-unit`]?.value || "day" };
  const table = selected[0].table;
  if (selected.some((source) => source.table !== table)) throw new Error("ENTITY grain 的欄位必須來自同一資料表。");
  return { kind: "ENTITY", key, source: { table, keyColumns: selected.map((source) => source.column) } };
}
function readSemanticExpression(node) {
  const kind = node.querySelector(":scope > .semantic-expression-head [data-expression-kind]")?.value;
  const source = () => semanticSourceFromValue(node.querySelector("[data-semantic-source]")?.value, "Formula column");
  if (kind === "COLUMN") return { kind, source: source() };
  if (kind === "LITERAL") { const value = Number(node.querySelector("[data-expression-literal]")?.value); if (!Number.isFinite(value)) throw new Error("Formula literal 必須為數字。"); return { kind, value }; }
  if (kind === "COUNT_DISTINCT") return { kind, source: source() };
  if (kind === "COUNT") { const mode = node.querySelector("[data-expression-count-mode]")?.value || "ROWS"; return mode === "ROWS" ? { kind, mode } : { kind, mode, source: source() }; }
  const child = (name) => node.querySelector(`:scope > .semantic-expression-body > .semantic-expression-children > [data-expression-child="${name}"] > [data-expression-node]`);
  if (["ADD", "SUBTRACT", "MULTIPLY", "DIVIDE"].includes(kind)) { const result = { kind, left: readSemanticExpression(child("left")), right: readSemanticExpression(child("right")) }; return kind === "DIVIDE" ? { ...result, divisionByZero: "NULL" } : result; }
  if (["SUM", "AVG", "MIN", "MAX"].includes(kind)) return { kind, argument: readSemanticExpression(child("argument")) };
  throw new Error("Formula operator is invalid.");
}
function readSemanticContract(form, context) {
  const editableIdentity = context.mode === "create" || context.mode === "suggestion";
  const type = editableIdentity ? form.elements["semantic-asset-type"]?.value : context.asset.assetType;
  const canonicalName = editableIdentity ? form.elements["semantic-canonical-name"]?.value.trim() : context.asset.canonicalName;
  const displayName = editableIdentity ? form.elements["semantic-display-name"]?.value.trim() : context.asset.displayName;
  const domain = editableIdentity ? form.elements["semantic-domain"]?.value.trim() : context.latest.contract.domain;
  const common = { canonicalName, displayName, definition: form.elements["semantic-definition"]?.value.trim() || "", domain, semanticDependencies: readSemanticDependencies(form) };
  if (type === "TERM") { const raw = form.elements["semantic-term-source"]?.value; return { ...common, ...(raw ? { source: semanticSourceFromValue(raw) } : {}) }; }
  if (type === "DIMENSION") {
    const nativeGrain = readSemanticGrain(form, "semantic-dimension", false);
    return { ...common, source: semanticSourceFromValue(form.elements["semantic-dimension-source"]?.value), dataType: form.elements["semantic-dimension-data-type"]?.value.trim() || "TEXT", allowedOperations: [...form.querySelectorAll('[name="semantic-dimension-operation"]:checked')].map((input) => input.value), ...(nativeGrain ? { nativeGrain } : {}) };
  }
  if (type === "METRIC") {
    const sources = [...form.querySelectorAll("[data-semantic-metric-source]")].map((row) => ({ ref: semanticSourceFromValue(row.querySelector("[data-semantic-source]")?.value), role: row.querySelector("[data-metric-source-role]")?.value }));
    const defaultFilters = [...form.querySelectorAll("[data-semantic-filter]")].map((row) => { const operator = row.querySelector("[data-semantic-filter-operator]")?.value; const raw = row.querySelector("[data-semantic-filter-value]")?.value.trim() || ""; const filter = { field: semanticSourceFromValue(row.querySelector("[data-semantic-source]")?.value), operator }; if (operator !== "IS_NULL" && operator !== "IS_NOT_NULL") filter.value = operator === "IN" || operator === "NOT_IN" ? raw.split(",").map((item) => item.trim()).filter(Boolean) : raw; return filter; });
    const unit = form.elements["semantic-metric-unit"]?.value;
    const currency = form.elements["semantic-metric-currency"]?.value.trim();
    const timeRaw = form.elements["semantic-metric-time-dimension"]?.value;
    return { ...common, sources, expression: readSemanticExpression(form.querySelector("[data-semantic-expression-root] > [data-expression-node]")), defaultFilters, nativeGrain: readSemanticGrain(form, "semantic-metric", true), ...(timeRaw ? { timeDimension: semanticSourceFromValue(timeRaw) } : {}), unit, ...(unit === "CURRENCY" ? { currency } : {}) };
  }
  const joinKeys = [...form.querySelectorAll("[data-semantic-relationship-key]")].map((row) => { const left = semanticSourceFromValue(row.querySelector('[name="semantic-left-key"]')?.value); const right = semanticSourceFromValue(row.querySelector('[name="semantic-right-key"]')?.value); return { leftTable: left.table, leftColumn: left.column, rightTable: right.table, rightColumn: right.column }; });
  return { ...common, leftTable: form.elements["semantic-relationship-left-table"]?.value, rightTable: form.elements["semantic-relationship-right-table"]?.value, cardinality: form.elements["semantic-relationship-cardinality"]?.value, joinKeys };
}
async function openSemanticForm(mode, assetId = null, suggestion = null) {
  try {
    const catalogPromise = semanticCatalog();
    const detail = assetId ? await api(`/api/v1/semantics/${encodeURIComponent(assetId)}`) : null;
    const catalog = await catalogPromise;
    const suggestionAsset = suggestion ? { assetType: suggestion.suggestionType, canonicalName: suggestion.canonicalName, displayName: suggestion.displayName, domain: suggestion.suggestion?.contract?.domain || "", description: "" } : null;
    const suggestionLatest = suggestion ? { revisionNumber: 0, contract: suggestion.suggestion.contract, aliases: suggestion.suggestion.aliases || [], changeReason: "AI suggestion reviewed by a human." } : null;
    const asset = detail?.asset || suggestionAsset || { assetType: "TERM", canonicalName: "", displayName: "", domain: "", description: "" };
    const latest = detail ? { ...detail.latestRevision, aliases: detail.aliases || [] } : suggestionLatest;
    const dialog = modal(semanticFormMarkup(mode, asset, latest, catalog));
    bindSemanticComposer(dialog, { mode, asset, latest, suggestionId: suggestion?.suggestionId || null }, catalog);
  } catch (error) { toast(semanticError(error), "error"); }
}
async function submitSemanticForm(dialog, form, context) {
  if (state.semanticMutationPending) return;
  const errorBox = form.querySelector("[data-semantic-form-error]");
  try {
    state.semanticMutationPending = true;
    form.querySelector('[type="submit"]').disabled = true;
    const contract = readSemanticContract(form, context);
    const aliases = readSemanticAliases(form);
    const changeReason = form.elements["semantic-change-reason"]?.value.trim() || "";
    let response;
    if (context.mode === "create") response = await api("/api/v1/semantics", { method: "POST", body: JSON.stringify({ assetType: context.mode === "create" ? form.elements["semantic-asset-type"].value : context.asset.assetType, canonicalName: contract.canonicalName, displayName: contract.displayName, domain: contract.domain, description: form.elements["semantic-asset-description"]?.value.trim() || "", contract, aliases, changeReason }) });
    else if (context.mode === "suggestion") response = await api(`/api/v1/semantics/suggestions/${encodeURIComponent(context.suggestionId)}/accept-as-draft`, { method: "POST", body: JSON.stringify({ canonicalName: contract.canonicalName, displayName: contract.displayName, domain: contract.domain, description: form.elements["semantic-asset-description"]?.value.trim() || "", contract, aliases, changeReason }) });
    else if (context.mode === "edit") response = await api(`/api/v1/semantics/${encodeURIComponent(context.asset.assetId)}/revisions/${encodeURIComponent(context.latest.revisionId)}`, { method: "PATCH", body: JSON.stringify({ contract, aliases, changeReason }) });
    else response = await api(`/api/v1/semantics/${encodeURIComponent(context.asset.assetId)}/revisions`, { method: "POST", body: JSON.stringify({ contract, aliases, changeReason }) });
    invalidateSemantics();
    state.semanticAssetId = response.assetId;
    state.semanticDetailTab = "overview";
    dialog.close();
    toast(context.mode === "edit" ? "Draft 已儲存" : context.mode === "suggestion" ? "AI 建議已建立為待治理的 Draft" : context.mode === "create" ? "Semantic Asset Draft 已建立" : "新的 Draft Revision 已建立");
    void render();
  } catch (error) {
    errorBox.textContent = error instanceof Error && !error.code ? error.message : semanticError(error);
    errorBox.hidden = false;
    form.querySelector('[type="submit"]').disabled = false;
  } finally { state.semanticMutationPending = false; }
}
function semanticReviewDialog(action, assetId, revisionId) {
  const isReject = action === "reject";
  const dialog = modal(`<form class="modal-form semantic-review-form"><span class="eyebrow">Reviewer action</span><h2>${isReject ? "Reject Revision" : "Request Changes"}</h2><p>${isReject ? "Rejecting ends this revision's review lifecycle. The asset and all history remain preserved." : "This revision will return to DRAFT for its manager to update."}</p><label>Review comment<textarea name="comment" maxlength="2000" required></textarea></label><p class="semantic-form-error" role="alert" hidden></p><button class="button ${isReject ? "danger-outline" : "primary"}" type="submit">${isReject ? "Reject Revision" : "Request Changes"}</button></form>`);
  const form = dialog.querySelector("form");
  form.onsubmit = async (event) => {
    event.preventDefault();
    const button = form.querySelector('[type="submit"]');
    const errorBox = form.querySelector(".semantic-form-error");
    try {
      button.disabled = true;
      await api(`/api/v1/semantics/${encodeURIComponent(assetId)}/revisions/${encodeURIComponent(revisionId)}/${action}`, { method: "POST", body: JSON.stringify({ comment: new FormData(form).get("comment") }) });
      invalidateSemantics(); dialog.close(); toast(isReject ? "Revision 已駁回" : "Revision 已退回草稿"); void render();
    } catch (error) { errorBox.textContent = semanticError(error); errorBox.hidden = false; button.disabled = false; }
  };
}
async function submitSemanticForReview(assetId, revisionId) {
  if (!confirm("確定送交審查？送出後 Draft 將不可編輯，直到審查者要求修改。")) return;
  try { await api(`/api/v1/semantics/${encodeURIComponent(assetId)}/revisions/${encodeURIComponent(revisionId)}/submit-review`, { method: "POST" }); invalidateSemantics(); toast("Revision 已送交審查"); void render(); } catch (error) { toast(semanticError(error), "error"); }
}

function semanticIdempotencyKey() { return crypto.randomUUID().replaceAll("-", ""); }
async function semanticGovernanceMutation(assetId, revisionId, action, body, success) {
  try {
    await api(`/api/v1/semantics/${encodeURIComponent(assetId)}/revisions/${encodeURIComponent(revisionId)}/${action}`, { method: "POST", body: JSON.stringify({ idempotencyKey: semanticIdempotencyKey(), ...body }) });
    invalidateSemantics();
    state.semanticDetailTab = "approval";
    toast(success);
    void render();
  } catch (error) { toast(semanticError(error), "error"); }
}
function approveSemanticDialog(assetId, revisionId) {
  const dialog = modal(`<form class="modal-form semantic-review-form"><span class="eyebrow">Human approval</span><h2>Approve Semantic Revision</h2><p>此操作只會由目前設定的 Human Semantic Authority 記錄。若尚未達 quorum，revision 會留在 IN_REVIEW。</p><label>Bounded approval note（選填）<textarea name="comment" maxlength="2000"></textarea></label><p class="semantic-form-error" role="alert" hidden></p><button class="button primary" type="submit">Approve revision</button></form>`);
  const form = dialog.querySelector("form");
  form.onsubmit = async (event) => { event.preventDefault(); const submit = form.querySelector('[type="submit"]'); const errorBox = form.querySelector(".semantic-form-error"); try { submit.disabled = true; await api(`/api/v1/semantics/${encodeURIComponent(assetId)}/revisions/${encodeURIComponent(revisionId)}/approve`, { method: "POST", body: JSON.stringify({ idempotencyKey: semanticIdempotencyKey(), comment: new FormData(form).get("comment") }) }); invalidateSemantics(); dialog.close(); state.semanticDetailTab = "approval"; toast("Human approval 已記錄"); void render(); } catch (error) { errorBox.textContent = semanticError(error); errorBox.hidden = false; submit.disabled = false; } };
}
function emergencySemanticDialog(assetId, revisionId) {
  const minDue = new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 16);
  const dialog = modal(`<form class="modal-form semantic-review-form"><span class="eyebrow">Break-glass governance</span><h2>Emergency Publish</h2><p class="semantic-emergency-note">Emergency publication is exceptional. It never bypasses deterministic schema, source, AST, authority or audit controls. A post-review deadline is mandatory.</p><label>Emergency reason<textarea name="reason" maxlength="1000" required></textarea></label><label>Incident / change reference<input name="changeReference" maxlength="160" required placeholder="INC-123 or CHG-123"></label><label>Post-review deadline<input name="reviewDueAt" type="datetime-local" min="${minDue}" required></label><p class="semantic-form-error" role="alert" hidden></p><button class="button danger-outline" type="submit">Confirm emergency publication</button></form>`);
  const form = dialog.querySelector("form");
  form.onsubmit = async (event) => { event.preventDefault(); const submit = form.querySelector('[type="submit"]'); const errorBox = form.querySelector(".semantic-form-error"); const data = new FormData(form); try { submit.disabled = true; await api(`/api/v1/semantics/${encodeURIComponent(assetId)}/revisions/${encodeURIComponent(revisionId)}/emergency-publish`, { method: "POST", body: JSON.stringify({ idempotencyKey: semanticIdempotencyKey(), reason: data.get("reason"), changeReference: data.get("changeReference"), reviewDueAt: new Date(String(data.get("reviewDueAt"))).toISOString() }) }); invalidateSemantics(); dialog.close(); state.semanticDetailTab = "approval"; toast("Emergency publication 已完成；請於期限前完成 post-review", "warning"); void render(); } catch (error) { errorBox.textContent = semanticError(error); errorBox.hidden = false; submit.disabled = false; } };
}
function runtimeSemanticDialog(assetId, revisionId, action) {
  const label = action === "suspend-runtime" ? "Suspend runtime eligibility" : "Resume runtime eligibility";
  const dialog = modal(`<form class="modal-form semantic-review-form"><span class="eyebrow">Runtime eligibility</span><h2>${label}</h2><p>這只會治理未來 P2-F runtime eligibility；P2-E 不會改變目前 Chat 或 Direct Query 行為，也不會改寫核准歷史。</p><label>Governance reason<textarea name="reason" maxlength="1000" required></textarea></label><p class="semantic-form-error" role="alert" hidden></p><button class="button ${action === "suspend-runtime" ? "danger-outline" : "primary"}" type="submit">${label}</button></form>`);
  const form = dialog.querySelector("form");
  form.onsubmit = async (event) => { event.preventDefault(); const submit = form.querySelector('[type="submit"]'); const errorBox = form.querySelector(".semantic-form-error"); try { submit.disabled = true; await api(`/api/v1/semantics/${encodeURIComponent(assetId)}/revisions/${encodeURIComponent(revisionId)}/${action}`, { method: "POST", body: JSON.stringify({ idempotencyKey: semanticIdempotencyKey(), reason: new FormData(form).get("reason") }) }); invalidateSemantics(); dialog.close(); state.semanticDetailTab = "approval"; toast(action === "suspend-runtime" ? "Runtime eligibility 已暫停" : "Runtime eligibility 已恢復"); void render(); } catch (error) { errorBox.textContent = semanticError(error); errorBox.hidden = false; submit.disabled = false; } };
}
function postReviewSemanticDialog(assetId, revisionId) {
  const dialog = modal(`<form class="modal-form semantic-review-form"><span class="eyebrow">Emergency post-review</span><h2>Resolve post-review obligation</h2><p>確認不會改寫歷史 Approved revision；若需要更正，請另外建立受治理的新 Draft 或採取 runtime suspension。</p><label>Resolution<select name="resolution"><option value="CONFIRMED">CONFIRMED</option><option value="REQUIRES_CORRECTION">REQUIRES_CORRECTION</option></select></label><label>Bounded reason（requires correction 時必填）<textarea name="reason" maxlength="1000"></textarea></label><p class="semantic-form-error" role="alert" hidden></p><button class="button primary" type="submit">Resolve post-review</button></form>`);
  const form = dialog.querySelector("form");
  form.onsubmit = async (event) => { event.preventDefault(); const submit = form.querySelector('[type="submit"]'); const errorBox = form.querySelector(".semantic-form-error"); const data = new FormData(form); if (data.get("resolution") === "REQUIRES_CORRECTION" && !String(data.get("reason") || "").trim()) { errorBox.textContent = "REQUIRES_CORRECTION requires a bounded reason."; errorBox.hidden = false; return; } try { submit.disabled = true; await api(`/api/v1/semantics/${encodeURIComponent(assetId)}/revisions/${encodeURIComponent(revisionId)}/post-review`, { method: "POST", body: JSON.stringify({ idempotencyKey: semanticIdempotencyKey(), resolution: data.get("resolution"), reason: data.get("reason") }) }); invalidateSemantics(); dialog.close(); state.semanticDetailTab = "approval"; toast("Emergency post-review 已記錄"); void render(); } catch (error) { errorBox.textContent = semanticError(error); errorBox.hidden = false; submit.disabled = false; } };
}

async function openSemanticSuggestionGenerator() {
  try {
    const catalog = await semanticSuggestionCatalog();
    if (!catalog.length) { toast("目前沒有可選的已授權 Schema 資料表。", "error"); return; }
    const tableOptions = catalog.slice(0, 8).map((item) => `<label class="check"><input type="checkbox" name="tableName" value="${esc(item.table)}"> ${esc(item.table)} <small>(${item.columns.length} columns)</small></label>`).join("");
    const dialog = modal(`<form class="modal-form semantic-suggestion-generator"><span class="eyebrow">Governed design-time AI</span><h2>Generate AI Schema Suggestions</h2><p>選擇少量已授權資料表。AI 只會讀取結構化 metadata；不會讀取資料列、聊天內容或權限規則。</p><fieldset class="semantic-fieldset"><legend>Authorized tables（最多 8 個）</legend><div class="suggestion-table-options">${tableOptions}</div></fieldset><fieldset class="semantic-fieldset"><legend>Suggestion types</legend><div class="semantic-checkbox-group">${SEMANTIC_TYPES.map((type) => `<label class="check"><input type="checkbox" name="suggestionType" value="${type}" ${["DIMENSION", "METRIC", "RELATIONSHIP"].includes(type) ? "checked" : ""}> ${type}</label>`).join("")}</div></fieldset><label>Maximum suggestions<select name="maxSuggestions">${[4, 6, 8, 12].map((value) => semanticOption(value, String(value), value === 8)).join("")}</select></label><p class="semantic-form-error" role="alert" hidden></p><button class="button primary" type="submit">${icon("plus")}Generate suggestions</button></form>`);
    const form = dialog.querySelector("form");
    form.onsubmit = async (event) => {
      event.preventDefault();
      const submit = form.querySelector('[type="submit"]');
      const errorBox = form.querySelector(".semantic-form-error");
      const data = new FormData(form);
      const tableNames = data.getAll("tableName").map(String);
      const suggestionTypes = data.getAll("suggestionType").map(String);
      if (!tableNames.length || !suggestionTypes.length) { errorBox.textContent = "請至少選擇一個資料表與一種建議類型。"; errorBox.hidden = false; return; }
      try {
        submit.disabled = true;
        const response = await api("/api/v1/semantics/suggestions/generate", { method: "POST", body: JSON.stringify({ tableNames, suggestionTypes, maxSuggestions: Number(data.get("maxSuggestions")) }) });
        invalidateSemantics();
        state.semanticWorkspace = "suggestions";
        dialog.close();
        toast(`已建立 ${response.suggestionCount} 個待檢閱 AI 建議`);
        void render();
      } catch (error) { errorBox.textContent = semanticError(error); errorBox.hidden = false; submit.disabled = false; }
    };
  } catch (error) { toast(semanticError(error), "error"); }
}

async function useSemanticSuggestion(suggestionId) {
  try {
    const item = await api(`/api/v1/semantics/suggestions/${encodeURIComponent(suggestionId)}`);
    if (item.isStale || item.status !== "OPEN") { toast("這項建議已不可建立草稿，請重新整理。", "error"); return; }
    await openSemanticForm("suggestion", null, item);
  } catch (error) { toast(semanticError(error), "error"); }
}

async function dismissSemanticSuggestion(suggestionId) {
  if (!confirm("確定要忽略這項 AI 建議？此操作不會影響任何正式語意定義。")) return;
  try {
    await api(`/api/v1/semantics/suggestions/${encodeURIComponent(suggestionId)}/dismiss`, { method: "POST", body: JSON.stringify({}) });
    invalidateSemantics();
    toast("AI 建議已忽略");
    void render();
  } catch (error) { toast(semanticError(error), "error"); }
}

const VIEWS = { dashboard: renderDashboard, chat: renderChat, history: renderHistory, library: renderLibrary, schema: renderSchema, dictionary: renderDictionary, templates: renderTemplates, insights: renderInsights, usage: renderUsage, source: renderSource, semantics: renderSemantics, "admin-overview": renderAdminOverview, "admin-users": renderAdminUsers, "admin-roles": renderAdminRoles, "admin-semantic-authorities": renderAdminSemanticAuthorities, "admin-semantic-policies": renderAdminSemanticPolicies, "admin-invitations": renderAdminInvitations, "admin-audit": renderAdminAudit, "admin-system": renderAdminSystem, profile: async () => renderProfile() };
async function render() { const current = ++state.renderId; root.innerHTML = '<div class="loading"><span></span>正在載入 QueryMind…</div>'; try { if (!pageAllowed(state.navRoute)) { state.page = defaultPage(); prepareRoute(state.page); history.replaceState({}, "", `${location.pathname}#/${state.navRoute}`); } const markup = await (VIEWS[state.page] || VIEWS.chat)(); if (current !== state.renderId) return; root.innerHTML = markup; bindShell(); bindPage(); } catch (error) { if (current !== state.renderId || error.authExpired) return; root.innerHTML = shell(empty("載入資料時發生問題", error.message, button("重新嘗試", { kind: "primary", attrs: 'data-action="retry"' }))); bindShell(); root.querySelector('[data-action="retry"]')?.addEventListener("click", () => { state.cache.clear(); void render(); }); } }
function bindShell() { root.querySelectorAll("[data-page]").forEach((element) => element.addEventListener("click", () => go(element.dataset.page, { route: element.dataset.route || element.dataset.page }))); root.querySelectorAll('[data-action="open-sidebar"]').forEach((element) => element.addEventListener("click", () => { state.sidebarOpen = true; void render(); })); root.querySelectorAll('[data-action="close-sidebar"]').forEach((element) => element.addEventListener("click", () => { state.sidebarOpen = false; void render(); })); }
function bindSemanticPage() {
  root.querySelectorAll("[data-semantic-workspace]").forEach((button) => button.addEventListener("click", () => { state.semanticWorkspace = button.dataset.semanticWorkspace; state.semanticAssetId = null; void render(); }));
  root.querySelector("[data-semantic-filters]")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    state.semanticFilters = { ...state.semanticFilters, search: String(values.get("search") || "").trim(), type: String(values.get("type") || ""), assetStatus: String(values.get("assetStatus") || ""), revisionStatus: String(values.get("revisionStatus") || ""), domain: String(values.get("domain") || "").trim(), page: 1 };
    void render();
  });
  root.querySelector("[data-suggestion-filters]")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    state.semanticSuggestionFilters = { ...state.semanticSuggestionFilters, status: String(values.get("status") || ""), type: String(values.get("type") || ""), stale: String(values.get("stale") || ""), page: 1 };
    void render();
  });
  root.querySelectorAll("[data-semantic-page]").forEach((button) => button.addEventListener("click", () => { state.semanticFilters.page = Number(button.dataset.semanticPage) || 1; void render(); }));
  root.querySelectorAll("[data-open-semantic]").forEach((button) => button.addEventListener("click", () => { state.semanticAssetId = button.dataset.openSemantic; state.semanticDetailTab = "overview"; void render(); }));
  root.querySelector("[data-semantic-back]")?.addEventListener("click", () => { state.semanticAssetId = null; state.semanticDetailTab = "overview"; void render(); });
  root.querySelectorAll("[data-semantic-tab]").forEach((button) => button.addEventListener("click", () => { state.semanticDetailTab = button.dataset.semanticTab; void render(); }));
  root.querySelector("[data-action=\"create-semantic\"]")?.addEventListener("click", () => void openSemanticForm("create"));
  root.querySelector('[data-action="generate-semantic-suggestions"]')?.addEventListener("click", () => void openSemanticSuggestionGenerator());
  root.querySelectorAll("[data-use-suggestion]").forEach((button) => button.addEventListener("click", () => void useSemanticSuggestion(button.dataset.useSuggestion)));
  root.querySelectorAll("[data-dismiss-suggestion]").forEach((button) => button.addEventListener("click", () => void dismissSemanticSuggestion(button.dataset.dismissSuggestion)));
  root.querySelector("[data-edit-semantic]")?.addEventListener("click", () => void openSemanticForm("edit", root.querySelector("[data-edit-semantic]").dataset.editSemantic));
  root.querySelector("[data-new-semantic-revision]")?.addEventListener("click", () => void openSemanticForm("revision", root.querySelector("[data-new-semantic-revision]").dataset.newSemanticRevision));
  root.querySelector("[data-submit-semantic]")?.addEventListener("click", () => { const button = root.querySelector("[data-submit-semantic]"); void submitSemanticForReview(button.dataset.submitSemantic, button.dataset.revisionId); });
  root.querySelectorAll("[data-review-semantic]").forEach((button) => button.addEventListener("click", () => semanticReviewDialog(button.dataset.reviewSemantic, button.dataset.assetId, button.dataset.revisionId)));
  root.querySelector("[data-approve-semantic]")?.addEventListener("click", () => { const button = root.querySelector("[data-approve-semantic]"); approveSemanticDialog(button.dataset.approveSemantic, button.dataset.revisionId); });
  root.querySelector("[data-emergency-semantic]")?.addEventListener("click", () => { const button = root.querySelector("[data-emergency-semantic]"); emergencySemanticDialog(button.dataset.emergencySemantic, button.dataset.revisionId); });
  root.querySelector("[data-suspend-semantic]")?.addEventListener("click", () => { const button = root.querySelector("[data-suspend-semantic]"); runtimeSemanticDialog(button.dataset.suspendSemantic, button.dataset.revisionId, "suspend-runtime"); });
  root.querySelector("[data-resume-semantic]")?.addEventListener("click", () => { const button = root.querySelector("[data-resume-semantic]"); runtimeSemanticDialog(button.dataset.resumeSemantic, button.dataset.revisionId, "resume-runtime"); });
  root.querySelector("[data-post-review-semantic]")?.addEventListener("click", () => { const button = root.querySelector("[data-post-review-semantic]"); postReviewSemanticDialog(button.dataset.postReviewSemantic, button.dataset.revisionId); });
}
function bindPage() { bindSemanticPage();
  // Feedback controls are rendered as part of result explainability and may be
  // replaced during a retry/error transition. Direct listeners complement the
  // root delegation above and keep the capture-only UX reliable after a rerender.
  root.querySelectorAll("[data-feedback-submit]").forEach((button) => button.addEventListener("click", (event) => { event.preventDefault(); void submitFeedback(button.closest("[data-feedback-box]")); }));
  root.querySelectorAll("[data-prompt]").forEach((button) => button.addEventListener("click", () => go("chat", { pendingPrompt: button.dataset.prompt, resetSession: true })));
  root.querySelectorAll("[data-session]").forEach((button) => button.addEventListener("click", () => { state.activeSession = button.dataset.session; state.messages = []; state.result = null; state.chatFailure = null; state.chatDraft = ""; if (state.page === "history") go("chat"); else void render(); }));
  root.querySelectorAll("[data-session-action]").forEach((button) => button.addEventListener("click", (event) => { event.stopPropagation(); void sessionAction(button.dataset.sessionAction, button.dataset.sessionId, button.dataset.sessionValue); }));
  root.querySelector('[data-action="create-session"]')?.addEventListener("click", () => { state.activeSession = null; state.messages = []; state.result = null; state.chatFailure = null; state.chatDraft = ""; state.archiveMode = false; if (state.page === "history") go("chat", { resetSession: true }); else void render(); });
  root.querySelector('[data-action="toggle-archive"]')?.addEventListener("click", () => { state.archiveMode = !state.archiveMode; state.activeSession = null; state.messages = []; state.result = null; state.chatFailure = null; state.chatDraft = ""; void render(); });
  root.querySelector("#chat-form")?.addEventListener("submit", sendChat); const prompt = root.querySelector("#chat-prompt"); if (prompt) { if (state.pendingPrompt) { state.chatDraft = state.pendingPrompt; state.pendingPrompt = ""; prompt.focus(); } prompt.value = state.chatDraft; prompt.addEventListener("input", () => { state.chatDraft = prompt.value; if (state.chatFailure) { state.chatFailure = null; root.querySelector(".chat-failure")?.remove(); const sendButton = root.querySelector(".send-button"); if (sendButton) sendButton.innerHTML = `${icon("send")}送出`; } }); }
  root.querySelectorAll("[data-result-tab]").forEach((button) => button.addEventListener("click", () => { const [key, tab] = button.dataset.resultTab.split(":"); state.resultTabs.set(key, tab); void render(); }));
  root.querySelectorAll("[data-export]").forEach((button) => button.addEventListener("click", () => void exportCsv(decodeURIComponent(button.dataset.export))));
   root.querySelectorAll("[data-copy-sql]").forEach((button) => button.addEventListener("click", () => void copyText(decodeURIComponent(button.dataset.copySql), "SQL 已複製")));
   root.querySelectorAll("[data-save-query-run]").forEach((button) => button.addEventListener("click", () => saveAnalysisDialog(button.dataset.saveQueryRun, button)));
  root.querySelector('[data-action="refresh-schema"]')?.addEventListener("click", async () => { try { await api("/api/v1/schema/refresh", { method: "POST" }); invalidate("schema", "source", "admin-system"); toast("Schema 已重新掃描"); void render(); } catch (error) { toast(error.message, "error"); } });
  root.querySelectorAll("[data-use-template]").forEach((button) => button.addEventListener("click", async () => { const data = await load("templates", "/api/v1/templates"); const template = data.templates.find((item) => item.id === button.dataset.useTemplate); go("chat", { pendingPrompt: template?.prompt || "", resetSession: true }); }));
  root.querySelector('[data-action="add-template"]')?.addEventListener("click", () => templateForm()); root.querySelectorAll("[data-edit-template]").forEach((button) => button.addEventListener("click", async () => { const data = await load("templates", "/api/v1/templates"); templateForm(data.templates.find((item) => item.id === button.dataset.editTemplate)); })); root.querySelectorAll("[data-delete-template]").forEach((button) => button.addEventListener("click", () => void removeTemplate(button.dataset.deleteTemplate)));
   root.querySelector('[data-action="add-insight"]')?.addEventListener("click", () => insightForm()); root.querySelectorAll("[data-edit-insight]").forEach((button) => button.addEventListener("click", async () => { const data = await load("insights", "/api/v1/insights"); insightForm(data.insights.find((item) => item.id === button.dataset.editInsight)); })); root.querySelectorAll("[data-run-insight]").forEach((button) => button.addEventListener("click", () => void runInsight(button.dataset.runInsight))); root.querySelectorAll("[data-rename-insight]").forEach((button) => button.addEventListener("click", () => void renameInsight(button.dataset.renameInsight))); root.querySelectorAll("[data-favorite-insight]").forEach((button) => button.addEventListener("click", () => void toggleInsightFavorite(button.dataset.favoriteInsight))); root.querySelectorAll("[data-delete-insight]").forEach((button) => button.addEventListener("click", () => void removeInsight(button.dataset.deleteInsight)));
  root.querySelector('[data-action="add-dictionary"]')?.addEventListener("click", () => dictionaryForm()); root.querySelectorAll("[data-edit-dictionary]").forEach((button) => button.addEventListener("click", () => dictionaryForm(button.dataset.editDictionary))); root.querySelectorAll("[data-delete-dictionary]").forEach((button) => button.addEventListener("click", () => void removeDictionary(button.dataset.deleteDictionary)));
   root.querySelector('[data-action="invite-user"]')?.addEventListener("click", inviteForm); root.querySelectorAll("[data-revoke-invite]").forEach((button) => button.addEventListener("click", () => void revokeInvite(button.dataset.revokeInvite)));
   root.querySelector('[data-action="create-semantic-authority"]')?.addEventListener("click", () => void semanticAuthorityForm()); root.querySelectorAll("[data-replace-semantic-authority]").forEach((button) => button.addEventListener("click", () => void replaceSemanticAuthorityForm(button.dataset.replaceSemanticAuthority))); root.querySelectorAll("[data-toggle-semantic-authority]").forEach((button) => button.addEventListener("click", () => void toggleSemanticAuthority(button.dataset.toggleSemanticAuthority, button.dataset.active === "true")));
   root.querySelector('[data-action="create-semantic-policy"]')?.addEventListener("click", () => void semanticPolicyForm()); root.querySelectorAll("[data-replace-semantic-policy]").forEach((button) => button.addEventListener("click", () => void replaceSemanticPolicyForm(button.dataset.replaceSemanticPolicy))); root.querySelectorAll("[data-toggle-semantic-policy]").forEach((button) => button.addEventListener("click", () => void toggleSemanticPolicy(button.dataset.toggleSemanticPolicy, button.dataset.active === "true")));
  root.querySelectorAll("[data-toggle-user]").forEach((button) => button.addEventListener("click", () => void updateUser(button.dataset.toggleUser, button.dataset.active !== "true"))); root.querySelectorAll("[data-role-user]").forEach((select) => select.addEventListener("change", () => void updateUser(select.dataset.roleUser, undefined, select.value))); root.querySelectorAll("[data-reset-user]").forEach((button) => button.addEventListener("click", () => void resetUserPassword(button.dataset.resetUser, button.dataset.resetEmail))); root.querySelectorAll("[data-keys-user]").forEach((button) => button.addEventListener("click", () => void keyManager(button.dataset.keysUser))); root.querySelector("[data-user-search]")?.addEventListener("input", (event) => { state.userFilter = event.target.value; void render(); }); root.querySelector("[data-role-filter]")?.addEventListener("change", (event) => { state.roleFilter = event.target.value; void render(); });
  root.querySelectorAll("[data-edit-role]").forEach((button) => button.addEventListener("click", () => roleForm(button.dataset.editRole))); root.querySelector("#password-form")?.addEventListener("submit", changePassword); root.querySelector('[data-action="logout"]')?.addEventListener("click", () => void logout());
}

async function ensureSession(title = "New conversation") { if (state.activeSession) return state.activeSession; const created = await api("/api/v1/sessions", { method: "POST", body: JSON.stringify({ title: title.slice(0, 120) }) }); state.activeSession = created.session.id; state.messages = []; invalidate("dashboard"); return state.activeSession; }
async function sendChat(event) { event.preventDefault(); const form = event.currentTarget; const prompt = new FormData(form).get("prompt")?.toString().trim(); if (!prompt || state.sending) return; state.chatDraft = prompt; state.chatFailure = null; state.sending = true; let optimisticId = ""; let sessionId = ""; let requestSucceeded = false; try { sessionId = await ensureSession(prompt); const optimistic = { id: `pending-${Date.now()}`, role: "user", content: prompt, metadata: {}, created_at: new Date().toISOString() }; optimisticId = optimistic.id; state.messages.push(optimistic); state.result = null; void render(); await api("/api/v1/chat", { method: "POST", body: JSON.stringify({ sessionId, prompt }) }); requestSucceeded = true; state.chatDraft = ""; state.chatFailure = null; invalidate("dashboard", "usage"); state.messages = []; await Promise.all([loadMessages(sessionId), loadSessions()]); } catch (error) { if (optimisticId) state.messages = state.messages.filter((message) => message.id !== optimisticId); if (requestSucceeded) toast("查詢已完成，但結果載入失敗；請從 History 重新開啟此對話。", "error"); else state.chatFailure = { code: error.code || "REQUEST_FAILED", referenceId: error.referenceId || "", message: error.code === "AI_GATEWAY_TIMEOUT" ? "AI Gateway 等待逾時。原提問已保留，尚未產生查詢結果；請稍後重新送出。" : error.code === "AI_GATEWAY_ERROR" ? "AI Gateway 無法完成此次分析。原提問已保留，尚未產生查詢結果；若持續發生，請提供參考編號。" : error.message || "提問未完成。原提問已保留，請確認後再試。" }; } finally { state.sending = false; void render(); } }
async function sessionAction(action, id, value) { try { if (action === "rename") { const current = state.sessions.find((session) => session.id === id); const title = prompt("新的對話名稱", current?.title || ""); if (title === null || !title.trim()) return; await api(`/api/v1/sessions/${id}`, { method: "PATCH", body: JSON.stringify({ title: title.trim() }) }); toast("對話名稱已更新"); } if (action === "pin") { await api(`/api/v1/sessions/${id}`, { method: "PATCH", body: JSON.stringify({ pinned: value !== "true" }) }); toast(value === "true" ? "已取消釘選" : "已釘選對話"); } if (action === "archive") { await api(`/api/v1/sessions/${id}`, { method: "PATCH", body: JSON.stringify({ archived: value !== "true" }) }); if (state.activeSession === id) { state.activeSession = null; state.messages = []; state.result = null; } toast(value === "true" ? "對話已還原" : "對話已封存"); } if (action === "delete") { if (!confirm("確定永久刪除此對話及其訊息嗎？此操作無法復原。")) return; await api(`/api/v1/sessions/${id}`, { method: "DELETE" }); toast("對話已永久刪除"); } invalidate("dashboard"); await loadSessions(); void render(); } catch (error) { toast(error.message, "error"); } }
async function exportCsv(sql) { try { const response = await fetch("/api/v1/export/csv", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ sql }) }); if (!response.ok) { const data = await response.json().catch(() => ({})); throw new Error(data.message || "匯出失敗"); } const blob = await response.blob(); const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = "querymind-export.csv"; link.click(); URL.revokeObjectURL(link.href); toast("CSV 已開始下載"); } catch (error) { toast(error.message, "error"); } }
async function copyText(value, message) { try { await navigator.clipboard.writeText(value); toast(message); } catch { toast("無法使用剪貼簿，請手動複製", "error"); } }
function modal(content) { const dialog = document.createElement("dialog"); dialog.className = "modal"; dialog.innerHTML = `<button class="modal-close" aria-label="關閉">${icon("close")}</button>${content}`; document.body.append(dialog); dialog.showModal(); dialog.querySelector(".modal-close").onclick = () => dialog.close(); dialog.addEventListener("close", () => { const refreshPage = dialog.dataset.refreshPageOnClose === "true"; dialog.remove(); if (refreshPage) void render(); }); return dialog; }
function templateForm(item = null) { const existing = item || {}; const dialog = modal(`<form class="modal-form"><span class="eyebrow">Reusable prompt</span><h2>${item ? "編輯查詢範本" : "新增查詢範本"}</h2><label>標題<input name="title" required maxlength="120" value="${esc(existing.title || "")}"></label><label>分類<input name="category" maxlength="80" value="${esc(existing.category || "")}"></label><label>說明<textarea name="description" maxlength="500">${esc(existing.description || "")}</textarea></label><label>提問內容<textarea name="prompt" required maxlength="4000">${esc(existing.prompt || "")}</textarea></label><label class="check"><input type="checkbox" name="isPinned" ${existing.is_pinned || existing.isPinned ? "checked" : ""}> 置頂顯示</label><label class="check"><input type="checkbox" name="isShared" ${item ? (existing.is_shared || existing.isShared ? "checked" : "") : "checked"}> 分享給工作區</label><button class="button primary">${icon("check")}儲存範本</button></form>`); dialog.querySelector("form").onsubmit = async (event) => { event.preventDefault(); const data = new FormData(event.currentTarget); const body = { ...Object.fromEntries(data), isPinned: data.has("isPinned"), isShared: data.has("isShared") }; try { await api(item ? `/api/v1/templates/${item.id}` : "/api/v1/templates", { method: item ? "PATCH" : "POST", body: JSON.stringify(body) }); invalidate("templates"); dialog.close(); toast(item ? "範本已更新" : "範本已建立"); void render(); } catch (error) { toast(error.message, "error"); } }; }
async function removeTemplate(id) { if (!confirm("確定刪除這份範本嗎？")) return; try { await api(`/api/v1/templates/${id}`, { method: "DELETE" }); invalidate("templates"); toast("範本已刪除"); void render(); } catch (error) { toast(error.message, "error"); } }
function saveAnalysisDialog(queryRunId, trigger) {
  if (!queryRunId || state.savingAnalysisRuns.has(queryRunId) || state.savedAnalysisRuns.has(queryRunId)) return;
  state.savingAnalysisRuns.add(queryRunId);
  trigger.disabled = true;
  const prompt = String(trigger.dataset.savePrompt || "").trim();
  const defaultTitle = (prompt || "資料分析").replace(/\s+/gu, " ").slice(0, 120);
  const dialog = modal(`<form class="modal-form save-analysis-form" aria-labelledby="save-analysis-title"><span class="eyebrow">Personal Library</span><h2 id="save-analysis-title">儲存這次分析</h2><p>只保存問題與來源脈絡，不保存結果列或可直接執行的 SQL。未來重跑會重新檢查你的目前權限。</p><label for="save-analysis-title-input">標題<input id="save-analysis-title-input" name="title" required maxlength="120" autofocus value="${esc(defaultTitle)}"></label><label for="save-analysis-note">備註（選填）<textarea id="save-analysis-note" name="description" maxlength="500" placeholder="補充這份分析的用途"></textarea></label><p class="save-analysis-error" role="alert" aria-live="polite" hidden></p><div class="save-analysis-dialog-actions"><button class="button secondary compact" type="button" data-cancel-save>取消</button><button class="button primary compact" type="submit">儲存至 Library</button></div></form>`);
  const form = dialog.querySelector("form");
  const submit = form.querySelector('[type="submit"]');
  const errorBox = form.querySelector(".save-analysis-error");
  let saved = false;
  dialog.querySelector("[data-cancel-save]").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => {
    state.savingAnalysisRuns.delete(queryRunId);
    if (!saved && trigger.isConnected) trigger.disabled = false;
    if (!saved && trigger.isConnected) trigger.focus();
  });
  form.onsubmit = async (event) => {
    event.preventDefault();
    if (submit.disabled) return;
    const data = new FormData(form);
    submit.disabled = true;
    submit.textContent = "儲存中…";
    errorBox.hidden = true;
    try {
      const result = await api("/api/v1/insights", { method: "POST", body: JSON.stringify({ queryRunId, title: data.get("title"), description: data.get("description") }) });
      saved = true;
      state.savedAnalysisRuns.add(queryRunId);
      invalidate("insights", "dashboard");
      dialog.close();
      toast(result.alreadySaved ? "此分析已儲存於 Library" : "已儲存至 Library");
      await render();
      root.querySelector(`[data-saved-analysis-run="${CSS.escape(queryRunId)}"]`)?.focus();
    } catch (error) {
      errorBox.textContent = error.code === "QUERY_RUN_NOT_FOUND" ? "這筆成功分析已無法驗證，請重新執行後再保存。" : error.code === "RBAC_FORBIDDEN" ? "目前帳號沒有管理個人洞察的權限。" : "儲存失敗，請稍後重試。";
      errorBox.hidden = false;
      submit.disabled = false;
      submit.textContent = "重試儲存";
    }
  };
}

async function renameInsight(id) {
  try {
    const data = await load("insights", "/api/v1/insights");
    const item = data.insights.find((entry) => entry.id === id);
    if (!item) throw new Error("找不到已儲存的分析");
    const dialog = modal(`<form class="modal-form"><span class="eyebrow">Personal Library</span><h2>重新命名分析</h2><label for="rename-analysis-title">標題<input id="rename-analysis-title" name="title" required maxlength="120" value="${esc(item.title)}"></label><p class="save-analysis-error" role="alert" hidden></p><div class="save-analysis-dialog-actions"><button class="button secondary compact" type="button" data-cancel-save>取消</button><button class="button primary compact" type="submit">儲存名稱</button></div></form>`);
    const form = dialog.querySelector("form");
    const submit = form.querySelector('[type="submit"]');
    const errorBox = form.querySelector('[role="alert"]');
    dialog.querySelector("[data-cancel-save]").addEventListener("click", () => dialog.close());
    form.onsubmit = async (event) => {
      event.preventDefault();
      if (submit.disabled) return;
      submit.disabled = true;
      try {
        await api(`/api/v1/insights/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ title: new FormData(form).get("title") }) });
        invalidate("insights"); dialog.close(); toast("分析名稱已更新"); void render();
      } catch {
        errorBox.textContent = "更新失敗，請稍後重試。"; errorBox.hidden = false; submit.disabled = false;
      }
    };
  } catch (error) { toast(error.message || "無法開啟重新命名", "error"); }
}

async function runIntentInsight(insight) {
  const prompt = String(insight.prompt || insight.title || "").trim();
  if (!prompt || state.sending) return;
  state.activeSession = null; state.messages = []; state.result = null; state.archiveMode = false;
  go("chat", { resetSession: true });
  try {
    const sessionId = await ensureSession(insight.title || prompt);
    const optimistic = { id: `pending-${Date.now()}`, role: "user", content: prompt, metadata: {}, created_at: new Date().toISOString() };
    state.messages = [optimistic]; state.sending = true; void render();
    await api("/api/v1/chat", { method: "POST", body: JSON.stringify({ sessionId, prompt }) });
    invalidate("dashboard", "usage", "insights");
    state.messages = [];
    await Promise.all([loadMessages(sessionId), loadSessions()]);
  } catch (error) {
    state.messages = state.messages.filter((message) => !String(message.id).startsWith("pending-"));
    toast(error.message || "重新執行失敗，請稍後重試。", "error");
  } finally { state.sending = false; void render(); }
}

async function runInsight(id) {
  try {
    const data = await load("insights", "/api/v1/insights");
    const insight = data.insights.find((item) => item.id === id);
    if (!insight) throw new Error("找不到洞察");
    if (!insight.sql) { await runIntentInsight(insight); return; }
    const sessionId = await ensureSession(insight.title);
    state.messages = [{ id: `insight-${id}`, role: "user", content: `重新執行：${insight.prompt || insight.title}`, metadata: {}, created_at: new Date().toISOString() }];
    state.sending = true; state.result = null; go("chat");
    const result = await api("/api/v1/query", { method: "POST", body: JSON.stringify({ sql: insight.sql, sessionId, prompt: insight.prompt || insight.title }) });
    state.result = { answer: `已在目前權限下重新執行「${insight.title}」。`, prompt: insight.prompt || insight.title, ...result };
    invalidate("dashboard", "usage");
  } catch (error) { toast(error.message || "重新執行失敗，請稍後重試。", "error"); }
  finally { state.sending = false; void render(); }
}
async function toggleInsightFavorite(id) { try { const data = await load("insights", "/api/v1/insights"); const insight = data.insights.find((item) => item.id === id); await api(`/api/v1/insights/${id}`, { method: "PATCH", body: JSON.stringify({ isFavorite: !insight.isFavorite }) }); invalidate("insights"); toast(insight.isFavorite ? "已取消收藏" : "已加入收藏"); void render(); } catch (error) { toast(error.message, "error"); } }
async function removeInsight(id) { if (!confirm("確定刪除此洞察嗎？")) return; try { await api(`/api/v1/insights/${id}`, { method: "DELETE" }); invalidate("insights", "dashboard"); toast("洞察已刪除"); void render(); } catch (error) { toast(error.message, "error"); } }
function dictionaryForm(id = null) { const launch = async () => { const data = await load("dictionary", "/api/v1/dictionary"); const existing = data.entries.find((entry) => entry.id === id) || {}; const dialog = modal(`<form class="modal-form"><span class="eyebrow">Business glossary</span><h2>${id ? "編輯詞彙" : "新增詞彙"}</h2><label>詞彙<input name="term" required maxlength="120" value="${esc(existing.term || "")}"></label><label>定義<textarea name="definition" required maxlength="2000">${esc(existing.definition || "")}</textarea></label><label>分類<input name="category" maxlength="80" value="${esc(existing.category || "business")}"></label><label>範例<textarea name="examples" maxlength="1000">${esc(existing.examples || "")}</textarea></label><button class="button primary">${icon("check")}儲存詞彙</button></form>`); dialog.querySelector("form").onsubmit = async (event) => { event.preventDefault(); try { await api(id ? `/api/v1/dictionary/${id}` : "/api/v1/dictionary", { method: id ? "PUT" : "POST", body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) }); invalidate("dictionary"); dialog.close(); toast("字典已更新，下一次提問會使用新定義"); void render(); } catch (error) { toast(error.message, "error"); } }; }; void launch(); }
async function removeDictionary(id) { if (!confirm("確定刪除此字典詞彙嗎？")) return; try { await api(`/api/v1/dictionary/${id}`, { method: "DELETE" }); invalidate("dictionary"); toast("詞彙已刪除"); void render(); } catch (error) { toast(error.message, "error"); } }
function semanticGovernanceInvalidate() { invalidate("admin-semantic-governance", "admin-semantic-users"); }
async function semanticGovernanceReadBack() {
  const config = await api("/api/v1/semantics/governance/policies");
  state.cache.set("admin-semantic-governance", Promise.resolve(config));
  return config;
}
function governanceBoolean(value) { return value === true || Number(value) === 1; }
function requireGovernanceReadBack(config, collection, idField, id, expected) {
  const record = (config[collection] || []).find((item) => item[idField] === id);
  if (!record) throw new Error("儲存後無法由伺服器讀回治理設定，請重新整理後確認。");
  for (const [key, value] of Object.entries(expected)) {
    const actual = typeof value === "boolean" ? governanceBoolean(record[key]) : record[key];
    if (actual !== value) throw new Error("伺服器讀回的治理設定與送出內容不一致；變更未顯示為成功。");
  }
  return record;
}
async function semanticAuthorityForm() {
  const users = (await governanceUsers()).filter((user) => user.isActive);
  const userOptions = users.map((user) => `<option value="${esc(user.id)}">${esc(user.displayName || user.email)} · ${esc(user.email)}</option>`).join("");
  const dialog = modal(`<form class="modal-form governance-form"><span class="eyebrow">Semantic Governance · Authority</span><h2>建立 explicit authority</h2><p>這筆 assignment 不會改變使用者的 platform role。核准權只有在 backend 建立此 explicit record 後才會生效。</p><label>Actor / User<select name="userId" required ${users.length ? "" : "disabled"}><option value="">選擇啟用中的人類使用者</option>${userOptions || "<option value=\"\" disabled>尚無啟用中的使用者</option>"}</select></label><div class="governance-form-grid"><label>Scope Type<select name="scopeKind" data-governance-scope><option value="DOMAIN">DOMAIN</option><option value="ASSET">ASSET</option></select></label><label data-governance-domain-field>Domain<input name="domain" data-governance-domain maxlength="80" required placeholder="例如 Commerce"></label></div><label data-governance-asset-field hidden>Asset ID<input name="assetId" data-governance-asset maxlength="128" placeholder="僅 ASSET scope 使用"></label><label>RACI role<select name="raciRole"><option value="SEMANTIC_APPROVER">SEMANTIC_APPROVER</option><option value="DATA_OWNER">DATA_OWNER</option><option value="DATA_STEWARD">DATA_STEWARD</option></select></label><label class="check"><input type="checkbox" name="canApprove"> Can Approve</label><label class="check"><input type="checkbox" name="canGovernRuntime"> Can Govern Runtime</label><label class="check"><input type="checkbox" checked disabled> Active（建立時由 backend 設為 active）</label><div class="governance-boundary-note">Emergency approval 不是目前 P2-E authority schema 的欄位，因此不在此表單建立。所有變更會透過 browser session、capability 與 audit boundary 驗證。</div><p class="semantic-form-error" role="alert" hidden></p><button class="button primary" type="submit" ${users.length ? "" : "disabled"}>${icon("check")}建立 Authority</button></form>`);
  const form = dialog.querySelector("form");
  const scope = form.elements.scopeKind;
  const domainField = dialog.querySelector("[data-governance-domain-field]");
  const domainInput = form.elements.domain;
  const assetField = dialog.querySelector("[data-governance-asset-field]");
  const assetInput = form.elements.assetId;
  const syncScope = () => { const asset = scope.value === "ASSET"; domainField.hidden = asset; domainInput.required = !asset; assetField.hidden = !asset; assetInput.required = asset; };
  scope.addEventListener("change", syncScope); syncScope();
  form.onsubmit = async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const body = { scopeKind: data.get("scopeKind"), domain: data.get("domain") || "", ...(data.get("scopeKind") === "ASSET" ? { assetId: data.get("assetId") } : {}), userId: data.get("userId"), raciRole: data.get("raciRole"), canApprove: data.has("canApprove"), canGovernRuntime: data.has("canGovernRuntime") };
    const errorBox = form.querySelector(".semantic-form-error");
    try {
      form.querySelector('[type="submit"]').disabled = true;
      const created = await api("/api/v1/semantics/governance/authorities", { method: "POST", body: JSON.stringify(body) });
      const config = await semanticGovernanceReadBack();
      requireGovernanceReadBack(config, "authorities", "authority_id", created.authorityId, { can_approve: Boolean(body.canApprove), can_govern_runtime: Boolean(body.canGovernRuntime), is_active: 1 });
      invalidate("admin-semantic-users"); dialog.close(); toast("Semantic Authority 已建立並完成伺服器讀回驗證"); void render();
    } catch (error) { semanticGovernanceInvalidate(); errorBox.textContent = semanticError(error); errorBox.hidden = false; form.querySelector('[type="submit"]').disabled = false; }
  };
}
async function semanticPolicyForm() {
  const dialog = modal(`<form class="modal-form governance-form"><span class="eyebrow">Semantic Governance · Policy</span><h2>建立 approval policy</h2><p>Policy 只定義治理 scope、risk、quorum 與 P2-E SoD 選項；不會建立 Semantic asset 或改變 Registry。</p><div class="governance-form-grid"><label>Scope Type<select name="scopeKind" data-governance-scope><option value="DOMAIN">DOMAIN</option><option value="ASSET">ASSET</option></select></label><label data-governance-domain-field>Domain<input name="domain" data-governance-domain maxlength="80" required placeholder="例如 Commerce"></label></div><label data-governance-asset-field hidden>Asset ID<input name="assetId" data-governance-asset maxlength="128" placeholder="僅 ASSET scope 使用"></label><div class="governance-form-grid"><label>Risk level<select name="riskClass"><option value="LOW">LOW</option><option value="STANDARD" selected>STANDARD</option><option value="HIGH">HIGH</option><option value="CRITICAL">CRITICAL</option></select></label><label>Required quorum<input name="requiredApprovals" type="number" min="1" max="5" value="1" required></label></div><label class="check"><input type="checkbox" name="allowProposerSelfApproval"> Allow proposer self-approval（僅依 P2-E policy）</label><label class="check"><input type="checkbox" name="allowEmergencyPublication"> Allow emergency publication</label><label>Post-review due hours<input name="postReviewDueHours" type="number" min="1" max="720" value="72" required></label><label class="check"><input type="checkbox" checked disabled> Active（建立時由 backend 設為 active）</label><div class="governance-boundary-note">HIGH / CRITICAL policy 若 quorum 小於 2，backend 會拒絕；AI 不會滿足任何 approval slot。</div><p class="semantic-form-error" role="alert" hidden></p><button class="button primary" type="submit">${icon("check")}建立 Approval Policy</button></form>`);
  const form = dialog.querySelector("form");
  const scope = form.elements.scopeKind;
  const domainField = dialog.querySelector("[data-governance-domain-field]");
  const domainInput = form.elements.domain;
  const assetField = dialog.querySelector("[data-governance-asset-field]");
  const assetInput = form.elements.assetId;
  const syncScope = () => { const asset = scope.value === "ASSET"; domainField.hidden = asset; domainInput.required = !asset; assetField.hidden = !asset; assetInput.required = asset; };
  scope.addEventListener("change", syncScope); syncScope();
  form.onsubmit = async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const body = { scopeKind: data.get("scopeKind"), domain: data.get("domain") || "", ...(data.get("scopeKind") === "ASSET" ? { assetId: data.get("assetId") } : {}), riskClass: data.get("riskClass"), requiredApprovals: Number(data.get("requiredApprovals")), allowProposerSelfApproval: data.has("allowProposerSelfApproval"), allowEmergencyPublication: data.has("allowEmergencyPublication"), postReviewDueHours: Number(data.get("postReviewDueHours")) };
    const errorBox = form.querySelector(".semantic-form-error");
    try {
      form.querySelector('[type="submit"]').disabled = true;
      const created = await api("/api/v1/semantics/governance/policies", { method: "POST", body: JSON.stringify(body) });
      const config = await semanticGovernanceReadBack();
      requireGovernanceReadBack(config, "policies", "policy_id", created.policyId, { required_approvals: body.requiredApprovals, allow_proposer_self_approval: Boolean(body.allowProposerSelfApproval), allow_emergency_publication: Boolean(body.allowEmergencyPublication), post_review_due_hours: body.postReviewDueHours, is_active: 1 });
      dialog.close(); toast("Approval Policy 已建立並完成伺服器讀回驗證"); void render();
    } catch (error) { semanticGovernanceInvalidate(); errorBox.textContent = semanticError(error); errorBox.hidden = false; form.querySelector('[type="submit"]').disabled = false; }
  };
}
function authorityReplacementSummary(item, proposed) {
  const side = (label, approve, runtime) => `<article><small>${label}</small><b>Approve ${approve ? "ON" : "OFF"}</b><span>Runtime ${runtime ? "ON" : "OFF"}</span></article>`;
  return `<div class="governance-replacement-preview">${side("Current", governanceBoolean(item.can_approve), governanceBoolean(item.can_govern_runtime))}<span class="governance-replacement-arrow">→</span>${side("Proposed", proposed.canApprove, proposed.canGovernRuntime)}</div>`;
}
async function replaceSemanticAuthorityForm(authorityId) {
  const config = await semanticGovernanceReadBack();
  const item = (config.authorities || []).find((record) => record.authority_id === authorityId && governanceBoolean(record.is_active));
  if (!item) { toast("Active authority 已變更，請重新整理後再試。", "error"); void render(); return; }
  const dialog = modal(`<form class="modal-form governance-form"><span class="eyebrow">Atomic Governance Replacement</span><h2>Replace Authority</h2><p><b>${esc(governanceScope(item))}</b> · ${esc(item.raci_role)}。Scope、使用者與 RACI identity 保持不變；舊紀錄會成為 immutable history。</p><div data-replacement-preview></div><label class="check"><input type="checkbox" name="canApprove" ${governanceBoolean(item.can_approve) ? "checked" : ""}> Can Approve</label><label class="check"><input type="checkbox" name="canGovernRuntime" ${governanceBoolean(item.can_govern_runtime) ? "checked" : ""}> Can Govern Runtime</label><div class="governance-boundary-note">這會送出單一請求；backend 原子停用舊紀錄、建立新紀錄並寫入關聯 audit evidence。</div><p class="semantic-form-error" role="alert" hidden></p><button class="button primary" type="submit">${icon("check")}確認原子替換</button></form>`);
  const form = dialog.querySelector("form"); const preview = dialog.querySelector("[data-replacement-preview]");
  const values = () => ({ canApprove: form.elements.canApprove.checked, canGovernRuntime: form.elements.canGovernRuntime.checked });
  const sync = () => { preview.innerHTML = authorityReplacementSummary(item, values()); };
  form.elements.canApprove.addEventListener("change", sync); form.elements.canGovernRuntime.addEventListener("change", sync); sync();
  form.onsubmit = async (event) => {
    event.preventDefault(); const proposed = values(); const submit = form.querySelector('[type="submit"]'); const errorBox = form.querySelector(".semantic-form-error"); submit.disabled = true;
    try {
      const result = await api(`/api/v1/semantics/governance/authorities/${encodeURIComponent(authorityId)}/replace`, { method: "POST", body: JSON.stringify({ expectedUpdatedAt: item.updated_at, ...proposed }) });
      const readBack = await semanticGovernanceReadBack();
      requireGovernanceReadBack(readBack, "authorities", "authority_id", authorityId, { is_active: 0 });
      requireGovernanceReadBack(readBack, "authorities", "authority_id", result.replacement.authority_id, { can_approve: proposed.canApprove, can_govern_runtime: proposed.canGovernRuntime, is_active: 1 });
      dialog.close(); toast("Semantic Authority 已原子替換並完成伺服器讀回驗證"); void render();
    } catch (error) { semanticGovernanceInvalidate(); errorBox.textContent = semanticError(error); errorBox.hidden = false; submit.disabled = false; }
  };
}
function policyReplacementSummary(item, proposed) {
  const side = (label, risk, quorum, selfApproval, emergency, hours) => `<article><small>${label}</small><b>${esc(risk)} · quorum ${quorum}</b><span>Self ${selfApproval ? "ON" : "OFF"} · Emergency ${emergency ? "ON" : "OFF"} · ${hours}h</span></article>`;
  return `<div class="governance-replacement-preview">${side("Current", item.risk_class, Number(item.required_approvals), governanceBoolean(item.allow_proposer_self_approval), governanceBoolean(item.allow_emergency_publication), Number(item.post_review_due_hours))}<span class="governance-replacement-arrow">→</span>${side("Proposed", proposed.riskClass, proposed.requiredApprovals, proposed.allowProposerSelfApproval, proposed.allowEmergencyPublication, proposed.postReviewDueHours)}</div>`;
}
async function replaceSemanticPolicyForm(policyId) {
  const config = await semanticGovernanceReadBack();
  const item = (config.policies || []).find((record) => record.policy_id === policyId && governanceBoolean(record.is_active));
  if (!item) { toast("Active policy 已變更，請重新整理後再試。", "error"); void render(); return; }
  const riskOptions = ["LOW", "STANDARD", "HIGH", "CRITICAL"].map((risk) => `<option value="${risk}" ${risk === item.risk_class ? "selected" : ""}>${risk}</option>`).join("");
  const dialog = modal(`<form class="modal-form governance-form"><span class="eyebrow">Atomic Governance Replacement</span><h2>Replace Approval Policy</h2><p><b>${esc(governanceScope(item))}</b>。Scope identity 保持不變；舊 policy 會保留為 inactive history。</p><div data-replacement-preview></div><div class="governance-form-grid"><label>Risk level<select name="riskClass">${riskOptions}</select></label><label>Required quorum<input name="requiredApprovals" type="number" min="1" max="5" value="${Number(item.required_approvals)}" required></label></div><label class="check"><input type="checkbox" name="allowProposerSelfApproval" ${governanceBoolean(item.allow_proposer_self_approval) ? "checked" : ""}> Allow proposer self-approval</label><label class="check"><input type="checkbox" name="allowEmergencyPublication" ${governanceBoolean(item.allow_emergency_publication) ? "checked" : ""}> Allow emergency publication</label><label>Post-review due hours<input name="postReviewDueHours" type="number" min="1" max="720" value="${Number(item.post_review_due_hours)}" required></label><div class="governance-boundary-note">HIGH / CRITICAL 仍由 backend 強制 quorum ≥ 2；成功只以 authoritative server read-back 為準。</div><p class="semantic-form-error" role="alert" hidden></p><button class="button primary" type="submit">${icon("check")}確認原子替換</button></form>`);
  const form = dialog.querySelector("form"); const preview = dialog.querySelector("[data-replacement-preview]");
  const values = () => ({ riskClass: form.elements.riskClass.value, requiredApprovals: Number(form.elements.requiredApprovals.value), allowProposerSelfApproval: form.elements.allowProposerSelfApproval.checked, allowEmergencyPublication: form.elements.allowEmergencyPublication.checked, postReviewDueHours: Number(form.elements.postReviewDueHours.value) });
  const sync = () => { preview.innerHTML = policyReplacementSummary(item, values()); };
  [form.elements.riskClass, form.elements.requiredApprovals, form.elements.allowProposerSelfApproval, form.elements.allowEmergencyPublication, form.elements.postReviewDueHours].forEach((control) => control.addEventListener("change", sync)); sync();
  form.onsubmit = async (event) => {
    event.preventDefault(); const proposed = values(); const submit = form.querySelector('[type="submit"]'); const errorBox = form.querySelector(".semantic-form-error"); submit.disabled = true;
    try {
      const result = await api(`/api/v1/semantics/governance/policies/${encodeURIComponent(policyId)}/replace`, { method: "POST", body: JSON.stringify({ expectedUpdatedAt: item.updated_at, ...proposed }) });
      const readBack = await semanticGovernanceReadBack();
      requireGovernanceReadBack(readBack, "policies", "policy_id", policyId, { is_active: 0 });
      requireGovernanceReadBack(readBack, "policies", "policy_id", result.replacement.policy_id, { risk_class: proposed.riskClass, required_approvals: proposed.requiredApprovals, allow_proposer_self_approval: proposed.allowProposerSelfApproval, allow_emergency_publication: proposed.allowEmergencyPublication, post_review_due_hours: proposed.postReviewDueHours, is_active: 1 });
      dialog.close(); toast("Approval Policy 已原子替換並完成伺服器讀回驗證"); void render();
    } catch (error) { semanticGovernanceInvalidate(); errorBox.textContent = semanticError(error); errorBox.hidden = false; submit.disabled = false; }
  };
}
async function toggleSemanticAuthority(authorityId, active) {
  if (!confirm(`確定要${active ? "停用" : "啟用"}這筆 Semantic Authority 嗎？${active ? "停用後，該使用者不再具備此 scope 的 authority。" : "啟用後，backend 會重新套用此 explicit authority。"}`)) return;
  try {
    await api(`/api/v1/semantics/governance/authorities/${encodeURIComponent(authorityId)}`, { method: "PATCH", body: JSON.stringify({ isActive: !active }) });
    const config = await semanticGovernanceReadBack();
    requireGovernanceReadBack(config, "authorities", "authority_id", authorityId, { is_active: active ? 0 : 1 });
    toast(`Semantic Authority 已${active ? "停用" : "啟用"}並完成伺服器讀回驗證`); void render();
  } catch (error) { semanticGovernanceInvalidate(); toast(semanticError(error), "error"); }
}
async function toggleSemanticPolicy(policyId, active) {
  if (!confirm(`確定要${active ? "停用" : "啟用"}這筆 Approval Policy 嗎？${active ? "停用後，相關 Semantic approval 將 fail closed。" : "啟用後，backend 會重新套用此 policy。"}`)) return;
  try {
    await api(`/api/v1/semantics/governance/policies/${encodeURIComponent(policyId)}`, { method: "PATCH", body: JSON.stringify({ isActive: !active }) });
    const config = await semanticGovernanceReadBack();
    requireGovernanceReadBack(config, "policies", "policy_id", policyId, { is_active: active ? 0 : 1 });
    toast(`Approval Policy 已${active ? "停用" : "啟用"}並完成伺服器讀回驗證`); void render();
  } catch (error) { semanticGovernanceInvalidate(); toast(semanticError(error), "error"); }
}
function inviteForm() { const dialog = modal(`<form class="modal-form"><span class="eyebrow">Secure onboarding</span><h2>邀請使用者</h2><label>電子郵件<input name="email" type="email" required></label><label>角色<select name="roleName">${ROLE_NAMES.map((role) => `<option value="${role}">${role}</option>`).join("")}</select></label><label>有效小時<input name="expiresHours" type="number" value="72" min="1" max="720"></label><button class="button primary">${icon("plus")}建立一次性邀請</button></form>`); dialog.querySelector("form").onsubmit = async (event) => { event.preventDefault(); try { const response = await api("/api/v1/admin/invitations", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) }); const link = `${location.origin}/accept-invite#token=${encodeURIComponent(response.inviteToken)}`; dialog.dataset.refreshPageOnClose = "true"; dialog.querySelector(".modal-form").innerHTML = `<span class="eyebrow">邀請已建立</span><h2>請安全傳送此連結</h2><p>連結與 Token 都只會在此顯示一次。受邀者可在同一頁確認信箱、設定密碼並進入工作區。</p><code class="secret-value">${esc(link)}</code><button type="button" class="button primary" data-copy-invite>${icon("copy")}複製邀請連結</button>`; dialog.querySelector("[data-copy-invite]").onclick = () => void copyText(link, "邀請連結已複製"); invalidate("admin-invitations"); } catch (error) { toast(error.message, "error"); } }; }
async function revokeInvite(id) { if (!confirm("確定撤銷這份邀請嗎？")) return; try { await api(`/api/v1/admin/invitations/${id}`, { method: "DELETE" }); invalidate("admin-invitations"); toast("邀請已撤銷"); void render(); } catch (error) { toast(error.message, "error"); } }
async function updateUser(id, active, role) { try { const body = {}; if (active !== undefined) body.isActive = active; if (role) body.roleName = role; await api(`/api/v1/admin/users/${id}`, { method: "PATCH", body: JSON.stringify(body) }); invalidate("admin-users", "admin-overview"); toast("使用者已更新"); void render(); } catch (error) { toast(error.message, "error"); } }
async function resetUserPassword(id, email) { if (!confirm(`確定重設 ${email} 的密碼嗎？該使用者目前所有登入狀態會立即失效。`)) return; try { const response = await api(`/api/v1/admin/users/${id}/reset-password`, { method: "POST" }); invalidate("admin-audit"); const dialog = modal(`<div class="modal-form"><span class="eyebrow">Account recovery</span><h2>暫時密碼已建立</h2><p>${esc(email)} 的既有登入狀態已失效。此密碼只會顯示一次，請透過安全管道交付，並要求使用者登入後立即變更。</p><code class="secret-value">${esc(response.temporaryPassword)}</code><button class="button primary" data-copy-password>${icon("copy")}複製暫時密碼</button></div>`); dialog.querySelector("[data-copy-password]").onclick = () => void copyText(response.temporaryPassword, "暫時密碼已複製"); } catch (error) { toast(error.message, "error"); } }
async function keyManager(userId) { try { const data = await api(`/api/v1/admin/users/${userId}/keys`); const rows = data.keys.map((key) => `<li><span><b>${esc(key.label)}</b><small><code>${esc(key.keyPrefix)}…</code> · ${key.revokedAt ? "已撤銷" : `最後使用 ${fmtDate(key.lastUsedAt, "尚未使用")}`}</small></span>${key.revokedAt ? "" : `<button class="icon-button danger" data-revoke-key="${key.id}" aria-label="撤銷 API Key">${icon("trash")}</button>`}</li>`).join(""); const dialog = modal(`<div class="modal-form"><span class="eyebrow">Service access</span><h2>API Keys</h2><ul class="key-list">${rows || "<li>尚無 API Key</li>"}</ul><form><label>Key 名稱<input name="label" required maxlength="80" placeholder="分析自動化"></label><button class="button primary">${icon("plus")}建立新 Key</button></form></div>`); dialog.querySelectorAll("[data-revoke-key]").forEach((button) => button.onclick = async () => { try { await api(`/api/v1/admin/keys/${button.dataset.revokeKey}`, { method: "DELETE" }); dialog.close(); toast("API Key 已撤銷"); void keyManager(userId); } catch (error) { toast(error.message, "error"); } }); dialog.querySelector("form").onsubmit = async (event) => { event.preventDefault(); try { const response = await api(`/api/v1/admin/users/${userId}/keys`, { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) }); dialog.querySelector(".modal-form").innerHTML = `<span class="eyebrow">請立即保存</span><h2>新的 API Key</h2><p>離開此視窗後將無法再次顯示完整值。</p><code class="secret-value">${esc(response.apiKey)}</code><button class="button primary" data-copy-key>${icon("copy")}複製 API Key</button>`; dialog.querySelector("[data-copy-key]").onclick = () => void copyText(response.apiKey, "API Key 已複製"); } catch (error) { toast(error.message, "error"); } }; } catch (error) { toast(error.message, "error"); } }
async function roleForm(name) { const data = await load("admin-roles", "/api/v1/admin/roles"); const role = data.roles.find((item) => item.roleName === name); if (!role) return; const isFullAccess = role.capabilities.includes("*"); const dialog = modal(`<form class="modal-form role-form"><span class="eyebrow">Role policy</span><h2>調整 ${esc(role.displayName)}</h2><label>說明<textarea name="description" maxlength="500">${esc(role.description)}</textarea></label><label>每次最大結果列數<input name="maxRowsPerQuery" type="number" min="1" max="10000" value="${role.maxRowsPerQuery}"></label><fieldset ${isFullAccess ? "disabled" : ""}><legend>產品能力${isFullAccess ? "（Owner 為完整管理權限）" : ""}</legend>${PRODUCT_CAPABILITIES.map((capability) => `<label class="check"><input type="checkbox" name="capability" value="${capability}" ${role.capabilities.includes(capability) || isFullAccess ? "checked" : ""}> ${esc(CAPABILITY_LABELS[capability])}</label>`).join("")}</fieldset><button class="button primary">${icon("check")}更新角色</button></form>`); dialog.querySelector("form").onsubmit = async (event) => { event.preventDefault(); const form = new FormData(event.currentTarget); const body = { description: form.get("description"), maxRowsPerQuery: Number(form.get("maxRowsPerQuery")), capabilities: isFullAccess ? ["*"] : form.getAll("capability") }; try { await api(`/api/v1/admin/roles/${name}`, { method: "PATCH", body: JSON.stringify(body) }); invalidate("admin-roles"); dialog.close(); toast("角色設定已更新"); void render(); } catch (error) { toast(error.message, "error"); } }; }
async function changePassword(event) { event.preventDefault(); try { await api("/api/v1/auth/change-password", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) }); event.currentTarget.reset(); toast("密碼已更新"); } catch (error) { toast(error.message, "error"); } }
async function logout() { try { await api("/api/v1/auth/logout", { method: "POST" }); } finally { state.user = null; state.cache.clear(); state.activeSession = null; state.messages = []; state.result = null; showAuth(); } }

function authShell(content) { root.innerHTML = `<main class="auth-shell"><section class="auth-aside"><div class="brand"><span class="brand-mark">Q</span><span>QueryMind</span></div><div><span class="eyebrow">Secure analytics workspace</span><h1>讓資料直接回答問題。</h1><p>以自然語言探索資料，同時保留唯讀 SQL、欄位遮罩、D1 Schema Catalog 與角色化產品權限。</p></div><ul><li>${icon("shield")}受控 D1 資料來源</li><li>${icon("chat")}AI Gateway BYOK 架構</li><li>${icon("users")}角色導向產品功能</li></ul></section><section class="auth-content">${content}</section></main>`; }
function showAuth() { authShell(`<form id="login-form" class="auth-card"><span class="eyebrow">Welcome back</span><h2>登入 QueryMind</h2><p>使用你的工作區帳戶繼續。</p><label>電子郵件<input name="email" type="email" required autocomplete="email"></label><label>密碼<input name="password" type="password" required minlength="12" autocomplete="current-password"></label><button class="button primary">${icon("chat")}登入工作區</button><p class="auth-note">需要加入工作區嗎？請向 Owner 索取一次性邀請連結。</p></form>`); root.querySelector("#login-form").onsubmit = login; }
function showBootstrap() { authShell(`<form id="bootstrap-form" class="auth-card"><span class="eyebrow">First-time setup</span><h2>建立 QueryMind Owner</h2><p>此工作區尚未建立帳戶。輸入部署時設定的 Bootstrap Token，建立唯一的初始 Owner。</p><label>Owner 電子郵件<input name="email" type="email" required autocomplete="email"></label><label>密碼<input name="password" type="password" required minlength="12" autocomplete="new-password"></label><label>確認密碼<input name="confirmPassword" type="password" required minlength="12" autocomplete="new-password"></label><label>Bootstrap Token<input name="bootstrapToken" type="password" required autocomplete="off"></label><button class="button primary">${icon("shield")}建立安全工作區</button><p class="auth-note">建立完成後，Bootstrap Token 將無法再建立第二位 Owner。</p></form>`); root.querySelector("#bootstrap-form").onsubmit = bootstrapWorkspace; }
async function bootstrapWorkspace(event) { event.preventDefault(); const form = new FormData(event.currentTarget); if (form.get("password") !== form.get("confirmPassword")) { toast("兩次輸入的密碼不一致", "error"); return; } const button = event.currentTarget.querySelector("button"); button.disabled = true; try { const data = await api("/api/v1/auth/bootstrap", { method: "POST", body: JSON.stringify({ email: form.get("email"), password: form.get("password"), bootstrapToken: form.get("bootstrapToken") }) }); state.user = data.user; history.replaceState({}, "", "/#/chat"); state.page = "chat"; prepareRoute("chat"); await render(); } catch (error) { toast(error.message, "error"); button.disabled = false; } }
async function login(event) { event.preventDefault(); const button = event.currentTarget.querySelector("button"); button.disabled = true; try { const data = await api("/api/v1/auth/login", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))) }); state.user = data.user; state.page = pageFromLocation(); void render(); } catch (error) { toast(error.message, "error"); button.disabled = false; } }
function invitationTokenFromLocation() { const fragment = location.hash.startsWith("#") ? location.hash.slice(1) : location.hash; return new URLSearchParams(fragment).get("token") || ""; }
function showInvitation(token = invitationTokenFromLocation() || state.inviteToken) { state.inviteToken = token || ""; authShell(`<section class="auth-card invite-card"><span class="eyebrow">Secure onboarding</span><h2>加入 QueryMind</h2><p>確認邀請後，設定你的帳戶密碼即可進入工作區。</p><form id="invite-token-form"><label>邀請 Token 或連結<input name="token" value="${esc(state.inviteToken)}" placeholder="貼上 qmi_… Token 或完整連結" required></label><button class="button secondary">確認邀請</button></form><div id="invite-preview" class="invite-preview"></div></section>`); root.querySelector("#invite-token-form").onsubmit = async (event) => { event.preventDefault(); const value = new FormData(event.currentTarget).get("token").toString().trim(); try { const parsed = new URL(value, location.origin); const fragment = parsed.hash.startsWith("#") ? parsed.hash.slice(1) : parsed.hash; state.inviteToken = new URLSearchParams(fragment).get("token") || value; } catch { state.inviteToken = value; } await loadInvitationPreview(); }; if (state.inviteToken) void loadInvitationPreview(); }
async function loadInvitationPreview() { const target = root.querySelector("#invite-preview"); target.innerHTML = '<div class="loading-inline">正在確認邀請…</div>'; try { const data = await api("/api/v1/auth/invitation", { method: "POST", body: JSON.stringify({ token: state.inviteToken }) }); const invite = data.invitation; target.innerHTML = `<div class="invite-summary"><span>${icon("check")}</span><div><b>${esc(invite.email)}</b><small>角色：${esc(invite.roleName)} · 到期：${fmtDate(invite.expiresAt)}</small></div></div><form id="accept-invite-form" class="form-grid"><label>顯示名稱<input name="displayName" maxlength="100" placeholder="你的名字或團隊暱稱"></label><label>設定密碼<input name="password" type="password" minlength="12" autocomplete="new-password" required></label><label>確認密碼<input name="confirmPassword" type="password" minlength="12" autocomplete="new-password" required></label><button class="button primary">${icon("check")}建立帳號並進入工作區</button></form>`; root.querySelector("#accept-invite-form").onsubmit = async (event) => { event.preventDefault(); const form = new FormData(event.currentTarget); if (form.get("password") !== form.get("confirmPassword")) { toast("兩次輸入的密碼不一致", "error"); return; } try { await api("/api/v1/auth/accept-invitation", { method: "POST", body: JSON.stringify({ token: state.inviteToken, email: invite.email, displayName: form.get("displayName"), password: form.get("password") }) }); const loginData = await api("/api/v1/auth/login", { method: "POST", body: JSON.stringify({ email: invite.email, password: form.get("password") }) }); state.user = loginData.user; history.replaceState({}, "", "/"); location.hash = "#/chat"; } catch (error) { toast(error.message, "error"); } }; } catch (error) { target.innerHTML = `<div class="inline-error">${icon("warning")}${esc(error.message || "邀請不存在、已過期或已使用。")}<br><small>請向 Owner 取得新的邀請連結。</small></div>`; } }
async function showEntry() { try { const data = await api("/api/v1/auth/bootstrap-status"); if (data.bootstrapRequired) showBootstrap(); else showAuth(); } catch { showAuth(); } }
async function start() { if (location.pathname === "/accept-invite" || invitationTokenFromLocation()) { showInvitation(); return; } try { const data = await api("/api/v1/auth/status"); if (!data.user) { await showEntry(); return; } state.user = data.user; state.page = pageFromLocation(); await render(); } catch { await showEntry(); } }
window.addEventListener("hashchange", () => { if (!state.user) return; state.page = pageFromLocation(); state.sidebarOpen = false; void render(); });
void start();
